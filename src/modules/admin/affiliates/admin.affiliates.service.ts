/**
 * Admin Affiliates Service — affiliate application management + commission visibility.
 *
 * Application CRUD delegates to affiliates.application.service.ts (no duplication).
 * Commission queries read directly from AffiliateCommission and CommissionJob.
 */
import { db } from "../../../db";
import {
  listAffiliateApplications,
  approveAffiliateApplication,
  rejectAffiliateApplication,
} from "../../affiliates/affiliates.application.service";

// Re-export application management — no new logic, just wiring admin routes to service
export { listAffiliateApplications, approveAffiliateApplication, rejectAffiliateApplication };

// ── Platform-wide affiliate statistics ────────────────────────────────────────

export async function adminGetAffiliateStats() {
  const [
    totalApplications,
    pendingApplications,
    approvedApplications,
    rejectedApplications,
    totalCommissions,
    commissionSum,
    commissionsByEvent,
    commissionsByTier,
    jobStats,
  ] = await Promise.all([
    db.affiliateApplication.count(),
    db.affiliateApplication.count({ where: { status: "pending" } }),
    db.affiliateApplication.count({ where: { status: "approved" } }),
    db.affiliateApplication.count({ where: { status: "rejected" } }),
    db.affiliateCommission.count(),
    db.affiliateCommission.aggregate({ _sum: { commission: true } }),
    db.affiliateCommission.groupBy({
      by: ["eventType"],
      _sum: { commission: true },
      _count: true,
    }),
    db.affiliateCommission.groupBy({
      by: ["tier"],
      _sum: { commission: true },
      _count: true,
    }),
    db.commissionJob.groupBy({ by: ["status"], _count: true }),
  ]);

  const totalEarned = commissionSum._sum.commission ?? 0;

  // Last 7 days
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [newApplications, newCommissions, recentEarned] = await Promise.all([
    db.affiliateApplication.count({ where: { submittedAt: { gte: since } } }),
    db.affiliateCommission.count({ where: { createdAt: { gte: since } } }),
    db.affiliateCommission.aggregate({
      where: { createdAt: { gte: since } },
      _sum: { commission: true },
    }),
  ]);

  return {
    applications: {
      total:    totalApplications,
      pending:  pendingApplications,
      approved: approvedApplications,
      rejected: rejectedApplications,
    },
    commissions: {
      total:        totalCommissions,
      totalEarnedUSD: parseFloat(totalEarned.toFixed(4)),
      byEventType:  commissionsByEvent.map(r => ({
        eventType:  r.eventType,
        count:      r._count,
        totalUSD:   parseFloat((r._sum.commission ?? 0).toFixed(4)),
      })),
      byTier: commissionsByTier.map(r => ({
        tier:     r.tier,
        count:    r._count,
        totalUSD: parseFloat((r._sum.commission ?? 0).toFixed(4)),
      })),
    },
    jobQueue: Object.fromEntries(jobStats.map(j => [j.status, j._count])),
    last7Days: {
      newApplications,
      newCommissions,
      earnedUSD: parseFloat((recentEarned._sum.commission ?? 0).toFixed(4)),
    },
  };
}

// ── Platform-wide commission list ────────────────────────────────────────────

