import { db } from "../../../db";
import { dec } from "../../../utils/dec";
import { creditWallet, writeLedgerEntry } from "../../wallets/wallets.service";
import { createNotification } from "../../notifications/notifications.service";

function serializeDeposit(d: any) {
  return {
    id: d.id, userId: d.userId,
    requestedAmount: dec(d.requestedAmount), memoAmount: dec(d.memoAmount),
    paymentMethod: d.paymentMethod, paymentAddress: d.paymentAddress ?? null,
    status: d.status, txHash: d.txHash ?? null,
    expiresAt: d.expiresAt?.toISOString() ?? null, confirmedAt: d.confirmedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
    user: d.user ? { email: d.user.email, username: d.user.profile?.username ?? "" } : null,
  };
}

export async function adminListDeposits(opts: { status?: string; cursor?: string; limit?: number }) {
  const { status, cursor, limit = 50 } = opts;
  const where: any = {};
  if (status) where.status = status;
  if (cursor) {
    const anchor = await db.deposit.findUnique({ where: { id: cursor } });
    if (anchor) where.createdAt = { lt: anchor.createdAt };
  }
  const rows = await db.deposit.findMany({
    where, orderBy: { createdAt: "desc" }, take: limit + 1,
    include: { user: { include: { profile: { select: { username: true } } } } },
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items: items.map(serializeDeposit), nextCursor: hasMore ? items[items.length - 1].id : null, hasMore };
}

export async function adminConfirmDeposit(depositId: string, adminId: string, txHash?: string) {
  const deposit = await db.deposit.findUnique({ where: { id: depositId } });
  if (!deposit) throw Object.assign(new Error("Deposit not found"), { statusCode: 404, code: "NOT_FOUND" });

  const updated = await db.$transaction(async (tx) => {
    // Atomic guard: claim the status transition inside the transaction.
    // Two concurrent admin confirms both see "pending" outside the tx, but only
    // one can win the updateMany — the loser gets count=0 and throws INVALID_STATUS.
    const guard = await tx.deposit.updateMany({
      where: { id: depositId, status: { in: ["pending", "confirming"] } },
      data:  { status: "completed", confirmedBy: adminId, confirmedAt: new Date(), txHash: txHash ?? null },
    });
    if (guard.count === 0) {
      const fresh = await tx.deposit.findUnique({ where: { id: depositId } });
      throw Object.assign(
        new Error(`Cannot confirm deposit — status: ${fresh?.status ?? "unknown"}`),
        { statusCode: 409, code: "INVALID_STATUS" }
      );
    }
    await creditWallet(tx, deposit.userId, "game", dec(deposit.requestedAmount));
    await writeLedgerEntry(tx, {
      userId: deposit.userId, type: "deposit", toWallet: "game",
      amount: dec(deposit.requestedAmount),
      description: "Deposit confirmed",
      referenceId: depositId, referenceType: "deposit",
      metadata: { txHash: txHash ?? null, adminId },
    });
    return tx.deposit.findUnique({ where: { id: depositId } });
  });
  setImmediate(() => createNotification({
    userId:  deposit.userId,
    type:    "deposit",
    title:   "Deposit Confirmed ✅",
    message: `Your deposit of $${dec(deposit.requestedAmount).toFixed(2)} has been confirmed and credited to your game wallet.`,
    metadata: { depositId, amount: dec(deposit.requestedAmount), txHash: txHash ?? null },
  }));
  return serializeDeposit(updated);
}
