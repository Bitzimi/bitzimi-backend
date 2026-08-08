/**
 * Security & Audit Service — Phase 15
 *
 * Provides all security monitoring, audit log access, session management,
 * IP controls, login history, and fraud detection for the admin panel.
 *
 * Backend is the single source of truth. No frontend-generated data.
 * No AI. No internet. No external APIs.
 */

import { db } from "../../../db";
import { parseUserAgent } from "./userAgentParser";

// ─── Audit Log ────────────────────────────────────────────────────────────────

export interface AuditLogQuery {
  cursor?:     string;
  limit?:      number;
  actorId?:    string;
  targetType?: string;
  action?:     string;
  ipAddress?:  string;
  from?:       string;
  to?:         string;
}

export async function getAuditLogs(opts: AuditLogQuery) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const where: Record<string, unknown> = {};

  if (opts.actorId)    where.actorId    = opts.actorId;
  if (opts.targetType) where.targetType = opts.targetType;
  if (opts.ipAddress)  where.ipAddress  = opts.ipAddress;
  if (opts.action)     where.action     = { contains: opts.action };

  if (opts.from || opts.to) {
    where.createdAt = {
      ...(opts.from ? { gte: new Date(opts.from) } : {}),
      ...(opts.to   ? { lte: new Date(opts.to) }   : {}),
    };
  }

  const items = await db.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take:    limit + 1,
    cursor:  opts.cursor ? { id: opts.cursor } : undefined,
    skip:    opts.cursor ? 1 : 0,
    include: {
      actor: { select: { id: true, email: true, role: true, profile: { select: { username: true } } } },
    },
  });

  const hasMore = items.length > limit;
  const page    = hasMore ? items.slice(0, limit) : items;

  return {
    items:      page.map(row => ({
      id:            row.id,
      actorId:       row.actorId,
      actorEmail:    row.actor?.email   ?? null,
      actorUsername: row.actor?.profile?.username ?? null,
      actorRole:     row.actor?.role    ?? null,
      action:        row.action,
      targetType:    row.targetType,
      targetId:      row.targetId,
      ipAddress:     row.ipAddress,
      userAgent:     row.userAgent,
      metadata:      row.metadata ? tryParse(row.metadata) : null,
      previousValue: row.previousValue ? tryParse(row.previousValue) : null,
      newValue:      row.newValue      ? tryParse(row.newValue)      : null,
      httpStatus:    row.httpStatus,
      createdAt:     row.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    hasMore,
  };
}

// ─── Audit Log Export ─────────────────────────────────────────────────────────

export async function exportAuditLogs(opts: { from?: string; to?: string; format?: string }) {
  const where: Record<string, unknown> = {};
  if (opts.from || opts.to) {
    where.createdAt = {
      ...(opts.from ? { gte: new Date(opts.from) } : {}),
      ...(opts.to   ? { lte: new Date(opts.to) }   : {}),
    };
  }

  const rows = await db.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take:    10_000,
    include: {
      actor: { select: { email: true, role: true, profile: { select: { username: true } } } },
    },
  });

  return rows.map(r => ({
    id:        r.id,
    timestamp: r.createdAt.toISOString(),
    actor:     r.actor?.email ?? r.actorId ?? "system",
    role:      r.actor?.role  ?? "unknown",
    action:    r.action,
    target:    r.targetType ? `${r.targetType}:${r.targetId ?? ""}` : null,
    ip:        r.ipAddress,
    status:    r.httpStatus,
    metadata:  r.metadata,
  }));
}

// ─── Security Events ──────────────────────────────────────────────────────────

export interface SecurityEventQuery {
  cursor?:   string;
  limit?:    number;
  type?:     string;
  severity?: string;
  resolved?: boolean;
  from?:     string;
  to?:       string;
}

