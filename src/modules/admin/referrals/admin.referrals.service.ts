/**
 * Admin Referrals Service — read-only visibility into the referral network.
 *
 * Does NOT duplicate any payout logic from referrals.service.ts.
 * Reuses the same DB models for queries only.
 */
import { db } from "../../../db";

// ── Platform-wide referral list ───────────────────────────────────────────────

export async function adminListReferrals(opts: {
  search?:   string;         // filter by referrer or referred username
  rewarded?: boolean;        // filter by reward paid
  cursor?:   string;
  limit?:    number;
}) {
  const { search, rewarded, cursor, limit = 50 } = opts;

  const where: any = {};
  if (rewarded !== undefined) where.referralRewarded = rewarded;

  // Cursor-based pagination on createdAt
  if (cursor) {
    const anchor = await db.referral.findUnique({ where: { id: cursor } });
    if (anchor) where.createdAt = { lt: anchor.createdAt };
  }

  // Username search — find matching user IDs first
  if (search && search.trim()) {
    const term = search.trim();
    const matchingUsers = await db.userProfile.findMany({
      where: { username: { contains: term } },
      select: { userId: true },
      take: 200,
    });
    const ids = matchingUsers.map(u => u.userId);
    where.OR = [
      { referrerId: { in: ids } },
      { referredId: { in: ids } },
    ];
  }

  const rows = await db.referral.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    include: {
      referrer: {
        include: {
          profile:      { select: { username: true } },
          subscription: { select: { isActive: true, endsAt: true } },
        },
      },
      referred: {
        include: {
          profile:      { select: { username: true } },
          subscription: { select: { isActive: true, endsAt: true } },
        },
      },
    },
  });

  const hasMore = rows.length > limit;
  const items   = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: items.map(r => ({
      id:               r.id,
      referrerId:       r.referrerId,
      referrerUsername: r.referrer.profile?.username ?? "",
      referrerIsVIP:    !!(r.referrer.subscription?.isActive && r.referrer.subscription.endsAt > new Date()),
      referredId:       r.referredId,
      referredUsername: r.referred.profile?.username ?? "",
      referredIsVIP:    !!(r.referred.subscription?.isActive && r.referred.subscription.endsAt > new Date()),
      isActive:         r.isActive,
      referralRewarded: r.referralRewarded,
      activatedAt:      r.activatedAt?.toISOString() ?? null,
      rewardedAt:       r.rewardedAt?.toISOString() ?? null,
      joinedAt:         r.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? items[items.length - 1].id : null,
    hasMore,
  };
}

// ── Platform-wide referral statistics ────────────────────────────────────────

export async function adminGetReferralStats() {
  const [total, rewarded, active, bonusRow, rewardTransactions] = await Promise.all([
    db.referral.count(),
    db.referral.count({ where: { referralRewarded: true } }),
    db.referral.count({ where: { isActive: true } }),
    db.systemConfig.findUnique({ where: { key: "referral.bonus_usd" } }),
    db.transaction.aggregate({
      where: { type: "referral_bonus" },
      _sum:  { amount: true },
      _count: true,
    }),
  ]);

  const bonusUSD  = bonusRow ? parseFloat(JSON.parse(bonusRow.value)) : 0.5;
  const totalPaid = rewardTransactions._sum.amount ?? 0;

  // Recent 7 days
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [newReferrals, newRewarded] = await Promise.all([
    db.referral.count({ where: { createdAt: { gte: since } } }),
    db.referral.count({ where: { referralRewarded: true, rewardedAt: { gte: since } } }),
  ]);

  return {
    total,
    rewarded,
    pending:        total - rewarded,
    active,
    bonusUSD,
    totalPaidUSD:   parseFloat(totalPaid.toFixed(4)),
    paymentCount:   rewardTransactions._count,
    last7Days: {
      newReferrals,
      newRewarded,
    },
  };
}

// ── All referral bonus transactions ──────────────────────────────────────────

export async function adminListReferralTransactions(opts: {
  cursor?: string;
  limit?:  number;
}) {
  const { cursor, limit = 50 } = opts;
  const where: any = { type: "referral_bonus" };
  if (cursor) {
    const anchor = await db.transaction.findUnique({ where: { id: cursor } });
    if (anchor) where.createdAt = { lt: anchor.createdAt };
  }

  const rows = await db.transaction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    include: {
      user: { include: { profile: { select: { username: true } } } },
    },
  });

  const hasMore = rows.length > limit;
  const items   = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: items.map(r => ({
      id:          r.id,
      userId:      r.userId,
      username:    r.user?.profile?.username ?? "",
      amount:      r.amount,
      toWallet:    r.toWallet,
      description: r.description,
      referenceId: r.referenceId,
      createdAt:   r.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? items[items.length - 1].id : null,
    hasMore,
  };
}

// ── Referral detail ────────────────────────────────────────────────────────────

export async function adminGetReferralDetail(referralId: string) {
  const r = await db.referral.findUnique({
    where: { id: referralId },
    include: {
      referrer: {
        include: {
          profile:      true,
          subscription: true,
        },
      },
      referred: {
        include: {
          profile:      true,
          subscription: true,
        },
      },
    },
  });
  if (!r) throw Object.assign(new Error("Referral not found"), { statusCode: 404, code: "NOT_FOUND" });

  const referrerWallet = await db.wallet.findFirst({ where: { userId: r.referrerId, walletType: "referral" } });

  return {
    id:               r.id,
    referrerId:       r.referrerId,
    referrerUsername: r.referrer.profile?.username ?? "",
    referrerEmail:    r.referrer.email,
    referredId:       r.referredId,
    referredUsername: r.referred.profile?.username ?? "",
    referredEmail:    r.referred.email,
    referredIsVIP:    !!(r.referred.subscription?.isActive && r.referred.subscription.endsAt > new Date()),
    isActive:         r.isActive,
    referralRewarded: r.referralRewarded,
    activatedAt:      r.activatedAt?.toISOString() ?? null,
    rewardedAt:       r.rewardedAt?.toISOString() ?? null,
    joinedAt:         r.createdAt.toISOString(),
    referrerReferralWalletBalance: referrerWallet?.balance ?? 0,
  };
}
