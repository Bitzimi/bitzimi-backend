/**
 * Admin Analytics Service — Phase 10
 *
 * Provides date-range filtered trend data for all BitZimi modules.
 * All queries use only existing Prisma models — no new database tables.
 *
 * Design:
 *   - fetch minimal fields from DB for the date range
 *   - group into daily buckets in TypeScript (avoids raw SQL)
 *   - generate a complete day series (0-fill missing days)
 */
import { db } from "../../../db";
import { dec } from "../../../utils/dec";

// ── Date helpers ───────────────────────────────────────────────────────────────

export function dayKey(d: Date): string {
  return d.toISOString().split("T")[0]; // "2026-07-13"
}

/** Generate ISO date strings for every day from `from` to `to` inclusive. */
function makeSeries(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cur = new Date(from);
  cur.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(23, 59, 59, 999);
  while (cur <= end) {
    days.push(dayKey(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

/** Bucket an array of items into per-day counts and sums. */
function bucketByDay<T extends object>(
  items: T[],
  getDate: (i: T) => Date,
  getValue: (i: T) => number,
  days: string[]
): Array<{ day: string; value: number; count: number }> {
  const map = new Map(days.map(d => [d, { value: 0, count: 0 }]));
  for (const item of items) {
    const k = dayKey(getDate(item));
    const slot = map.get(k);
    if (slot) { slot.value += getValue(item); slot.count++; }
  }
  return days.map(d => ({ day: d, ...(map.get(d) ?? { value: 0, count: 0 }) }));
}

/** Parse a date range from query params (ISO strings). Falls back to last 30 days. */
export function parseDateRange(from?: string, to?: string): { from: Date; to: Date } {
  const now = new Date();
  const f = from ? new Date(from) : new Date(now.getTime() - 30 * 24 * 3_600_000);
  const t = to   ? new Date(to)   : now;
  const diff = t.getTime() - f.getTime();
  const maxMs = 365 * 24 * 3_600_000;
  return { from: diff > maxMs ? new Date(t.getTime() - maxMs) : f, to: t };
}

// ── Overview — period-scoped summary cards ────────────────────────────────────

export async function getAnalyticsOverview(from: Date, to: Date) {
  const [
    newUsers,
    deposits,
    withdrawals,
    bets,
    proofs,
    kycSubmissions,
    referrals,
    notifications,
    vipSubs,
  ] = await Promise.all([
    db.user.count({ where: { createdAt: { gte: from, lte: to } } }),
    db.deposit.aggregate({
      _sum: { requestedAmount: true },
      _count: { id: true },
      where: { status: "completed", confirmedAt: { gte: from, lte: to } },
    }),
    db.withdrawal.aggregate({
      _sum: { amount: true },
      _count: { id: true },
      where: { status: { in: ["processing", "completed"] }, submittedAt: { gte: from, lte: to } },
    }),
    db.gameBet.aggregate({
      _sum: { amount: true, platformFee: true },
      _count: { id: true },
      where: { settled: true, placedAt: { gte: from, lte: to } },
    }),
    db.taskProof.aggregate({
      _sum: { rewardAmount: true },
      _count: { id: true },
      where: { rewardPaid: true, processedAt: { gte: from, lte: to } },
    }),
    db.kycSubmission.count({ where: { submittedAt: { gte: from, lte: to } } }),
    db.referral.count({ where: { createdAt: { gte: from, lte: to } } }),
    db.notification.count({ where: { createdAt: { gte: from, lte: to } } }),
    db.subscription.count({ where: { startedAt: { gte: from, lte: to } } }),
  ]);

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    users: { new: newUsers },
    financial: {
      deposits: { count: dec((deposits as any)._count?.id), volumeUSD: dec((deposits as any)._sum?.requestedAmount) },
      withdrawals: { count: dec((withdrawals as any)._count?.id), volumeUSD: dec((withdrawals as any)._sum?.amount) },
    },
    games: {
      bets: dec((bets as any)._count?.id),
      wageredUSD: dec((bets as any)._sum?.amount),
      revenueUSD: dec((bets as any)._sum?.platformFee),
    },
    tasks: {
      proofsPaid: dec((proofs as any)._count?.id),
      rewardsUSD: dec((proofs as any)._sum?.rewardAmount),
    },
    kyc: { submissions: kycSubmissions },
    referrals: { new: referrals },
    notifications: { sent: notifications },
    vip: { newSubscriptions: vipSubs },
  };
}

// ── User Analytics ────────────────────────────────────────────────────────────

export async function getUserAnalytics(from: Date, to: Date) {
  const days = makeSeries(from, to);

  const users = (await db.user.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { createdAt: true, suspendedAt: true },
  })) as unknown as Array<{ createdAt: Date; suspendedAt: Date | null }>;

  const registrations = bucketByDay(users, u => u.createdAt, () => 1, days);

  const [totalUsers, verifiedUsers, vipUsers, suspendedUsers] = await Promise.all([
    db.user.count(),
    db.kycSubmission.count({ where: { status: "verified" } }),
    db.subscription.count({ where: { isActive: true, endsAt: { gt: new Date() } } }),
    db.user.count({ where: { suspendedAt: { not: null } } }),
  ]);

  const kycByStatus = (await db.kycSubmission.groupBy({
    by: ["status"],
    _count: { id: true },
  })) as unknown as Array<{ status: string; _count: { id: number } }>;

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    registrations,
    totals: { totalUsers, verifiedUsers, vipUsers, suspendedUsers },
    kycDistribution: kycByStatus.map(r => ({ status: r.status, count: r._count.id })),
  };
}

