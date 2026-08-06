import { db } from "../../db";
import { dec } from "../../utils/dec";
import { randomBytes } from "crypto";
import { config } from "../../config";
import { getNGNToUSDRate } from "../admin/currency/admin.currency.service";
import { getConfigValue } from "../admin/config/admin.config.service";

const DEPOSIT_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ── Memo amount generation ────────────────────────────────────────────────────
// Format: {base}.0{4 random digits}  e.g. 100 → 100.05353 (5 decimal places)
// First decimal digit is always 0 so the addon is in range 0.00001–0.09999.
// This keeps memo amounts visually close to the requested amount.

function generateMemoAmount(base: number): number {
  const suffix = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return parseFloat(`${base}.0${suffix}`);
}

async function uniqueMemoAmount(base: number): Promise<number> {
  for (let i = 0; i < 100; i++) {
    const memo = generateMemoAmount(base);
    const conflict = await db.deposit.findFirst({
      where: {
        memoAmount:  memo,
        status:      { in: ["pending", "confirming"] },
        expiresAt:   { gt: new Date() },
      },
    });
    if (!conflict) return memo;
  }
  throw Object.assign(new Error("Unable to generate unique memo amount — try again"), {
    statusCode: 503, code: "MEMO_EXHAUSTED",
  });
}

function generateBankRef(): string {
  return "BZ" + randomBytes(5).toString("hex").toUpperCase();
}

function serializeDeposit(d: any) {
  return {
    id:              d.id,
    requestedAmount: dec(d.requestedAmount),
    memoAmount:      dec(d.memoAmount),
    paymentMethod:   d.paymentMethod,
    paymentAddress:  d.paymentAddress,
    status:          d.status,
    txHash:          d.txHash,
    expiresAt:       d.expiresAt.toISOString(),
    confirmedAt:     d.confirmedAt?.toISOString() ?? null,
    createdAt:       d.createdAt.toISOString(),
  };
}

// ── Create deposit ────────────────────────────────────────────────────────────

export async function createDeposit(
  userId: string,
  opts: { amount: number; method: "crypto" | "bank" }
) {
  // ── Feature flag enforcement ──────────────────────────────────────────────────
  if (opts.method === "bank" && !config.banking.bankDepositsEnabled) {
    throw Object.assign(new Error("Bank deposits are currently disabled. Please use crypto deposit."), {
      statusCode: 403, code: "BANK_DEPOSITS_DISABLED",
    });
  }

  if (opts.method === "crypto" && !config.crypto.depositAddress) {
    throw Object.assign(new Error("Crypto deposits are not configured. Contact support."), {
      statusCode: 503, code: "CRYPTO_NOT_CONFIGURED",
    });
  }

  // ── Server-side minimum deposit enforcement ───────────────────────────────────
  // SystemConfig keys are the single source of truth; config.ts env vars are fallbacks.
  if (opts.method === "crypto") {
    const minUSD = await getConfigValue<number>("deposit.crypto_minimum_usd", config.crypto.minimumDeposit);
    if (opts.amount < minUSD) {
      throw Object.assign(
        new Error(`Minimum crypto deposit is $${minUSD.toFixed(2)} USD`),
        { statusCode: 400, code: "BELOW_MINIMUM_DEPOSIT" }
      );
    }
  }
  if (opts.method === "bank") {
    const [minNGN, ngnRate] = await Promise.all([
      getConfigValue<number>("deposit.bank_minimum_ngn", config.banking.minimumBankDepositNGN),
      getNGNToUSDRate(),
    ]);
    const minUSD = minNGN / ngnRate;
    if (opts.amount < minUSD) {
      throw Object.assign(
        new Error(`Minimum bank deposit is ₦${minNGN.toLocaleString()} (≈ $${minUSD.toFixed(2)} USD)`),
        { statusCode: 400, code: "BELOW_MINIMUM_DEPOSIT" }
      );
    }
  }

  // Block if user already has a live pending deposit
  const live = await db.deposit.findFirst({
    where: { userId, status: { in: ["pending", "confirming"] }, expiresAt: { gt: new Date() } },
  });
  if (live) {
    throw Object.assign(new Error("You already have a pending deposit. Cancel it or wait for it to expire."), {
      statusCode: 409, code: "DEPOSIT_ALREADY_PENDING",
    });
  }

  const memoAmount     = await uniqueMemoAmount(opts.amount);
  const expiresAt      = new Date(Date.now() + DEPOSIT_TTL_MS);
  // Wallet address comes from env — never from client request
  const paymentAddress = opts.method === "bank"
    ? generateBankRef()
    : config.crypto.depositAddress;

  const deposit = await db.deposit.create({
    data: {
      userId,
      requestedAmount: opts.amount,
      memoAmount,
      paymentMethod:   opts.method,
      paymentAddress,
      expiresAt,
    },
  });

  return serializeDeposit(deposit);
}

// ── Deposit info (public details served to authenticated users) ───────────────

export async function getCryptoDepositInfo(memoAmount?: number, expiresAt?: string) {
  const minimumDeposit = await getConfigValue<number>("deposit.crypto_minimum_usd", config.crypto.minimumDeposit);
  return {
    walletAddress:            config.crypto.depositAddress || null,
    network:                  config.crypto.network,
    minimumDeposit,
    confirmationRequirement:  config.crypto.confirmationsRequired,
    memoAmount:               memoAmount ?? null,
    expiresAt:                expiresAt ?? null,
  };
}

// ── List deposits ─────────────────────────────────────────────────────────────

export async function listDeposits(userId: string) {
  const rows = await db.deposit.findMany({
    where:   { userId },
    orderBy: { createdAt: "desc" },
    take:    50,
  });
  return rows.map(serializeDeposit);
}

// ── Get deposit by ID ─────────────────────────────────────────────────────────

export async function getDeposit(userId: string, id: string) {
  // Auto-expire on read — mark as expired if TTL passed and still pending
  const deposit = await db.deposit.findFirst({ where: { id, userId } });
  if (!deposit) throw Object.assign(new Error("Deposit not found"), { statusCode: 404, code: "NOT_FOUND" });

  if (
    deposit.status === "pending" &&
    new Date() > deposit.expiresAt
  ) {
    const updated = await db.deposit.update({
      where: { id },
      data:  { status: "expired" },
    });
    return serializeDeposit(updated);
  }

  return serializeDeposit(deposit);
}

// ── Cancel deposit ────────────────────────────────────────────────────────────

export async function cancelDeposit(userId: string, id: string) {
  const deposit = await db.deposit.findFirst({ where: { id, userId } });
  if (!deposit) throw Object.assign(new Error("Deposit not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (deposit.status !== "pending") {
    throw Object.assign(new Error(`Deposit cannot be cancelled — status is "${deposit.status}"`), {
      statusCode: 400, code: "INVALID_STATUS",
    });
  }
  await db.deposit.update({ where: { id }, data: { status: "expired" } });
}
