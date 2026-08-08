import { db } from "../../../db";
import { dec } from "../../../utils/dec";

function serializeTx(t: any) {
  return {
    id:            t.id,
    userId:        t.userId,
    type:          t.type,
    fromWallet:    t.fromWallet ?? null,
    toWallet:      t.toWallet ?? null,
    amount:        dec(t.amount),
    fee:           dec(t.fee),
    netAmount:     dec(t.netAmount),
    status:        t.status,
    description:   t.description ?? null,
    referenceId:   t.referenceId ?? null,
    referenceType: t.referenceType ?? null,
    createdAt:     t.createdAt.toISOString(),
    user: t.user ? {
      email:    t.user.email,
      username: t.user.profile?.username ?? "",
    } : null,
  };
}

export async function adminListTransactions(opts: {
  type?:   string;
  userId?: string;
  cursor?: string;
  limit?:  number;
}) {
  const { type, userId, cursor, limit = 50 } = opts;
  const where: any = {};
  if (type)   where.type   = type;
  if (userId) where.userId = userId;
  if (cursor) {
    const anchor = await db.transaction.findUnique({ where: { id: cursor } });
    if (anchor) where.createdAt = { lt: anchor.createdAt };
  }

  const rows = await db.transaction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    include: { user: { include: { profile: { select: { username: true } } } } },
  });

  const hasMore = rows.length > limit;
  const items   = hasMore ? rows.slice(0, limit) : rows;
  return {
    items:      items.map(serializeTx),
    nextCursor: hasMore ? items[items.length - 1].id : null,
    hasMore,
  };
}