// ── Financial Analytics ────────────────────────────────────────────────────────

export async function getFinancialAnalytics(from: Date, to: Date) {
  const days = makeSeries(from, to);

  const [depositRows, withdrawalRows] = await Promise.all([
    db.deposit.findMany({
      where: { status: "completed", confirmedAt: { gte: from, lte: to } },
      select: { confirmedAt: true, requestedAmount: true },
    }),
    db.withdrawal.findMany({
      where: { submittedAt: { gte: from, lte: to } },
      select: { submittedAt: true, amount: true, status: true },
    }),
  ]) as [
    Array<{ confirmedAt: Date | null; requestedAmount: any }>,
    Array<{ submittedAt: Date; amount: any; status: string }>,
  ];

  const deposits = bucketByDay(
    depositRows.filter(d => d.confirmedAt !== null) as Array<{ confirmedAt: Date; requestedAmount: any }>,
    d => d.confirmedAt,
    d => dec(d.requestedAmount),
    days
  );

  const withdrawals = bucketByDay(
    withdrawalRows,
    w => w.submittedAt,
    w => dec(w.amount),
    days
  );

  const depositsByStatus = (await db.deposit.groupBy({
    by: ["status"],
    _count: { id: true },
    where: { createdAt: { gte: from, lte: to } },
  })) as unknown as Array<{ status: string; _count: { id: number } }>;

  const withdrawalsByStatus = (await db.withdrawal.groupBy({
    by: ["status"],
    _count: { id: true },
    where: { submittedAt: { gte: from, lte: to } },
  })) as unknown as Array<{ status: string; _count: { id: number } }>;

  const depositsByMethod = (await db.deposit.groupBy({
    by: ["paymentMethod"],
    _count: { id: true },
    _sum: { requestedAmount: true },
    where: { status: "completed", confirmedAt: { gte: from, lte: to } },
  })) as unknown as Array<{ paymentMethod: string; _count: { id: number }; _sum: { requestedAmount: any } }>;

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    deposits,
    withdrawals,
    depositsByStatus: depositsByStatus.map(r => ({ status: r.status, count: r._count.id })),
    withdrawalsByStatus: withdrawalsByStatus.map(r => ({ status: r.status, count: r._count.id })),
    depositsByMethod: depositsByMethod.map(r => ({
      method: r.paymentMethod,
      count: r._count.id,
      volumeUSD: dec(r._sum.requestedAmount),
    })),
  };
}

// ── Revenue Analytics ──────────────────────────────────────────────────────────

export async function getRevenueAnalytics(from: Date, to: Date) {
  const days = makeSeries(from, to);

  const [gameBetRows, vipSubRows, commissionRows] = await Promise.all([
    db.gameBet.findMany({
      where: { settled: true, placedAt: { gte: from, lte: to } },
      select: { placedAt: true, platformFee: true },
    }),
    db.subscription.findMany({
      where: { startedAt: { gte: from, lte: to } },
      select: { startedAt: true, price: true },
    }),
    db.affiliateCommission.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { createdAt: true, commission: true },
    }),
  ]) as [
    Array<{ placedAt: Date; platformFee: any }>,
    Array<{ startedAt: Date; price: any }>,
    Array<{ createdAt: Date; commission: any }>,
  ];

  const gameFees      = bucketByDay(gameBetRows,    r => r.placedAt,   r => dec(r.platformFee), days);
  const vipRevenue    = bucketByDay(vipSubRows,     r => r.startedAt,  r => dec(r.price),       days);
  const affiliateCosts = bucketByDay(commissionRows, r => r.createdAt,  r => dec(r.commission),  days);

  const netRevenue = days.map((d, i) => ({
    day: d,
    gameFees:       gameFees[i]?.value       ?? 0,
    vipRevenue:     vipRevenue[i]?.value     ?? 0,
    affiliateCosts: affiliateCosts[i]?.value ?? 0,
    net: (gameFees[i]?.value ?? 0) + (vipRevenue[i]?.value ?? 0) - (affiliateCosts[i]?.value ?? 0),
  }));

  const totals = {
    gameFees:       gameBetRows.reduce((s, r) => s + dec(r.platformFee), 0),
    vipRevenue:     vipSubRows.reduce((s, r) => s + dec(r.price), 0),
    affiliateCosts: commissionRows.reduce((s, r) => s + dec(r.commission), 0),
  };

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    netRevenue,
    totals: { ...totals, net: totals.gameFees + totals.vipRevenue - totals.affiliateCosts },
  };
}

