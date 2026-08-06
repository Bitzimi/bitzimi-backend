import { db } from "../../../db";
import { dec } from "../../../utils/dec";
import { creditWallet, writeLedgerEntry } from "../../wallets/wallets.service";
import { createNotification } from "../../notifications/notifications.service";

function serializeWithdrawal(w: any) {
  return {
    id:              w.id,
    userId:          w.userId,
    amount:          dec(w.amount),
    fee:             dec(w.fee),
    netAmount:       dec(w.netAmount),
    destination:     w.destination,
    paymentMethod:   w.paymentMethod,
    status:          w.status,
    pinVerified:     w.pinVerified,
    txHash:          w.txHash ?? null,
    rejectionReason: w.rejectionReason ?? null,
    processedBy:     w.processedBy ?? null,
    submittedAt:     w.submittedAt.toISOString(),
    processedAt:     w.processedAt?.toISOString() ?? null,
    user: w.user ? {
      email:    w.user.email,
      username: w.user.profile?.username ?? "",
    } : null,
  };
}

export async function adminListWithdrawals(opts: {
  status?: string;
  cursor?: string;
  limit?: number;
}) {
  const { status, cursor, limit = 50 } = opts;
  const where: any = {};
  if (status) where.status = status;
  if (cursor) {
    const anchor = await db.withdrawal.findUnique({ where: { id: cursor } });
    if (anchor) where.submittedAt = { lt: anchor.submittedAt };
  }

  const rows = await db.withdrawal.findMany({
    where,
    orderBy: { submittedAt: "desc" },
    take: limit + 1,
    include: { user: { include: { profile: { select: { username: true } } } } },
  });

  const hasMore = rows.length > limit;
  const items   = hasMore ? rows.slice(0, limit) : rows;
  return {
    items:      items.map(serializeWithdrawal),
    nextCursor: hasMore ? items[items.length - 1].id : null,
    hasMore,
  };
}

export async function adminGetWithdrawal(id: string) {
  const w = await db.withdrawal.findUnique({
    where:   { id },
    include: { user: { include: { profile: { select: { username: true } } } } },
  });
  if (!w) throw Object.assign(new Error("Withdrawal not found"), { statusCode: 404, code: "NOT_FOUND" });
  return serializeWithdrawal(w);
}

export async function adminProcessWithdrawal(id: string, adminId: string) {
  const w = await db.withdrawal.findUnique({ where: { id } });
  if (!w) throw Object.assign(new Error("Withdrawal not found"), { statusCode: 404, code: "NOT_FOUND" });
  // Atomic guard: two concurrent admin actions both see "submitted" outside the
  // update, but only one can win the updateMany — preventing duplicate notifications.
  const guard = await db.withdrawal.updateMany({
    where: { id, status: "submitted" },
    data:  { status: "processing", processedBy: adminId },
  });
  if (guard.count === 0) {
    const fresh = await db.withdrawal.findUnique({ where: { id } });
    throw Object.assign(
      new Error(`Cannot process withdrawal — current status: ${fresh?.status ?? "unknown"}`),
      { statusCode: 409, code: "INVALID_STATUS" }
    );
  }
  const updated = await db.withdrawal.findUnique({ where: { id } });
  setImmediate(() => createNotification({
    userId:   w.userId,
    type:     "withdrawal",
    title:    "Withdrawal Processing 🔄",
    message:  `Your withdrawal of $${dec(w.netAmount).toFixed(2)} is now being processed.`,
    metadata: { withdrawalId: id, amount: dec(w.amount) },
  }));
  return serializeWithdrawal(updated);
}

export async function adminCompleteWithdrawal(id: string, adminId: string, txHash?: string) {
  const w = await db.withdrawal.findUnique({ where: { id } });
  if (!w) throw Object.assign(new Error("Withdrawal not found"), { statusCode: 404, code: "NOT_FOUND" });
  // Atomic guard: prevents two concurrent completions from both succeeding and
  // each firing a "Withdrawal Completed" notification.
  const guard = await db.withdrawal.updateMany({
    where: { id, status: { in: ["submitted", "processing"] } },
    data:  { status: "completed", processedBy: adminId, processedAt: new Date(), txHash: txHash ?? null },
  });
  if (guard.count === 0) {
    const fresh = await db.withdrawal.findUnique({ where: { id } });
    throw Object.assign(
      new Error(`Cannot complete withdrawal — current status: ${fresh?.status ?? "unknown"}`),
      { statusCode: 409, code: "INVALID_STATUS" }
    );
  }
  const updated = await db.withdrawal.findUnique({ where: { id } });
  setImmediate(() => createNotification({
    userId:   w.userId,
    type:     "withdrawal",
    title:    "Withdrawal Completed ✅",
    message:  `Your withdrawal of $${dec(w.netAmount).toFixed(2)} has been completed.${txHash ? ` TX: ${txHash}` : ""}`,
    metadata: { withdrawalId: id, amount: dec(w.amount), txHash: txHash ?? null },
  }));
  return serializeWithdrawal(updated);
}

