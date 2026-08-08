/**
 * AI Monitoring Service — Phase 18.1
 *
 * Lightweight event logger for all background components.
 * Writes to AIMonitoringLog; entries are paginated in the admin panel.
 */

import { db } from "../../db";

export type MonitoringComponent = "worker" | "sync" | "publish" | "learning" | "drift" | "scheduler" | "provider";
export type MonitoringEvent     = "started" | "completed" | "failed" | "skipped";

export async function logMonitoringEvent(
  component:  MonitoringComponent,
  event:      MonitoringEvent,
  details:    Record<string, unknown> = {},
  durationMs: number = 0,
): Promise<void> {
  await db.aIMonitoringLog.create({
    data: {
      component,
      event,
      details:    JSON.stringify(details),
      durationMs,
    },
  }).catch(() => { /* never let logging break the caller */ });
}

export async function getMonitoringLogs(opts: {
  component?: string;
  cursor?:    string;
  limit?:     number;
}) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const items = await db.aIMonitoringLog.findMany({
    where:   opts.component ? { component: opts.component } : {},
    orderBy: { createdAt: "desc" },
    take:    limit + 1,
    cursor:  opts.cursor ? { id: opts.cursor } : undefined,
    skip:    opts.cursor ? 1 : 0,
  });

  const hasMore    = items.length > limit;
  const page       = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  return { items: page, nextCursor, hasMore };
}

export async function pruneOldLogs(keepDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - keepDays * 86_400_000);
  const { count } = await db.aIMonitoringLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}
