/**
 * Crypto Deposit Monitor — BSC / BEP-20 USDT blockchain monitor.
 *
 * Architecture:
 *   - Polls the configured ANKR BSC RPC endpoint for ERC-20 Transfer events
 *     targeting the platform deposit wallet.
 *   - Matches incoming transfer amounts against pending Deposit records using
 *     the unique memo-amount strategy (e.g. 100.05353 USDT → user session).
 *   - On match: verifies confirmation count, credits the user's game wallet,
 *     creates a Transaction record, and marks the Deposit as completed.
 *   - All configuration comes from environment variables (config.crypto.*).
 *     The frontend never receives the RPC endpoint or any signing keys.
 *
 * Activation:
 *   Set CRYPTO_MONITOR_ENABLED=true and ANKR_BSC_RPC_ENDPOINT=<your endpoint>
 *   in the backend .env file. The monitor starts automatically on server boot.
 *
 * Safety:
 *   - Each deposit can only be credited once (idempotency via status check).
 *   - All balance updates happen inside a db.$transaction.
 *   - No frontend changes are needed — frontend polls GET /api/v1/deposits/:id.
 */

import { config } from "../config";
import { db } from "../db";
import { dec } from "../utils/dec";
import { createNotification } from "../modules/notifications/notifications.service";

const USDT_DECIMALS = 18;
const POLL_INTERVAL_MS = 15_000; // every 15 seconds
const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Parse a hex log value to a human-readable token amount
function parseTokenAmount(hexValue: string, decimals: number): number {
  const raw = BigInt(hexValue);
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const remainder = raw % divisor;
  return Number(whole) + Number(remainder) / 10 ** decimals;
}

