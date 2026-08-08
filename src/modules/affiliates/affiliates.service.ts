import { db } from "../../db";

// ── 3-tier downline tree ──────────────────────────────────────────────────────

export async function getAffiliateTree(userId: string) {
  // Tier 1: direct referrals
  const tier1 = await db.referral.findMany({
    where:   { referrerId: userId },
    include: {
      referred: {
        include: {
          profile:      { select: { username: true } },
          subscription: { select: { isActive: true, endsAt: true } },
        },
      },
    },
  });

  const tree = await Promise.all(
    tier1.map(async (r1) => {
      const isVIP1 = !!(r1.referred.subscription?.isActive && r1.referred.subscription.endsAt > new Date());

      // Tier 2: referrals of tier-1 users
      const tier2 = await db.referral.findMany({
        where:   { referrerId: r1.referredId },
        include: {
          referred: {
            include: {
              profile:      { select: { username: true } },
              subscription: { select: { isActive: true, endsAt: true } },
            },
          },
        },
      });

      const tier2Tree = await Promise.all(
        tier2.map(async (r2) => {
          const isVIP2 = !!(r2.referred.subscription?.isActive && r2.referred.subscription.endsAt > new Date());

          // Tier 3: referrals of tier-2 users
          const tier3 = await db.referral.findMany({
            where:   { referrerId: r2.referredId },
            include: {
              referred: {
                include: {
                  profile:      { select: { username: true } },
                  subscription: { select: { isActive: true, endsAt: true } },
                },
              },
            },
          });

          return {
            userId:   r2.referredId,
            username: r2.referred.profile?.username ?? "",
            tier:     2,
            isVIP:    isVIP2,
            isActive: r2.isActive,
            tier3:    tier3.map(r3 => ({
              userId:   r3.referredId,
              username: r3.referred.profile?.username ?? "",
              tier:     3,
              isVIP:    !!(r3.referred.subscription?.isActive && r3.referred.subscription.endsAt > new Date()),
              isActive: r3.isActive,
            })),
          };
        })
      );

      return {
        userId:   r1.referredId,
        username: r1.referred.profile?.username ?? "",
        tier:     1,
        isVIP:    isVIP1,
        isActive: r1.isActive,
        tier2:    tier2Tree,
      };
    })
  );

  return tree;
}

// ── Commission history ─────────────────────────────────────────────────────────

export async function getAffiliateCommissions(userId: string, opts: { cursor?: string; limit?: number }) {
  const { cursor, limit = 50 } = opts;
  const where: any = { beneficiaryId: userId };
  if (cursor) {
    const anchor = await db.affiliateCommission.findUnique({ where: { id: cursor } });
    if (anchor) where.createdAt = { lt: anchor.createdAt };
  }

  const rows = await db.affiliateCommission.findMany({
    where, orderBy: { createdAt: "desc" }, take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const items   = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: items.map(c => ({
      id:           c.id,
      tier:         c.tier,
      eventType:    c.eventType,
      eventRefId:   c.eventRefId,
      grossAmount:  c.grossAmount,
      rate:         c.rate,
      commission:   c.commission,
      status:       c.status,
      createdAt:    c.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? items[items.length - 1].id : null,
    hasMore,
  };
}

// ── Affiliate stats ────────────────────────────────────────────────────────────

export async function getAffiliateStats(userId: string) {
  const commissions = await db.affiliateCommission.findMany({
    where: { beneficiaryId: userId },
  });

  const totalEarned   = commissions.reduce((s, c) => s + c.commission, 0);
  const byEventType   = commissions.reduce<Record<string, number>>((acc, c) => {
    acc[c.eventType] = (acc[c.eventType] ?? 0) + c.commission;
    return acc;
  }, {});
  const byTier        = commissions.reduce<Record<number, number>>((acc, c) => {
    acc[c.tier] = (acc[c.tier] ?? 0) + c.commission;
    return acc;
  }, {});

  return {
    totalCommissions: commissions.length,
    totalEarned:      parseFloat(totalEarned.toFixed(8)),
    byEventType,
    byTier,
  };
}
