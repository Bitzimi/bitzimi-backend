import { db } from "../../db";
import { dec } from "../../utils/dec";
import { resolveUserTier, checkLimit, claimWithdrawalLimit } from "./limits";
import { consumePinToken } from "./pinTokens";
import { writeLedgerEntry, WalletType } from "../wallets/wallets.service";
import { config } from "../../config";
import { getNGNToUSDRate } from "../admin/currency/admin.currency.service";
import { getConfigValue } from "../admin/config/admin.config.service";

// Wallets eligible for withdrawal, in debit priority order.
// game first (primary earning wallet), then task, referral, affiliate, ambassador.
const WITHDRAWAL_WALLETS: WalletType[] = ["game", "task", "referral", "affiliate", "ambassador"];

function serializeWithdrawal(w: any) {
  return {
    id:              w.id,
    amount:          dec(w.amount),
    fee:             dec(w.fee),
    netAmount:       dec(w.netAmount),
    destination:     w.destination,
    paymentMethod:   w.paymentMethod,
    status:          w.status,
    txHash:          w.txHash ?? null,
    rejectionReason: w.rejectionReason ?? null,
    submittedAt:     w.submittedAt.toISOString(),
    processedAt:     w.processedAt?.toISOString() ?? null,
  };
}

// Calculate the fixed withdrawal fee in USD for a given method.
// Bank fee: fee_bank_ngn (SystemConfig, fallback config.ts env var) converted to USD via live Currency rate.
// Crypto fee: fee_crypto_usd (SystemConfig, fallback config.ts env var).
// Admin changes to SystemConfig take effect immediately (no cache on fee reads).
async function getWithdrawalFeeUSD(method: "crypto" | "bank"): Promise<number> {
  if (method === "bank") {
    const [bankFeeNGN, ngnRate] = await Promise.all([
      getConfigValue<number>("withdrawal.fee_bank_ngn", config.withdrawalFees.bankNGN),
      getNGNToUSDRate(),
    ]);
    return parseFloat((bankFeeNGN / ngnRate).toFixed(8));
  }
  const cryptoFeeUSD = await getConfigValue<number>("withdrawal.fee_crypto_usd", config.withdrawalFees.cryptoUSD);
  return cryptoFeeUSD;
}

// Get total available withdrawal balance across all eligible wallets.
export async function getAvailableWithdrawalBalance(userId: string): Promise<number> {
  const wallets = await db.wallet.findMany({
    where: { userId, walletType: { in: WITHDRAWAL_WALLETS } },
  });
  return wallets.reduce((sum, w) => sum + dec(w.balance), 0);
}

// Debit the gross amount sequentially across eligible wallets in priority order.
// Returns a breakdown of how much was debited from each wallet (for ledger metadata).
async function debitAcrossWallets(
  tx: any,
  userId: string,
  totalAmount: number,
): Promise<Record<string, number>> {
  // Only include non-frozen wallets in the balance snapshot.
  const wallets = await tx.wallet.findMany({
    where: { userId, walletType: { in: WITHDRAWAL_WALLETS }, isFrozen: false },
  });

  const balanceMap: Record<string, number> = {};
  for (const w of wallets) balanceMap[w.walletType] = dec(w.balance);

  const debits: Record<string, number> = {};
  let remaining = parseFloat(totalAmount.toFixed(8));

  for (const walletType of WITHDRAWAL_WALLETS) {
    if (remaining <= 0.000001) break;
    const available = balanceMap[walletType] ?? 0;
    if (available <= 0) continue;
    const debitAmount = parseFloat(Math.min(available, remaining).toFixed(8));
    // Atomic conditional update: only succeeds if the wallet still holds >= debitAmount
    // AND is not frozen. The isFrozen guard closes the TOCTOU window between the
    // findMany snapshot above and this update.
    const result = await tx.wallet.updateMany({
      where: { userId, walletType, isFrozen: false, balance: { gte: debitAmount } },
      data:  { balance: { decrement: debitAmount } },
    });
    if (result.count === 0) {
      throw Object.assign(new Error("Insufficient balance"), {
        statusCode: 400, code: "INSUFFICIENT_BALANCE",
      });
    }
    debits[walletType] = debitAmount;
    remaining = parseFloat((remaining - debitAmount).toFixed(8));
  }

  if (remaining > 0.001) {
    throw Object.assign(new Error("Insufficient balance"), {
      statusCode: 400, code: "INSUFFICIENT_BALANCE",
    });
  }

  return debits;
}

