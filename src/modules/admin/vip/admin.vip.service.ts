/**
 * Admin VIP Service — visibility and management of VIP subscriptions and streaks.
 *
 * Read-only queries: stats, member list, member detail.
 * Management actions (require admin.vip.manage): cancel subscription, reset streak.
 *
 * Does NOT touch wallet balances, wallet credits, or commission logic.
 * Cancellation is administrative only — no refund is issued automatically.
 */
import { db } from "../../../db";

// ── VIP platform-wide statistics ──────────────────────────────────────────────

export async function adminGetVipStats() {
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const now     = new Date();

  const [
    totalSubscriptions,
    activeSubscriptions,
    expiredSubscriptions,
    newSubscriptionsThisWeek,
    totalStreakRecords,
    streakSum,
    streakClaimedToday,
    revenueAggregate,
    cancelledSubscriptions,
  ] = await Promise.all([
    db.subscription.count(),
    db.subscription.count({ where: { isActive: true, endsAt: { gt: now } } }),
    db.subscription.count({ where: { cancelledAt: null, OR: [{ isActive: false }, { endsAt: { lte: now } }] } }),
    db.subscription.count({ where: { startedAt: { gte: since7d } } }),
    db.vipStreak.count(),
    db.vipStreak.aggregate({ _sum: { totalEarned: true, currentStreak: true } }),
    db.vipStreak.count({ where: { lastClaimDate: { gte: since7d } } }),
    db.subscription.aggregate({ _sum: { price: true } }),
    db.subscription.count({ where: { cancelledAt: { not: null } } }),
  ]);

  const totalRevenueUSD   = revenueAggregate._sum.price ?? 0;
  const totalStreakEarned  = streakSum._sum.totalEarned  ?? 0;
  const avgCurrentStreak   = totalStreakRecords > 0
    ? ((streakSum._sum.currentStreak ?? 0) / totalStreakRecords)
    : 0;

  // Streak reward distributions (last 30 days via transaction log)
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const streakPayouts = await db.transaction.aggregate({
    where: { referenceType: "vip_streak", createdAt: { gte: since30d } },
    _sum:   { amount: true },
    _count: true,
  });

  // Churn: subscriptions not renewed (expired + not renewed in 30 days)
  const expiringNext7d = await db.subscription.count({
    where: { isActive: true, endsAt: { gt: now, lt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } },
  });

  return {
    subscriptions: {
      total:              totalSubscriptions,
      active:             activeSubscriptions,
      expired:            expiredSubscriptions,
      cancelled:          cancelledSubscriptions,
      newThisWeek:        newSubscriptionsThisWeek,
      expiringNext7Days:  expiringNext7d,
    },
    revenue: {
      totalUSD:           totalRevenueUSD,
    },
    streaks: {
      totalClaimers:      totalStreakRecords,
      activeClaimers:     streakClaimedToday,
      totalEarnedUSD:     totalStreakEarned,
      avgCurrentStreak:   Math.round(avgCurrentStreak * 10) / 10,
      payoutsLast30DaysUSD:  streakPayouts._sum.amount  ?? 0,
      payoutsLast30DaysCount: streakPayouts._count,
    },
  };
}

// ── VIP member list ────────────────────────────────────────────────────────────

export async function adminListVipMembers(opts: {
  search?:  string;
  status?:  "active" | "expired" | "all";
  cursor?:  string;
  limit?:   number;
}) {
  const { search, status = "all", cursor, limit = 50 } = opts;
  const now = new Date();

  const where: any = {};

  if (status === "active")  where.AND = [{ isActive: true }, { endsAt: { gt: now } }];
  if (status === "expired") where.OR  = [{ isActive: false }, { endsAt: { lte: now } }];

  // Cursor-based pagination on startedAt desc (cursor = userId, Subscription PK)
  if (cursor) {
    const anchor = await db.subscription.findUnique({ where: { userId: cursor } });
    if (anchor) {
      const existingAnd = where.AND ?? [];
      where.AND = [...(Array.isArray(existingAnd) ? existingAnd : [existingAnd]), {
        startedAt: { lt: anchor.startedAt },
      }];
    }
  }

  // Username / email search — find matching userIds first
  if (search && search.trim()) {
    const term = search.trim();
    const matchingUsers = await db.userProfile.findMany({
      where: {
        OR: [
          { username: { contains: term } },
          { user:     { email: { contains: term } } },
        ],
      },
      select: { userId: true },
      take:   200,
    });
    const ids = matchingUsers.map(u => u.userId);
    if (ids.length === 0) return { items: [], nextCursor: null, hasMore: false };
    const existingAnd = where.AND ?? [];
    where.AND = [...(Array.isArray(existingAnd) ? existingAnd : [existingAnd]), {
      userId: { in: ids },
    }];
  }

  const take = Math.min(limit, 100);
  const rows = await db.subscription.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take:    take + 1,
    include: {
      user: {
        include: {
          profile: { select: { username: true, fullName: true } },
        },
      },
    },
  });

  const hasMore    = rows.length > take;
  const items      = hasMore ? rows.slice(0, take) : rows;
  const nextCursor = hasMore ? items[items.length - 1].userId : null;

  // Fetch streak info for these members in one query
  const userIds     = items.map(r => r.userId);
  const streakRows  = await db.vipStreak.findMany({
    where:  { userId: { in: userIds } },
    select: { userId: true, currentStreak: true, totalEarned: true, lastClaimDate: true },
  });
  const streakMap = Object.fromEntries(streakRows.map(s => [s.userId, s]));

  const mapped = items.map(sub => {
    const streak = streakMap[sub.userId] ?? null;
    const isActiveNow = sub.isActive && sub.endsAt > now;
    return {
      userId:        sub.userId,
      email:         sub.user.email,
      username:      sub.user.profile?.username    ?? sub.user.email,
      fullName:      sub.user.profile?.fullName    ?? null,
      plan:          sub.plan,
      price:         sub.price,
      isActive:      isActiveNow,
      startedAt:     sub.startedAt.toISOString(),
      endsAt:        sub.endsAt.toISOString(),
      cancelledAt:   sub.cancelledAt?.toISOString() ?? null,
      streak: streak ? {
        current:      streak.currentStreak,
        totalEarned:  streak.totalEarned,
        lastClaim:    streak.lastClaimDate?.toISOString() ?? null,
      } : null,
    };
  });

  return { items: mapped, nextCursor, hasMore };
}

