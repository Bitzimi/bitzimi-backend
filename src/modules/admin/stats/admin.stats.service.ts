/**
 * Admin Stats Service — platform-wide KPI aggregation.
 *
 * Phase 2: significantly expanded to cover games, revenue, tasks, referrals,
 * VIP, and affiliate metrics in addition to the Phase 1 basics.
 */
import { db } from "../../../db";
import { dec } from "../../../utils/dec";

export async function getAdminStats() {
  const weekAgo  = new Date(Date.now() - 7  * 24 * 3_600_000);
  const monthAgo = new Date(Date.now() - 30 * 24 * 3_600_000);

  // ── Parallel batch 1: counts ─────────────────────────────────────────────────
  const [
    totalUsers,
    verifiedUsers,
    vipUsers,
    suspendedUsers,
    newUsersThisWeek,
    pendingKyc,
    activeTasks,
    pendingTasks,
    completedTasks,
    proofQueue,
    totalProofsApproved,
    pendingWithdrawals,
    pendingDeposits,
    totalTransactions,
    activeGameRounds,
    totalReferrals,
    rewardedReferrals,
    totalNotifications,
  ] = await Promise.all([
    db.user.count(),
    db.kycSubmission.count({ where: { status: "verified" } }),
    db.subscription.count({ where: { isActive: true, endsAt: { gt: new Date() } } }),
    db.user.count({ where: { suspendedAt: { not: null } } }),
    db.user.count({ where: { createdAt: { gte: weekAgo } } }),
    db.kycSubmission.count({ where: { status: { in: ["pending", "under_review"] } } }),
    db.task.count({ where: { status: "active" } }),
    db.task.count({ where: { status: "pending_review" } }),
    db.task.count({ where: { status: "completed" } }),
    db.adminProofReview.count({ where: { decision: null } }),
    db.taskProof.count({ where: { status: { in: ["approved", "admin_approved"] } } }),
    db.withdrawal.count({ where: { status: "submitted" } }),
    db.deposit.count({ where: { status: "pending", expiresAt: { gt: new Date() } } }),
    db.transaction.count(),
    db.gameRound.count({ where: { status: { in: ["waiting", "countdown", "spinning", "result"] } } }),
    db.referral.count(),
    db.referral.count({ where: { referralRewarded: true } }),
    db.notification.count(),
  ]);

  // ── Parallel batch 2: aggregates ─────────────────────────────────────────────
  const [
    withdrawalVolume,
    depositVolume,
    gameBetAggregates,
    gameRevenueAgg,
    taskRewardsAgg,
    affiliateCommAgg,
    vipRevenueAgg,
    newWithdrawalsThisWeek,
    newDepositsThisWeek,
  ] = await Promise.all([
    db.withdrawal.aggregate({ _sum: { amount: true, netAmount: true }, where: { status: { not: "rejected" } } }),
    db.deposit.aggregate({ _sum: { requestedAmount: true }, where: { status: "completed" } }),
    db.gameBet.aggregate({ _sum: { amount: true, payout: true, platformFee: true }, _count: { id: true }, where: { settled: true } }),
    db.gameBet.aggregate({ _sum: { platformFee: true }, where: { settled: true, platformFee: { gt: 0 } } }),
    db.taskProof.aggregate({ _sum: { rewardAmount: true }, where: { rewardPaid: true } }),
    db.affiliateCommission.aggregate({ _sum: { commission: true }, _count: { id: true } }),
    db.subscription.aggregate({ _sum: { price: true }, where: { isActive: true } }),
    db.withdrawal.count({ where: { submittedAt: { gte: weekAgo } } }),
    db.deposit.count({ where: { createdAt: { gte: weekAgo } } }),
  ]);

  // ── Game type breakdown ───────────────────────────────────────────────────────
  const gameTypeStats = await db.gameRound.groupBy({
    by: ["gameType"],
    _count: { id: true },
    where: { status: "completed" },
    orderBy: { _count: { id: "desc" } },
  });

  const totalWagered    = dec(gameBetAggregates._sum.amount);
  const totalPaidOut    = dec(gameBetAggregates._sum.payout);
  const gameFeeRevenue  = dec(gameRevenueAgg._sum.platformFee);
  const totalBets       = gameBetAggregates._count.id;

  return {
    users: {
      total:           totalUsers,
      verified:        verifiedUsers,
      vip:             vipUsers,
      suspended:       suspendedUsers,
      newThisWeek:     newUsersThisWeek,
      unverified:      totalUsers - verifiedUsers,
    },
    kyc: {
      pendingReview:   pendingKyc,
    },
    tasks: {
      active:          activeTasks,
      pendingApproval: pendingTasks,
      completed:       completedTasks,
      proofQueue,
      totalProofsApproved,
      rewardsPaidUSD:  dec(taskRewardsAgg._sum.rewardAmount),
    },
    financial: {
      pendingWithdrawals,
      pendingDeposits,
      totalWithdrawalVolume: dec(withdrawalVolume._sum.amount),
      totalDepositVolume:    dec(depositVolume._sum.requestedAmount),
      totalTransactions,
      newWithdrawalsThisWeek,
      newDepositsThisWeek,
    },
    games: {
      activeRounds:    activeGameRounds,
      totalBets,
      totalWagered,
      totalPaidOut,
      gameFeeRevenue,
      gameTypeBreakdown: gameTypeStats.map(g => ({
        gameType: g.gameType,
        rounds:   g._count.id,
      })),
    },
    revenue: {
      gameFees:          gameFeeRevenue,
      taskRewardsPaid:   dec(taskRewardsAgg._sum.rewardAmount),
      affiliateCommissions: dec(affiliateCommAgg._sum.commission),
      vipSubscriptions:  dec(vipRevenueAgg._sum.price),
      // Net platform revenue = game fees - affiliate commissions paid
      netGameRevenue:    Math.max(0, gameFeeRevenue - dec(affiliateCommAgg._sum.commission)),
    },
    referrals: {
      total:             totalReferrals,
      rewarded:          rewardedReferrals,
      affiliateCommissionsCount:  affiliateCommAgg._count.id,
      affiliateCommissionsTotal:  dec(affiliateCommAgg._sum.commission),
    },
    notifications: {
      total:             totalNotifications,
    },
  };
}