export async function adminListAffiliateCommissions(opts: {
  eventType?:    string;
  tier?:         number;
  beneficiaryId?: string;
  sourceUserId?:  string;
  cursor?:        string;
  limit?:         number;
}) {
  const { eventType, tier, beneficiaryId, sourceUserId, cursor, limit = 50 } = opts;

  const where: any = {};
  if (eventType)     where.eventType     = eventType;
  if (tier)          where.tier          = tier;
  if (beneficiaryId) where.beneficiaryId = beneficiaryId;
  if (sourceUserId)  where.sourceUserId  = sourceUserId;
  if (cursor) {
    const anchor = await db.affiliateCommission.findUnique({ where: { id: cursor } });
    if (anchor) where.createdAt = { lt: anchor.createdAt };
  }

  const rows = await db.affiliateCommission.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take:    limit + 1,
    include: {
      beneficiary: { include: { profile: { select: { username: true } } } },
    },
  });

  const hasMore = rows.length > limit;
  const items   = hasMore ? rows.slice(0, limit) : rows;

  // Batch-fetch source usernames
  const sourceIds  = [...new Set(items.map(c => c.sourceUserId))];
  const srcProfiles = await db.userProfile.findMany({
    where:  { userId: { in: sourceIds } },
    select: { userId: true, username: true },
  });
  const srcMap = Object.fromEntries(srcProfiles.map(p => [p.userId, p.username ?? ""]));

  return {
    items: items.map(c => ({
      id:                  c.id,
      beneficiaryId:       c.beneficiaryId,
      beneficiaryUsername: c.beneficiary.profile?.username ?? "",
      sourceUserId:        c.sourceUserId,
      sourceUsername:      srcMap[c.sourceUserId] ?? "",
      tier:                c.tier,
      eventType:           c.eventType,
      eventRefId:          c.eventRefId,
      grossAmount:         c.grossAmount,
      rate:                c.rate,
      commission:          c.commission,
      status:              c.status,
      createdAt:           c.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? items[items.length - 1].id : null,
    hasMore,
  };
}

// ── Top earners (users sorted by total affiliate commission) ─────────────────

export async function adminGetTopAffiliateEarners(limit = 20) {
  const rows = await db.affiliateCommission.groupBy({
    by:      ["beneficiaryId"],
    _sum:    { commission: true },
    _count:  true,
    orderBy: { _sum: { commission: "desc" } },
    take:    limit,
  });

  const userIds = rows.map(r => r.beneficiaryId);
  const profiles = await db.userProfile.findMany({
    where:  { userId: { in: userIds } },
    select: { userId: true, username: true },
  });
  const profileMap = Object.fromEntries(profiles.map(p => [p.userId, p.username]));

  return rows.map(r => ({
    userId:      r.beneficiaryId,
    username:    profileMap[r.beneficiaryId] ?? "",
    totalEarned: parseFloat((r._sum.commission ?? 0).toFixed(4)),
    commissions: r._count,
  }));
}

// ── Commission job queue status ───────────────────────────────────────────────

export async function adminGetCommissionJobs(opts: { status?: string; cursor?: string; limit?: number }) {
  const { status, cursor, limit = 50 } = opts;
  const where: any = {};
  if (status) where.status = status;
  if (cursor) {
    const anchor = await db.commissionJob.findUnique({ where: { id: cursor } });
    if (anchor) where.createdAt = { lt: anchor.createdAt };
  }

  const rows = await db.commissionJob.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take:    limit + 1,
  });

  const hasMore = rows.length > limit;
  const items   = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: items.map(j => {
      let payload: any = {};
      try { payload = JSON.parse(j.payload); } catch { /* ignore */ }
      return {
        id:           j.id,
        jobType:      j.jobType,
        status:       j.status,
        attempts:     j.attempts,
        maxAttempts:  j.maxAttempts,
        eventType:    payload.eventType ?? null,
        sourceUserId: payload.sourceUserId ?? payload.referredUserId ?? null,
        grossAmount:  payload.grossAmount ?? null,
        errorMessage: j.errorMessage,
        createdAt:    j.createdAt.toISOString(),
        processedAt:  j.processedAt?.toISOString() ?? null,
      };
    }),
    nextCursor: hasMore ? items[items.length - 1].id : null,
    hasMore,
  };
}

// ── Daily commission analytics (last 30 days) ────────────────────────────────

export async function adminGetCommissionAnalytics() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // SQLite stores Prisma DateTime as integer milliseconds — use unixepoch modifier
  const daily = await db.$queryRaw<Array<{ day: string; total: number; count: bigint }>>`
    SELECT
      strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') as day,
      SUM(commission) as total,
      COUNT(*)        as count
    FROM affiliate_commissions
    WHERE created_at >= ${since.getTime()}
    GROUP BY strftime('%Y-%m-%d', created_at / 1000, 'unixepoch')
    ORDER BY day ASC
  `;

  const weekly = await db.$queryRaw<Array<{ week: string; total: number; count: bigint }>>`
    SELECT
      strftime('%Y-W%W', created_at / 1000, 'unixepoch') as week,
      SUM(commission) as total,
      COUNT(*)        as count
    FROM affiliate_commissions
    WHERE created_at >= ${new Date(Date.now() - 12 * 7 * 24 * 60 * 60 * 1000).getTime()}
    GROUP BY strftime('%Y-%m-%d', created_at / 1000, 'unixepoch')
    ORDER BY week ASC
  `;

  return {
    daily:  daily.map(r => ({ day: r.day, total: Number(r.total), count: Number(r.count) })),
    weekly: weekly.map(r => ({ week: r.week, total: Number(r.total), count: Number(r.count) })),
  };
}