export async function getSecurityEvents(opts: SecurityEventQuery) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const where: Record<string, unknown> = {};

  if (opts.type)                        where.type     = opts.type;
  if (opts.severity)                    where.severity = opts.severity;
  if (opts.resolved !== undefined)      where.resolved = opts.resolved;
  if (opts.from || opts.to) {
    where.createdAt = {
      ...(opts.from ? { gte: new Date(opts.from) } : {}),
      ...(opts.to   ? { lte: new Date(opts.to) }   : {}),
    };
  }

  const items = await db.securityEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take:    limit + 1,
    cursor:  opts.cursor ? { id: opts.cursor } : undefined,
    skip:    opts.cursor ? 1 : 0,
  });

  const hasMore = items.length > limit;
  const page    = hasMore ? items.slice(0, limit) : items;

  return {
    items: page.map(row => ({
      ...row,
      metadata:  row.metadata ? tryParse(row.metadata) : null,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    hasMore,
  };
}

export async function resolveSecurityEvent(id: string, resolvedBy: string) {
  return db.securityEvent.update({
    where: { id },
    data:  { resolved: true, resolvedAt: new Date(), resolvedBy },
  });
}

export async function createSecurityEvent(data: {
  type:        string;
  severity:    string;
  actorId?:    string;
  targetId?:   string;
  targetType?: string;
  ipAddress?:  string;
  userAgent?:  string;
  description: string;
  metadata?:   unknown;
}) {
  return db.securityEvent.create({
    data: {
      type:       data.type,
      severity:   data.severity,
      actorId:    data.actorId    ?? null,
      targetId:   data.targetId   ?? null,
      targetType: data.targetType ?? null,
      ipAddress:  data.ipAddress  ?? null,
      userAgent:  data.userAgent  ?? null,
      description: data.description,
      metadata:   data.metadata ? JSON.stringify(data.metadata) : null,
    },
  });
}

// ─── Login History ────────────────────────────────────────────────────────────

export interface LoginHistoryQuery {
  cursor?:  string;
  limit?:   number;
  userId?:  string;
  email?:   string;
  success?: boolean;
  from?:    string;
  to?:      string;
}

export async function getLoginHistory(opts: LoginHistoryQuery) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const where: Record<string, unknown> = {};

  if (opts.userId)             where.userId  = opts.userId;
  if (opts.email)              where.email   = { contains: opts.email };
  if (opts.success !== undefined) where.success = opts.success;
  if (opts.from || opts.to) {
    where.createdAt = {
      ...(opts.from ? { gte: new Date(opts.from) } : {}),
      ...(opts.to   ? { lte: new Date(opts.to) }   : {}),
    };
  }

  const items = await db.loginHistory.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take:    limit + 1,
    cursor:  opts.cursor ? { id: opts.cursor } : undefined,
    skip:    opts.cursor ? 1 : 0,
  });

  const hasMore = items.length > limit;
  const page    = hasMore ? items.slice(0, limit) : items;

  return {
    items: page.map(row => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    hasMore,
  };
}

