import { db } from "../../db";
import { dec } from "../../utils/dec";

export type WalletType = "main"|"game"|"task"|"referral"|"affiliate"|"task_vault"|"ambassador";
const ALL_WALLET_TYPES: WalletType[] = ["main","game","task","referral","affiliate","task_vault","ambassador"];

const WITHDRAWAL_WALLET_TYPES: WalletType[] = ["game", "task", "referral", "affiliate", "ambassador"];

export async function getWallets(userId: string) {
  const wallets = await db.wallet.findMany({ where: { userId } });
  const balances: Record<string, number> = {};
  for (const w of wallets) balances[w.walletType] = dec(w.balance);
  for (const t of ALL_WALLET_TYPES) if (!(t in balances)) balances[t] = 0;

  // Pre-computed totals — frontend must never calculate these
  const totalBalance = WITHDRAWAL_WALLET_TYPES.reduce((s, t) => s + (balances[t] ?? 0), 0);

  return {
    balances,
    summary: {
      totalBalance:      parseFloat(totalBalance.toFixed(8)),
      availableBalance:  parseFloat(totalBalance.toFixed(8)), // same as totalBalance; task_vault and main are excluded
    },
  };
}

export async function getWallet(userId: string, walletType: WalletType) {
  const w = await db.wallet.findUnique({
    where: { userId_walletType: { userId, walletType } },
  });
  if (!w) throw Object.assign(new Error("Wallet not found"), { statusCode: 404, code: "NOT_FOUND" });
  return { walletType: w.walletType, balance: dec(w.balance), lockedAmount: dec(w.lockedAmount), updatedAt: w.updatedAt.toISOString() };
}

export async function debitWallet(tx: any, userId: string, walletType: WalletType, amount: number): Promise<void> {
  // Atomic conditional update: only decrements if the wallet exists, is not frozen,
  // AND currently holds sufficient funds. This eliminates the read-then-decrement race
  // condition that would allow two concurrent debits to both succeed in PostgreSQL
  // READ COMMITTED isolation (the production database isolation level).
  const result = await tx.wallet.updateMany({
    where: { userId, walletType, isFrozen: false, balance: { gte: amount } },
    data:  { balance: { decrement: amount } },
  });
  if (result.count === 0) {
    // Re-read only to produce the correct error (missing vs frozen vs insufficient)
    const w = await tx.wallet.findUnique({ where: { userId_walletType: { userId, walletType } } });
    if (!w) throw new Error(`Wallet ${walletType} not found`);
    if (w.isFrozen) throw Object.assign(new Error(`Wallet ${walletType} is frozen`), { statusCode: 403, code: "WALLET_FROZEN" });
    throw Object.assign(new Error("Insufficient balance"), { statusCode: 400, code: "INSUFFICIENT_BALANCE" });
  }
}

export async function creditWallet(tx: any, userId: string, walletType: WalletType, amount: number): Promise<void> {
  await tx.wallet.update({
    where: { userId_walletType: { userId, walletType } },
    data:  { balance: { increment: amount } },
  });
}

export async function transferBetweenWallets(
  userId: string,
  from: WalletType,
  to: WalletType,
  amount: number
): Promise<void> {
  if (from === to) throw Object.assign(new Error("Cannot transfer to the same wallet"), { statusCode: 400, code: "SAME_WALLET" });
  await db.$transaction(async (tx) => {
    await debitWallet(tx, userId, from, amount);
    await creditWallet(tx, userId, to, amount);
    await writeLedgerEntry(tx, {
      userId,
      type:          "transfer",
      fromWallet:    from,
      toWallet:      to,
      amount,
      description:   `Wallet transfer: ${from} → ${to}`,
      referenceType: "wallet_transfer",
    });
  });
}

export async function writeLedgerEntry(tx: any, entry: {
  userId:         string;
  type:           string;
  fromWallet?:    string | null;
  toWallet?:      string | null;
  amount:         number;
  fee?:           number;
  description:    string;
  referenceId?:   string | null;
  referenceType?: string | null;
  metadata?:      Record<string, any>;
}): Promise<void> {
  const fee       = entry.fee ?? 0;
  const netAmount = parseFloat((entry.amount - fee).toFixed(8));
  await tx.transaction.create({
    data: {
      userId:        entry.userId,
      type:          entry.type,
      fromWallet:    entry.fromWallet  ?? null,
      toWallet:      entry.toWallet    ?? null,
      amount:        entry.amount,
      fee,
      netAmount,
      status:        "completed",
      description:   entry.description,
      referenceId:   entry.referenceId   ?? null,
      referenceType: entry.referenceType ?? null,
      metadata:      entry.metadata ? JSON.stringify(entry.metadata) : null,
    },
  });
}
