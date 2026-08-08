import { db } from "../../db";
import { dec } from "../../utils/dec";

function serializeTx(tx: any) {
  return {
    id:           tx.id,
    type:         tx.type,
    fromWallet:   tx.fromWallet,
    toWallet:     tx.toWallet,
    amount:       dec(tx.amount),
    fee:          dec(tx.fee),
    netAmount:    dec(tx.netAmount),
    status:       tx.status,
    description:  tx.description,
    referenceId:  tx.referenceId,
    referenceType:tx.referenceType,
    metadata:     tx.metadata,
    createdAt:    tx.createdAt.toISOString(),
  };
}

export async function listTransactions(
  userId: string,
  opts: { cursor?: string; limit: number; type?: string }
) {
  const { cursor, limit, type } = opts;

  const where: any = { userId };
  if (type) where.type = type;
  if (cursor) {
    const anchor = await db.transaction.findUnique({ where: { id: cursor } });
    if (anchor) where.createdAt = { lt: anchor.createdAt };
  }

  const rows = await db.transaction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1, // fetch one extra to determine if there is a next page
  });

  const hasMore = rows.length > limit;
  const items   = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return { items: items.map(serializeTx), nextCursor, hasMore };
}

export async function getTransaction(userId: string, txId: string) {
  const tx = await db.transaction.findFirst({ where: { id: txId, userId } });
  if (!tx) throw Object.assign(new Error("Transaction not found"), { statusCode: 404, code: "NOT_FOUND" });
  return serializeTx(tx);
}