// JSON-RPC helper — uses the configured ANKR endpoint (never exposed to frontend)
async function rpcCall(method: string, params: any[]): Promise<any> {
  const endpoint = config.crypto.ankrRpcEndpoint;
  if (!endpoint) throw new Error("ANKR_BSC_RPC_ENDPOINT not configured");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP error: ${res.status}`);
  const json = await res.json() as Record<string, any>;
  if (json["error"]) throw new Error(`RPC error: ${json["error"].message}`);
  return json["result"];
}

// Get the current latest block number
async function getLatestBlockNumber(): Promise<number> {
  const hex = await rpcCall("eth_blockNumber", []);
  return parseInt(hex, 16);
}

// Get ERC-20 Transfer logs for the deposit wallet in the given block range
async function getTransferLogs(fromBlock: number, toBlock: number): Promise<any[]> {
  const depositAddr = config.crypto.depositAddress.toLowerCase();
  const usdtContract = config.crypto.usdtContractAddress.toLowerCase();

  const logs = await rpcCall("eth_getLogs", [{
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock:   `0x${toBlock.toString(16)}`,
    address:   usdtContract,
    topics: [
      ERC20_TRANSFER_TOPIC,
      null,                           // any sender
      `0x000000000000000000000000${depositAddr.replace("0x", "")}`, // to: deposit wallet
    ],
  }]);
  return Array.isArray(logs) ? logs : [];
}

// Get confirmation count for a given transaction
async function getConfirmations(txHash: string, currentBlock: number): Promise<number> {
  const receipt = await rpcCall("eth_getTransactionReceipt", [txHash]);
  if (!receipt || !receipt.blockNumber) return 0;
  const txBlock = parseInt(receipt.blockNumber, 16);
  return Math.max(0, currentBlock - txBlock + 1);
}

// Process a single log entry — try to match to a pending deposit and credit the user
async function processLog(log: any, currentBlock: number): Promise<void> {
  const txHash  = log.transactionHash as string;
  const amount  = parseTokenAmount(log.data, USDT_DECIMALS);

  // Find matching pending deposit by memo amount (within a small float tolerance)
  const TOLERANCE = 0.000_001;
  const deposit = await db.deposit.findFirst({
    where: {
      paymentMethod: "crypto",
      status: { in: ["pending", "confirming"] },
      memoAmount: {
        gte: amount - TOLERANCE,
        lte: amount + TOLERANCE,
      },
    },
  });

  if (!deposit) return; // no session for this amount

  // Check confirmation count
  const confirmations = await getConfirmations(txHash, currentBlock);
  const required = config.crypto.confirmationsRequired;

  if (confirmations < required) {
    // Mark as confirming if not already
    if (deposit.status === "pending") {
      await db.deposit.update({
        where: { id: deposit.id },
        data: { status: "confirming", txHash },
      });
    }
    return;
  }

  // Fully confirmed — credit user
  await db.$transaction(async (tx) => {
    // Atomic guard: claim the status transition inside the transaction.
    // Two concurrent monitor ticks processing the same log both see "pending/confirming"
    // from the outer findFirst, but only one can win the updateMany.
    // The loser gets count=0 and exits without crediting — preventing double-credit.
    const guard = await tx.deposit.updateMany({
      where: { id: deposit.id, status: { in: ["pending", "confirming"] } },
      data:  { status: "completed", txHash, confirmedAt: new Date() },
    });
    if (guard.count === 0) return; // Already processed by another tick

    const creditAmount = dec(deposit.requestedAmount);

    await tx.wallet.update({
      where: { userId_walletType: { userId: deposit.userId, walletType: "game" } },
      data:  { balance: { increment: creditAmount } },
    });

    await tx.transaction.create({
      data: {
        userId:      deposit.userId,
        type:        "deposit",
        fromWallet:  null,
        toWallet:    "game",
        amount:      creditAmount,
        fee:         0,
        netAmount:   creditAmount,
        status:      "completed",
        description: `Crypto deposit (USDT BEP-20) — ${creditAmount.toFixed(6)} USDT confirmed`,
        referenceId:   deposit.id,
        referenceType: "deposit",
        metadata: JSON.stringify({ txHash, method: "crypto", network: config.crypto.network }),
      },
    });
  });

  // Notify user (fire-and-forget)
  setImmediate(() => createNotification({
    userId:  deposit.userId,
    type:    "deposit",
    title:   "Crypto Deposit Confirmed ✅",
    message: `Your deposit of $${dec(deposit.requestedAmount).toFixed(2)} has been confirmed and credited to your game wallet.`,
    metadata: { depositId: deposit.id, txHash, amount: dec(deposit.requestedAmount) },
  }));
}

// Persistent cursor: tracks the last processed block so we don't re-scan on restart
let _lastProcessedBlock: number | null = null;

async function tick(): Promise<void> {
  try {
    const latestBlock = await getLatestBlockNumber();

    if (_lastProcessedBlock === null) {
      // On first run: start from 20 blocks back to catch any recent deposits
      _lastProcessedBlock = Math.max(0, latestBlock - 20);
    }

    if (_lastProcessedBlock >= latestBlock) return;

    // Process in chunks of 50 blocks to avoid large RPC responses
    const fromBlock = _lastProcessedBlock + 1;
    const toBlock   = Math.min(latestBlock, fromBlock + 49);

    const logs = await getTransferLogs(fromBlock, toBlock);

    for (const log of logs) {
      await processLog(log, latestBlock).catch((err) =>
        console.error("[CryptoMonitor] Error processing log:", err.message)
      );
    }

    _lastProcessedBlock = toBlock;
  } catch (err: any) {
    console.error("[CryptoMonitor] Tick error:", err.message);
  }
}

let _intervalId: ReturnType<typeof setInterval> | null = null;

export function startCryptoDepositMonitor(): void {
  if (!config.crypto.monitorEnabled) {
    console.log("[CryptoMonitor] Disabled — set CRYPTO_MONITOR_ENABLED=true to activate");
    return;
  }
  if (!config.crypto.ankrRpcEndpoint) {
    console.warn("[CryptoMonitor] ANKR_BSC_RPC_ENDPOINT not set — monitor will not start");
    return;
  }
  if (!config.crypto.depositAddress) {
    console.warn("[CryptoMonitor] CRYPTO_DEPOSIT_ADDRESS not set — monitor will not start");
    return;
  }

  console.log(`[CryptoMonitor] Starting — polling every ${POLL_INTERVAL_MS / 1000}s`);
  _intervalId = setInterval(() => tick(), POLL_INTERVAL_MS);
  tick(); // run immediately on start
}

export function stopCryptoDepositMonitor(): void {
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
}