// ── Game Analytics ─────────────────────────────────────────────────────────────

export async function getGameAnalytics(from: Date, to: Date) {
  const days = makeSeries(from, to);

  const betRows = (await db.gameBet.findMany({
    where: { settled: true, placedAt: { gte: from, lte: to } },
    select: { placedAt: true, amount: true, payout: true, platformFee: true, outcome: true },
  })) as unknown as Array<{ placedAt: Date; amount: any; payout: any; platformFee: any; outcome: string | null }>;

  const betsPerDay    = bucketByDay(betRows, r => r.placedAt, ()        => 1,              days);
  const wageredPerDay = bucketByDay(betRows, r => r.placedAt, r => dec(r.amount),          days);
  const revenuePerDay = bucketByDay(betRows, r => r.placedAt, r => dec(r.platformFee),     days);

  const roundsByType = (await db.gameRound.groupBy({
    by: ["gameType"],
    _count: { id: true },
    where: { status: "completed", settledAt: { gte: from, lte: to } },
    orderBy: { _count: { id: "desc" } },
  })) as unknown as Array<{ gameType: string; _count: { id: number } }>;

  const wins   = betRows.filter(b => b.outcome === "win").length;
  const losses = betRows.filter(b => b.outcome === "loss").length;
  const draws  = betRows.filter(b => b.outcome === "draw").length;

  const combined = days.map((d, i) => ({
    day: d,
    bets:    betsPerDay[i]?.count   ?? 0,
    wagered: wageredPerDay[i]?.value ?? 0,
    revenue: revenuePerDay[i]?.value ?? 0,
  }));

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    combined,
    byGameType: roundsByType.map(r => ({ gameType: r.gameType, rounds: r._count.id })),
    outcomes: { wins, losses, draws },
    totals: {
      bets:    betRows.length,
      wagered: betRows.reduce((s, b) => s + dec(b.amount), 0),
      paid:    betRows.reduce((s, b) => s + dec(b.payout), 0),
      revenue: betRows.reduce((s, b) => s + dec(b.platformFee), 0),
    },
  };
}

// ── Task Analytics ─────────────────────────────────────────────────────────────

export async function getTaskAnalytics(from: Date, to: Date) {
  const days = makeSeries(from, to);

  const [proofRows, taskRows] = await Promise.all([
    db.taskProof.findMany({
      where: { submittedAt: { gte: from, lte: to } },
      select: { submittedAt: true, status: true, rewardAmount: true, rewardPaid: true },
    }),
    db.task.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { createdAt: true, status: true, type: true, totalBudget: true },
    }),
  ]) as [
    Array<{ submittedAt: Date; status: string; rewardAmount: any; rewardPaid: boolean }>,
    Array<{ createdAt: Date; status: string; type: string; totalBudget: any }>,
  ];

  const proofsPerDay   = bucketByDay(proofRows, p => p.submittedAt, () => 1, days);
  const rewardsPerDay  = bucketByDay(
    proofRows.filter(p => p.rewardPaid),
    p => p.submittedAt,
    p => dec(p.rewardAmount),
    days
  );
  const tasksCreated   = bucketByDay(taskRows, t => t.createdAt, () => 1, days);

  const proofsByStatus = proofRows.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});

  const tasksByType = taskRows.reduce<Record<string, number>>((acc, t) => {
    acc[t.type] = (acc[t.type] ?? 0) + 1;
    return acc;
  }, {});

  const combined = days.map((d, i) => ({
    day: d,
    proofs:       proofsPerDay[i]?.count   ?? 0,
    rewards:      rewardsPerDay[i]?.value  ?? 0,
    tasksCreated: tasksCreated[i]?.count   ?? 0,
  }));

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    combined,
    proofsByStatus: Object.entries(proofsByStatus).map(([status, count]) => ({ status, count })),
    tasksByType: Object.entries(tasksByType).map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    totals: {
      proofs:       proofRows.length,
      approved:     proofRows.filter(p => ["approved", "admin_approved"].includes(p.status)).length,
      rewardsPaid:  proofRows.filter(p => p.rewardPaid).reduce((s, p) => s + dec(p.rewardAmount), 0),
      tasksCreated: taskRows.length,
    },
  };
}