export async function recordLoginHistory(data: {
  userId?:        string;
  email:          string;
  success:        boolean;
  ipAddress?:     string;
  userAgent?:     string;
  failureReason?: string;
  sessionId?:     string;
}) {
  const ua = parseUserAgent(data.userAgent ?? "");
  return db.loginHistory.create({
    data: {
      userId:        data.userId        ?? null,
      email:         data.email,
      success:       data.success,
      ipAddress:     data.ipAddress     ?? null,
      userAgent:     data.userAgent     ?? null,
      deviceType:    ua.deviceType,
      browser:       ua.browser,
      os:            ua.os,
      failureReason: data.failureReason ?? null,
      sessionId:     data.sessionId     ?? null,
    },
  });
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export interface SessionQuery {
  cursor?:  string;
  limit?:   number;
  userId?:  string;
  active?:  boolean;
}

export async function getSessions(opts: SessionQuery) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const now   = new Date();

  const where: Record<string, unknown> = {};
  if (opts.userId) where.userId = opts.userId;
  if (opts.active === true)  {
    where.revokedAt = null;
    where.expiresAt = { gt: now };
  }
  if (opts.active === false) {
    where.OR = [
      { revokedAt: { not: null } },
      { expiresAt: { lte: now } },
    ];
  }

  const items = await db.authToken.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take:    limit + 1,
    cursor:  opts.cursor ? { id: opts.cursor } : undefined,
    skip:    opts.cursor ? 1 : 0,
    include: { user: { select: { id: true, email: true, role: true, profile: { select: { username: true } } } } },
  });

  const hasMore = items.length > limit;
  const page    = hasMore ? items.slice(0, limit) : items;

  return {
    items: page.map(row => ({
      id:          row.id,
      userId:      row.userId,
      userEmail:   row.user.email,
      username:    row.user.profile?.username ?? null,
      role:        row.user.role,
      deviceId:    row.deviceId,
      ipAddress:   row.ipAddress,
      userAgent:   row.userAgent,
      isActive:    !row.revokedAt && row.expiresAt > now,
      createdAt:   row.createdAt.toISOString(),
      expiresAt:   row.expiresAt.toISOString(),
      revokedAt:   row.revokedAt?.toISOString()  ?? null,
      revokedBy:   row.revokedBy                 ?? null,
      lastSeenAt:  row.lastSeenAt?.toISOString() ?? null,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    hasMore,
  };
}

export async function revokeSession(id: string, revokedBy: string) {
  const token = await db.authToken.findUnique({ where: { id } });
  if (!token) return null;

  return db.authToken.update({
    where: { id },
    data:  { revokedAt: new Date(), revokedBy },
  });
}

export async function revokeAllUserSessions(userId: string, revokedBy: string) {
  return db.authToken.updateMany({
    where: { userId, revokedAt: null },
    data:  { revokedAt: new Date(), revokedBy },
  });
}

// ─── IP Controls ──────────────────────────────────────────────────────────────

export async function getIpBlocks(opts: { type?: string; cursor?: string; limit?: number }) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const where: Record<string, unknown> = {};
  if (opts.type) where.type = opts.type;

  const items = await db.ipBlock.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take:    limit + 1,
    cursor:  opts.cursor ? { id: opts.cursor } : undefined,
    skip:    opts.cursor ? 1 : 0,
  });

  const hasMore = items.length > limit;
  const page    = hasMore ? items.slice(0, limit) : items;

  return {
    items: page.map(row => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      isExpired: row.expiresAt ? row.expiresAt < new Date() : false,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    hasMore,
  };
}

export async function createIpBlock(data: {
  ipAddress: string;
  type:      string;
  reason?:   string;
  expiresAt?: string;
  createdBy: string;
}) {
  return db.ipBlock.upsert({
    where: { ipAddress: data.ipAddress },
    create: {
      ipAddress: data.ipAddress,
      type:      data.type,
      reason:    data.reason     ?? null,
      expiresAt: data.expiresAt  ? new Date(data.expiresAt) : null,
      createdBy: data.createdBy,
    },
    update: {
      type:      data.type,
      reason:    data.reason    ?? null,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    },
  });
}

export async function deleteIpBlock(id: string) {
  return db.ipBlock.delete({ where: { id } });
}

export async function isIpBlocked(ipAddress: string): Promise<boolean> {
  const rule = await db.ipBlock.findUnique({ where: { ipAddress } });
  if (!rule) return false;
  if (rule.type === "allow") return false;
  if (rule.expiresAt && rule.expiresAt < new Date()) return false;
  return true;
}

// ─── Fraud Alerts ─────────────────────────────────────────────────────────────

export interface FraudAlertQuery {
  cursor?:   string;
  limit?:    number;
  userId?:   string;
  severity?: string;
  status?:   string;
  type?:     string;
}