export async function getAuditLog(opts: { cursor?: string; limit?: number; actorId?: string; targetType?: string }) {
  const { cursor, limit = 50, actorId, targetType } = opts;
  const where: any = {};
  if (actorId)    where.actorId    = actorId;
  if (targetType) where.targetType = targetType;
  if (cursor) {
    const anchor = await db.auditLog.findUnique({ where: { id: cursor } });
    if (anchor) where.createdAt = { lt: anchor.createdAt };
  }

  const rows = await db.auditLog.findMany({
    where, orderBy: { createdAt: "desc" }, take: limit + 1,
    include: { actor: { include: { profile: { select: { username: true } } } } },
  });
  const hasMore = rows.length > limit;
  const items   = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: items.map(r => ({
      id:         r.id,
      actorId:    r.actorId,
      actorName:  r.actor?.profile?.username ?? null,
      action:     r.action,
      targetType: r.targetType,
      targetId:   r.targetId,
      ipAddress:  r.ipAddress,
      metadata:   r.metadata ? (() => { try { return JSON.parse(r.metadata as string); } catch { return null; } })() : null,
      httpStatus: r.httpStatus ?? null,
      createdAt:  r.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? items[items.length - 1].id : null,
    hasMore,
  };
}

// ── Recent platform activity — last N significant transactions / events ─────────
// Used by the Dashboard "Recent Activity" feed. Sources from Transaction table
// which covers deposits, withdrawals, game wins, task rewards, referral bonuses.

const ACTIVITY_ICONS: Record<string, string> = {
  deposit:              "💰",
  withdrawal:           "📤",
  transfer:             "↔️",
  game_win:             "🏆",
  game_bet:             "🎮",
  game_loss:            "🎮",
  task_reward:          "✅",
  referral_bonus:       "👥",
  referral_earned:      "👥",
  vip_purchase:         "👑",
  affiliate_commission: "💎",
  commission:           "💎",
  streak_reward:        "🔥",
};

export async function getRecentActivity(limit = 8) {
  const rows = await db.transaction.findMany({
    where:   { status: "completed" },
    orderBy: { createdAt: "desc" },
    take:    limit,
    select: {
      id:        true,
      type:      true,
      amount:    true,
      createdAt: true,
      user: { select: { profile: { select: { username: true } } } },
    },
  });

  return rows.map(r => ({
    id:        r.id,
    type:      r.type,
    icon:      ACTIVITY_ICONS[r.type] ?? "📊",
    username:  r.user?.profile?.username ?? "User",
    amount:    dec(r.amount),
    createdAt: r.createdAt.toISOString(),
  }));
}

// ── Platform health status — checks real system state ──────────────────────────

export async function getHealthStatus() {
  const dbStart  = Date.now();
  let   dbOk     = false;
  let   dbLatency = 0;
  let   totalRecords = 0;

  try {
    const [userCount] = await Promise.all([
      db.user.count(),
    ]);
    dbOk       = true;
    dbLatency  = Date.now() - dbStart;
    totalRecords = userCount;
  } catch { /* db unavailable */ }

  // Queue depths from the database
  const [
    pendingWithdrawals,
    pendingDeposits,
    pendingKyc,
    pendingProofs,
    pendingTasks,
    activeGameRounds,
  ] = await Promise.all([
    db.withdrawal.count({ where: { status: "submitted" } }),
    db.deposit.count({ where: { status: "pending", expiresAt: { gt: new Date() } } }),
    db.kycSubmission.count({ where: { status: { in: ["pending", "under_review"] } } }),
    db.adminProofReview.count({ where: { decision: null } }),
    db.task.count({ where: { status: "pending_review" } }),
    db.gameRound.count({ where: { status: { in: ["waiting","countdown","spinning","result"] } } }),
  ]).catch(() => [0, 0, 0, 0, 0, 0]);

  // Background jobs (static registry — we know which jobs exist)
  const backgroundJobs = [
    { name: "Withdrawal Limit Reset",  description: "Resets daily/monthly limits at midnight UTC",  status: "running" },
    { name: "Screenshot Retention",    description: "Deletes task screenshots older than 60 days",  status: "running" },
    { name: "Streak Reminder",         description: "Sends VIP streak reminder notifications",       status: "running" },
    { name: "Crypto Deposit Monitor",  description: "Polls BSC RPC for USDT deposits",              status: process.env.CRYPTO_MONITOR_ENABLED === "true" ? "running" : "disabled" },
  ];

  return {
    database: {
      status:      dbOk ? "operational" : "error",
      latencyMs:   dbLatency,
    },
    queues: {
      pendingWithdrawals,
      pendingDeposits,
      pendingKyc,
      pendingProofs,
      pendingTasks,
      activeGameRounds,
    },
    backgroundJobs,
    timestamp: new Date().toISOString(),
  };
}