// ── KYC Analytics ─────────────────────────────────────────────────────────────

export async function getKycAnalytics(from: Date, to: Date) {
  const days = makeSeries(from, to);

  const submissions = (await db.kycSubmission.findMany({
    where: { submittedAt: { gte: from, lte: to } },
    select: { submittedAt: true, status: true, reviewedAt: true },
  })) as unknown as Array<{ submittedAt: Date | null; status: string; reviewedAt: Date | null }>;

  const submissionsPerDay = bucketByDay(
    submissions.filter(s => s.submittedAt !== null) as Array<{ submittedAt: Date; status: string; reviewedAt: Date | null }>,
    s => s.submittedAt,
    () => 1,
    days
  );

  const reviewsPerDay = bucketByDay(
    submissions.filter(s => s.reviewedAt !== null) as Array<{ submittedAt: Date | null; status: string; reviewedAt: Date }>,
    s => s.reviewedAt,
    () => 1,
    days
  );

  const combined = days.map((d, i) => ({
    day: d,
    submitted: submissionsPerDay[i]?.count ?? 0,
    reviewed:  reviewsPerDay[i]?.count     ?? 0,
  }));

  const allKyc = (await db.kycSubmission.groupBy({
    by: ["status"],
    _count: { id: true },
  })) as unknown as Array<{ status: string; _count: { id: number } }>;

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    combined,
    statusDistribution: allKyc.map(r => ({ status: r.status, count: r._count.id })),
    totals: {
      submitted: submissions.length,
      verified:  submissions.filter(s => s.status === "verified").length,
      rejected:  submissions.filter(s => s.status === "rejected").length,
      pending:   submissions.filter(s => ["pending", "under_review"].includes(s.status)).length,
    },
  };
}

// ── Notification Analytics ────────────────────────────────────────────────────

export async function getNotificationAnalytics(from: Date, to: Date) {
  const days = makeSeries(from, to);

  const notifications = (await db.notification.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { createdAt: true, type: true, read: true },
  })) as unknown as Array<{ createdAt: Date; type: string; read: boolean }>;

  const sentPerDay = bucketByDay(notifications,                               n => n.createdAt, () => 1, days);
  const readPerDay = bucketByDay(notifications.filter(n => n.read), n => n.createdAt, () => 1, days);

  const combined = days.map((d, i) => ({
    day:  d,
    sent: sentPerDay[i]?.count ?? 0,
    read: readPerDay[i]?.count ?? 0,
  }));

  const byType = notifications.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1;
    return acc;
  }, {});

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    combined,
    byType: Object.entries(byType).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    totals: {
      sent:   notifications.length,
      read:   notifications.filter(n => n.read).length,
      unread: notifications.filter(n => !n.read).length,
    },
  };
}

// ── Referral Analytics ────────────────────────────────────────────────────────

export async function getReferralAnalytics(from: Date, to: Date) {
  const days = makeSeries(from, to);

  const [referrals, commissions] = await Promise.all([
    db.referral.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { createdAt: true, isActive: true, referralRewarded: true },
    }),
    db.affiliateCommission.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { createdAt: true, commission: true, tier: true, eventType: true },
    }),
  ]) as [
    Array<{ createdAt: Date; isActive: boolean; referralRewarded: boolean }>,
    Array<{ createdAt: Date; commission: any; tier: number; eventType: string }>,
  ];

  const referralsPerDay   = bucketByDay(referrals,   r => r.createdAt, ()             => 1,            days);
  const commissionsPerDay = bucketByDay(commissions, c => c.createdAt, c => dec(c.commission), days);

  const combined = days.map((d, i) => ({
    day:         d,
    referrals:   referralsPerDay[i]?.count   ?? 0,
    commissions: commissionsPerDay[i]?.value ?? 0,
  }));

  const byTier = commissions.reduce<Record<number, number>>((acc, c) => {
    acc[c.tier] = (acc[c.tier] ?? 0) + dec(c.commission);
    return acc;
  }, {});

  const byEventType = commissions.reduce<Record<string, number>>((acc, c) => {
    acc[c.eventType] = (acc[c.eventType] ?? 0) + dec(c.commission);
    return acc;
  }, {});

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    combined,
    byTier:      Object.entries(byTier).map(([tier, total]) => ({ tier: Number(tier), total })),
    byEventType: Object.entries(byEventType).map(([eventType, total]) => ({ eventType, total })),
    totals: {
      referrals:       referrals.length,
      active:          referrals.filter(r => r.isActive).length,
      rewarded:        referrals.filter(r => r.referralRewarded).length,
      commissionsUSD:  commissions.reduce((s, c) => s + dec(c.commission), 0),
    },
  };
}