export async function submitWithdrawal(
  userId: string,
  opts: { amount: number; destination: string; method: "crypto" | "bank"; pinToken: string }
) {
  // ── Feature flag enforcement ──────────────────────────────────────────────────
  if (opts.method === "bank" && !config.banking.bankWithdrawalsEnabled) {
    throw Object.assign(new Error("Bank withdrawals are currently disabled. Please use crypto withdrawal."), {
      statusCode: 403, code: "BANK_WITHDRAWALS_DISABLED",
    });
  }

  // ── Minimum withdrawal enforcement ───────────────────────────────────────────
  // SystemConfig key "platform.min_withdrawal" is the single source of truth.
  // config.withdrawalMinimumUSD (env var WITHDRAWAL_MIN_USD, default $7) is the fallback.
  const minUSD = await getConfigValue<number>("platform.min_withdrawal", config.withdrawalMinimumUSD);
  if (opts.amount < minUSD) {
    throw Object.assign(
      new Error(`Minimum withdrawal is $${minUSD.toFixed(2)} USD`),
      { statusCode: 400, code: "BELOW_MINIMUM_WITHDRAWAL" }
    );
  }

  const pinValid = consumePinToken(opts.pinToken, userId);
  if (!pinValid) {
    throw Object.assign(new Error("Invalid or expired PIN verification token"), {
      statusCode: 400, code: "PIN_TOKEN_INVALID",
    });
  }

  const tier       = await resolveUserTier(userId);
  const limitCheck = await checkLimit(userId, opts.amount, tier);
  if (!limitCheck.allowed) {
    throw Object.assign(new Error(limitCheck.reason!), { statusCode: 400, code: "LIMIT_EXCEEDED" });
  }

  // ── Fixed fee calculation (uses admin-managed Currency Management rate) ────────
  const fee       = await getWithdrawalFeeUSD(opts.method);
  const netAmount = parseFloat((opts.amount - fee).toFixed(8));

  if (netAmount <= 0) {
    throw Object.assign(
      new Error(`Withdrawal amount must exceed the fee of $${fee.toFixed(2)} USD`),
      { statusCode: 400, code: "AMOUNT_BELOW_FEE" }
    );
  }

  // ── Available balance pre-check (before entering transaction) ─────────────────
  const available = await getAvailableWithdrawalBalance(userId);
  if (available < opts.amount) {
    throw Object.assign(
      new Error(`Insufficient balance. Available: $${available.toFixed(2)}, requested: $${opts.amount.toFixed(2)}`),
      { statusCode: 400, code: "INSUFFICIENT_BALANCE" }
    );
  }

  // Capture tier limits from the pre-check result — passed into the transaction so
  // claimWithdrawalLimit can re-check under a row-level lock without re-querying config.
  const tierLimits = { daily: limitCheck.dailyLimit, monthly: limitCheck.monthlyLimit };

  const withdrawal = await db.$transaction(async (tx) => {
    // Acquire a row-level lock on the withdrawal_limits record and re-check limits
    // with the locked, up-to-date values. This serializes concurrent withdrawal requests
    // for the same user: the second request blocks until the first commits, then sees
    // the updated dailyUsed and rejects if the limit has been consumed.
    // Also records the limit increment while the lock is held, before the wallet debit,
    // so a rollback (e.g. INSUFFICIENT_BALANCE) undoes the increment atomically.
    await claimWithdrawalLimit(userId, opts.amount, tierLimits, tx);

    // Debit across wallets in priority order: game → task → referral → affiliate → ambassador
    const walletDebits = await debitAcrossWallets(tx, userId, opts.amount);

    const w = await tx.withdrawal.create({
      data: {
        userId,
        amount:        opts.amount,
        fee,
        netAmount,
        destination:   opts.destination,
        paymentMethod: opts.method,
        pinVerified:   true,
      },
    });

    // Primary fromWallet is the first wallet debited (game in almost all cases)
    const primaryWallet = WITHDRAWAL_WALLETS.find(wt => (walletDebits[wt] ?? 0) > 0) ?? "game";

    await writeLedgerEntry(tx, {
      userId,
      type:          "withdrawal",
      fromWallet:    primaryWallet,
      amount:        opts.amount,
      fee,
      description:   `Withdrawal request — ${opts.method}`,
      referenceId:   w.id,
      referenceType: "withdrawal",
      metadata:      { destination: opts.destination, method: opts.method, walletDebits },
    });

    return w;
  });

  return serializeWithdrawal(withdrawal);
}

export async function listWithdrawals(userId: string) {
  const rows = await db.withdrawal.findMany({ where: { userId }, orderBy: { submittedAt: "desc" }, take: 50 });
  return rows.map(serializeWithdrawal);
}

export async function getWithdrawal(userId: string, id: string) {
  const w = await db.withdrawal.findFirst({ where: { id, userId } });
  if (!w) throw Object.assign(new Error("Withdrawal not found"), { statusCode: 404, code: "NOT_FOUND" });
  return serializeWithdrawal(w);
}

export async function getWithdrawalLimits(userId: string) {
  const tier        = await resolveUserTier(userId);
  const limitResult = await checkLimit(userId, 0, tier);
  const available   = await getAvailableWithdrawalBalance(userId);
  return {
    tier,
    dailyLimit:       limitResult.dailyLimit,
    monthlyLimit:     limitResult.monthlyLimit,
    dailyUsed:        limitResult.dailyUsed,
    monthlyUsed:      limitResult.monthlyUsed,
    dailyRemaining:   limitResult.dailyRemaining,
    monthlyRemaining: limitResult.monthlyRemaining,
    availableBalance: available,
    minimumWithdrawal: await getConfigValue<number>("platform.min_withdrawal", config.withdrawalMinimumUSD),
    fees: {
      bank:   await getWithdrawalFeeUSD("bank"),
      crypto: await getWithdrawalFeeUSD("crypto"),
    },
  };
}