export async function getFraudAlerts(opts: FraudAlertQuery) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const where: Record<string, unknown> = {};

  if (opts.userId)   where.userId   = opts.userId;
  if (opts.severity) where.severity = opts.severity;
  if (opts.status)   where.status   = opts.status;
  if (opts.type)     where.type     = opts.type;

  const items = await db.fraudAlert.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take:    limit + 1,
    cursor:  opts.cursor ? { id: opts.cursor } : undefined,
    skip:    opts.cursor ? 1 : 0,
  });

  const hasMore = items.length > limit;
  const page    = hasMore ? items.slice(0, limit) : items;

  return {
    items: page.map(row => ({
      ...row,
      metadata:   row.metadata ? tryParse(row.metadata) : null,
      createdAt:  row.createdAt.toISOString(),
      updatedAt:  row.updatedAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    hasMore,
  };
}

export async function updateFraudAlert(id: string, data: {
  status:     string;
  resolution?: string;
  resolvedBy?: string;
}) {
  return db.fraudAlert.update({
    where: { id },
    data: {
      status:     data.status,
      resolution: data.resolution ?? null,
      resolvedBy: data.resolvedBy ?? null,
      resolvedAt: ["resolved", "dismissed"].includes(data.status) ? new Date() : null,
      updatedAt:  new Date(),
    },
  });
}

// ─── Admin Activity Summary ───────────────────────────────────────────────────

export async function getAdminActivity(opts: { limit?: number; actorId?: string }) {
  const limit = Math.min(opts.limit ?? 100, 500);
  const where: Record<string, unknown> = {
    actorId: { not: null },
  };
  if (opts.actorId) where.actorId = opts.actorId;

  const rows = await db.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take:    limit,
    include: {
      actor: { select: { email: true, role: true, profile: { select: { username: true } } } },
    },
  });

  return rows.map(r => ({
    id:        r.id,
    actorId:   r.actorId,
    actor:     r.actor?.profile?.username ?? r.actor?.email ?? r.actorId,
    role:      r.actor?.role ?? "unknown",
    action:    r.action,
    target:    r.targetType ? `${r.targetType}:${r.targetId ?? ""}` : null,
    ip:        r.ipAddress,
    status:    r.httpStatus,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ─── Permission Audit ─────────────────────────────────────────────────────────

export async function getPermissionAudit() {
  // Count actions per actorId using raw findMany to avoid groupBy TS issues
  const [allAdminLogs, violations] = await Promise.all([
    db.auditLog.findMany({
      where:   { actorId: { not: null } },
      select:  { actorId: true },
      orderBy: { createdAt: "desc" },
      take:    5000,
    }),
    db.securityEvent.findMany({
      where:   { type: "permission_violation", resolved: false },
      orderBy: { createdAt: "desc" },
      take:    50,
    }),
  ]);

  const countByActor = allAdminLogs.reduce<Record<string, number>>((acc, r) => {
    if (r.actorId) { acc[r.actorId] = (acc[r.actorId] ?? 0) + 1; }
    return acc;
  }, {});

  const top20 = (Object.entries(countByActor) as [string, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  const actorIds = top20.map(([id]) => id);
  const actors = actorIds.length
    ? await db.user.findMany({
        where:  { id: { in: actorIds } },
        select: { id: true, email: true, role: true, profile: { select: { username: true } } },
      })
    : [];

  const actorMap = Object.fromEntries(actors.map(a => [a.id, a]));

  return {
    mostActiveAdmins: top20.map(([actorId, actions]) => ({
      actorId,
      actor:   actorMap[actorId]?.profile?.username ?? actorMap[actorId]?.email ?? actorId,
      role:    actorMap[actorId]?.role ?? "unknown",
      actions,
    })),
    recentViolations: violations.map(v => ({
      ...v,
      metadata:  v.metadata ? tryParse(v.metadata) : null,
      createdAt: v.createdAt.toISOString(),
    })),
  };
}

// ─── Fraud Detection ──────────────────────────────────────────────────────────

export async function runFraudScan() {
  const alerts: Array<{
    userId?:     string;
    severity:    string;
    type:        string;
    description: string;
    metadata?:   unknown;
  }> = [];

  const since1h  = new Date(Date.now() - 60 * 60 * 1000);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since7d  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // 1. Detect login failure spikes (>10 failures in 24h from same IP)
  // Use raw approach: get all failed logins, count by IP in JS
  const recentFailures = await db.loginHistory.findMany({
    where:   { success: false, createdAt: { gte: since24h }, ipAddress: { not: null } },
    select:  { ipAddress: true },
    take:    5000,
  });
  const failsByIp = recentFailures.reduce<Record<string, number>>((acc, r) => {
    if (r.ipAddress) { acc[r.ipAddress] = (acc[r.ipAddress] ?? 0) + 1; }
    return acc;
  }, {});
  for (const [ip, count] of Object.entries(failsByIp) as [string, number][]) {
    if (count <= 10) continue;
    const existing = await db.fraudAlert.findFirst({
      where: { type: "repeated_login_failures", metadata: { contains: ip }, status: { in: ["open", "under_review"] } },
    });
    if (!existing) {
      alerts.push({
        severity:    count > 50 ? "critical" : "high",
        type:        "repeated_login_failures",
        description: `${count} failed login attempts from IP ${ip} in last 24h`,
        metadata:    { ipAddress: ip, count, window: "24h" },
      });
    }
  }

  // 2. Detect rapid wallet activity (>5 transactions in 1 hour)
  const recentTxns = await db.transaction.findMany({
    where:  { createdAt: { gte: since1h } },
    select: { userId: true },
    take:   5000,
  });
  const txnsByUser = recentTxns.reduce<Record<string, number>>((acc, r) => {
    acc[r.userId] = (acc[r.userId] ?? 0) + 1;
    return acc;
  }, {});
  for (const [userId, count] of Object.entries(txnsByUser) as [string, number][]) {
    if (count <= 5) continue;
    const existing = await db.fraudAlert.findFirst({
      where: { userId, type: "rapid_wallet_activity", status: { in: ["open", "under_review"] }, createdAt: { gte: since24h } },
    });
    if (!existing) {
      alerts.push({
        userId,
        severity:    "medium",
        type:        "rapid_wallet_activity",
        description: `User made ${count} transactions in the last hour`,
        metadata:    { transactionCount: count, window: "1h" },
      });
    }
  }

  // 3. Detect suspicious withdrawal volume (>3 pending withdrawals in 24h)
  const pendingWithdrawals = await db.withdrawal.findMany({
    where:  { status: "pending", submittedAt: { gte: since24h } },
    select: { userId: true },
    take:   5000,
  });
  const withdrawalsByUser = pendingWithdrawals.reduce<Record<string, number>>((acc, r) => {
    acc[r.userId] = (acc[r.userId] ?? 0) + 1;
    return acc;
  }, {});
  for (const [userId, count] of Object.entries(withdrawalsByUser) as [string, number][]) {
    if (count <= 3) continue;
    const existing = await db.fraudAlert.findFirst({
      where: { userId, type: "suspicious_withdrawal", status: { in: ["open", "under_review"] }, createdAt: { gte: since24h } },
    });
    if (!existing) {
      alerts.push({
        userId,
        severity:    "high",
        type:        "suspicious_withdrawal",
        description: `User has ${count} pending withdrawals in 24h`,
        metadata:    { count },
      });
    }
  }

  // 4. Detect abnormal game activity (>100 bets in 1 hour)
  const recentBets = await db.gameBet.findMany({
    where:  { placedAt: { gte: since1h } },
    select: { userId: true },
    take:   10000,
  });
  const betsByUser = recentBets.reduce<Record<string, number>>((acc, r) => {
    acc[r.userId] = (acc[r.userId] ?? 0) + 1;
    return acc;
  }, {});
  for (const [userId, count] of Object.entries(betsByUser) as [string, number][]) {
    if (count <= 100) continue;
    const existing = await db.fraudAlert.findFirst({
      where: { userId, type: "abnormal_game_activity", status: { in: ["open", "under_review"] }, createdAt: { gte: since24h } },
    });
    if (!existing) {
      alerts.push({
        userId,
        severity:    "medium",
        type:        "abnormal_game_activity",
        description: `User placed ${count} bets in the last hour`,
        metadata:    { betCount: count, window: "1h" },
      });
    }
  }

  // 5. Detect multiple accounts from same IP (>3 distinct users in 7 days)
  const recentLogins = await db.loginHistory.findMany({
    where:  { success: true, ipAddress: { not: null }, createdAt: { gte: since7d } },
    select: { ipAddress: true, userId: true },
    take:   5000,
  });
  const usersByIp = recentLogins.reduce<Record<string, Set<string>>>((acc, r) => {
    if (r.ipAddress && r.userId) {
      if (!acc[r.ipAddress]) acc[r.ipAddress] = new Set();
      acc[r.ipAddress].add(r.userId);
    }
    return acc;
  }, {});
  for (const [ip, userSet] of Object.entries(usersByIp) as [string, Set<string>][]) {
    if (userSet.size <= 3) continue;
    const existing = await db.fraudAlert.findFirst({
      where: { type: "multiple_accounts", metadata: { contains: ip }, status: { in: ["open", "under_review"] } },
    });
    if (!existing) {
      alerts.push({
        severity:    "medium",
        type:        "multiple_accounts",
        description: `${userSet.size} distinct users logged in from IP ${ip} in 7 days`,
        metadata:    { ipAddress: ip, distinctUsers: userSet.size, window: "7d" },
      });
    }
  }

  // Write all new alerts
  const created = await Promise.all(
    alerts.map(a =>
      db.fraudAlert.create({
        data: {
          userId:      a.userId      ?? null,
          severity:    a.severity,
          type:        a.type,
          description: a.description,
          metadata:    a.metadata ? JSON.stringify(a.metadata) : null,
          status:      "open",
        },
      })
    )
  );

  return { detected: alerts.length, created: created.length };
}

// ─── Compliance export ────────────────────────────────────────────────────────

export async function getComplianceSummary(opts: { from?: string; to?: string }) {
  const where: Record<string, unknown> = {};
  if (opts.from || opts.to) {
    where.createdAt = {
      ...(opts.from ? { gte: new Date(opts.from) } : {}),
      ...(opts.to   ? { lte: new Date(opts.to) }   : {}),
    };
  }

  const [
    auditCount, securityEventCount, loginCount, fraudCount,
    openAlerts, resolvedAlerts, blockedIps,
  ] = await Promise.all([
    db.auditLog.count({ where }),
    db.securityEvent.count({ where }),
    db.loginHistory.count({ where }),
    db.fraudAlert.count({ where }),
    db.fraudAlert.count({ where: { status: "open" } }),
    db.fraudAlert.count({ where: { status: "resolved" } }),
    db.ipBlock.count({ where: { type: "block" } }),
  ]);

  const [failedLogins, successLogins] = await Promise.all([
    db.loginHistory.count({ where: { ...where, success: false } }),
    db.loginHistory.count({ where: { ...where, success: true  } }),
  ]);

  return {
    period: {
      from: opts.from ?? "all time",
      to:   opts.to   ?? new Date().toISOString(),
    },
    audit: {
      totalEntries:  auditCount,
      securityEvents: securityEventCount,
    },
    authentication: {
      totalLogins:   loginCount,
      successLogins,
      failedLogins,
      failRate:      loginCount > 0 ? Math.round((failedLogins / loginCount) * 100) : 0,
    },
    fraud: {
      totalAlerts:  fraudCount,
      openAlerts,
      resolvedAlerts,
    },
    ipControls: {
      blockedIps,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tryParse(s: string): unknown {
  try { return JSON.parse(s); }
  catch { return s; }
}