export async function adminRejectWithdrawal(
  id: string,
  adminId: string,
  reason: string
) {
  const w = await db.withdrawal.findUnique({ where: { id } });
  if (!w) throw Object.assign(new Error("Withdrawal not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (!["submitted", "processing"].includes(w.status)) {
    throw Object.assign(
      new Error(`Cannot reject withdrawal — current status: ${w.status}`),
      { statusCode: 409, code: "INVALID_STATUS" }
    );
  }

  // Read the original per-wallet debit breakdown from the withdrawal's ledger entry.
  // submitWithdrawal() stores { walletDebits: Record<walletType, amount> } in metadata.
  // Refund must restore each wallet exactly — NOT dump the full amount into game wallet.
  const ledgerEntry = await db.transaction.findFirst({
    where: { referenceId: id, referenceType: "withdrawal", type: "withdrawal" },
  });

  const walletDebits: Record<string, number> | null = (() => {
    if (!ledgerEntry?.metadata) return null;
    try {
      const meta = JSON.parse(ledgerEntry.metadata as string);
      return (meta.walletDebits && Object.keys(meta.walletDebits).length > 0)
        ? meta.walletDebits
        : null;
    } catch { return null; }
  })();

  const updated = await db.$transaction(async (tx) => {
    // Atomic guard: claim the status transition inside the transaction.
    // Two concurrent admin rejects both see "submitted" outside the tx, but only
    // one can win the updateMany — the loser gets count=0 and bails without refunding.
    const guard = await tx.withdrawal.updateMany({
      where: { id, status: { in: ["submitted", "processing"] } },
      data:  { status: "rejected", processedBy: adminId, processedAt: new Date(), rejectionReason: reason },
    });
    if (guard.count === 0) {
      const fresh = await tx.withdrawal.findUnique({ where: { id } });
      throw Object.assign(
        new Error(`Cannot reject withdrawal — current status: ${fresh?.status ?? "unknown"}`),
        { statusCode: 409, code: "INVALID_STATUS" }
      );
    }

    if (walletDebits) {
      // Multi-wallet refund: restore each wallet by exactly the amount originally debited.
      for (const [walletType, amount] of Object.entries(walletDebits)) {
        const amt = parseFloat(String(amount));
        if (amt <= 0) continue;
        await creditWallet(tx, w.userId, walletType as any, amt);
        await writeLedgerEntry(tx, {
          userId: w.userId, type: "transfer", toWallet: walletType,
          amount: amt,
          description: `Withdrawal rejected — refund to ${walletType} wallet`,
          referenceId: id, referenceType: "withdrawal",
          metadata: { reason, adminId, walletDebits },
        });
      }
    } else {
      // Fallback: no walletDebits metadata found (legacy withdrawal) — refund to game wallet.
      await creditWallet(tx, w.userId, "game", dec(w.amount));
      await writeLedgerEntry(tx, {
        userId: w.userId, type: "transfer", toWallet: "game", amount: dec(w.amount),
        description: "Withdrawal rejected — refund to game wallet (legacy)",
        referenceId: id, referenceType: "withdrawal",
        metadata: { reason, adminId },
      });
    }

    return tx.withdrawal.findUnique({ where: { id } });
  });

  // Build a human-readable refund summary for the notification.
  const refundSummary = walletDebits
    ? Object.entries(walletDebits)
        .filter(([, amt]) => parseFloat(String(amt)) > 0)
        .map(([wt, amt]) => `$${parseFloat(String(amt)).toFixed(2)} to ${wt}`)
        .join(", ")
    : `$${dec(w.amount).toFixed(2)} to game wallet`;

  setImmediate(() => createNotification({
    userId:   w.userId,
    type:     "withdrawal",
    title:    "Withdrawal Rejected",
    message:  `Your withdrawal of $${dec(w.amount).toFixed(2)} was rejected and refunded: ${refundSummary}. Reason: ${reason}`,
    metadata: { withdrawalId: id, amount: dec(w.amount), reason, walletDebits },
  }));
  return serializeWithdrawal(updated);
}