// ── VIP member detail ──────────────────────────────────────────────────────────

export async function adminGetVipMemberDetail(userId: string) {
  const [sub, streak, profile] = await Promise.all([
    db.subscription.findUnique({ where: { userId } }),
    db.vipStreak.findUnique({ where: { userId } }),
    db.userProfile.findUnique({
      where:   { userId },
      include: { user: { select: { email: true, createdAt: true } } },
    }),
  ]);

  if (!sub) throw Object.assign(new Error("VIP subscription not found"), { statusCode: 404 });

  const now         = new Date();
  const isActiveNow = sub.isActive && sub.endsAt > now;

  // Streak transaction history (last 30 days)
  const txHistory = await db.transaction.findMany({
    where:   { userId, referenceType: "vip_streak" },
    orderBy: { createdAt: "desc" },
    take:    30,
    select:  { id: true, amount: true, description: true, createdAt: true, metadata: true },
  });

  return {
    userId,
    email:       profile?.user.email    ?? "",
    username:    profile?.username      ?? "",
    fullName:    profile?.fullName      ?? null,
    joinedAt:    profile?.user.createdAt.toISOString() ?? null,
    subscription: {
      plan:         sub.plan,
      price:        sub.price,
      isActive:     isActiveNow,
      startedAt:    sub.startedAt.toISOString(),
      endsAt:       sub.endsAt.toISOString(),
      cancelledAt:  sub.cancelledAt?.toISOString() ?? null,
    },
    streak: streak ? {
      current:      streak.currentStreak,
      totalEarned:  streak.totalEarned,
      lastClaim:    streak.lastClaimDate?.toISOString() ?? null,
    } : null,
    streakHistory: txHistory.map(e => {
      let day: number | null = null;
      try {
        const meta = e.metadata ? JSON.parse(e.metadata as string) : null;
        day = meta?.day ?? null;
      } catch { /* ignore */ }
      return {
        id:          e.id,
        amount:      e.amount,
        description: e.description,
        day,
        claimedAt:   e.createdAt.toISOString(),
      };
    }),
  };
}

// ── VIP Management Actions (require admin.vip.manage) ─────────────────────────

/**
 * Cancel a user's VIP subscription immediately.
 * Sets isActive=false and cancelledAt=now. Does NOT issue a refund.
 * The subscription record is preserved for audit purposes.
 */
export async function adminCancelVipSubscription(userId: string, adminId: string) {
  const sub = await db.subscription.findUnique({ where: { userId } });
  if (!sub) throw Object.assign(new Error("No VIP subscription found for this user"), { statusCode: 404 });

  const now = new Date();
  if (!sub.isActive || sub.endsAt <= now) {
    throw Object.assign(new Error("Subscription is already inactive or expired"), { statusCode: 409 });
  }

  const updated = await db.subscription.update({
    where: { userId },
    data:  { isActive: false, cancelledAt: now },
  });

  return {
    userId,
    isActive:    false,
    cancelledAt: updated.cancelledAt?.toISOString() ?? now.toISOString(),
    cancelledBy: adminId,
  };
}

/**
 * Reset a user's VIP daily streak to 0.
 * Preserves totalEarned for audit; only resets currentStreak and lastClaimDate.
 * Use for support cases where a user's streak became corrupted.
 */
export async function adminResetVipStreak(userId: string, adminId: string) {
  const streak = await db.vipStreak.findUnique({ where: { userId } });
  if (!streak) throw Object.assign(new Error("No streak record found for this user"), { statusCode: 404 });

  await db.vipStreak.update({
    where: { userId },
    data:  { currentStreak: 0, lastClaimDate: null },
  });

  return {
    userId,
    previousStreak: streak.currentStreak,
    newStreak:      0,
    resetBy:        adminId,
  };
}
