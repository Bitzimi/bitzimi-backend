import type { FastifyInstance } from "fastify";
import { requirePermission } from "../admin.middleware";
import {
  parseDateRange,
  getAnalyticsOverview,
  getUserAnalytics,
  getFinancialAnalytics,
  getRevenueAnalytics,
  getGameAnalytics,
  getTaskAnalytics,
  getKycAnalytics,
  getNotificationAnalytics,
  getReferralAnalytics,
} from "./admin.analytics.service";

function resolvePreset(preset?: string): { from?: string; to?: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  const midnight = (date: Date) => {
    const dt = new Date(date);
    dt.setUTCHours(0, 0, 0, 0);
    return dt.toISOString();
  };
  const eod = (date: Date) => {
    const dt = new Date(date);
    dt.setUTCHours(23, 59, 59, 999);
    return dt.toISOString();
  };

  const today = new Date(Date.UTC(y, m, d));

  switch (preset) {
    case "today":
      return { from: midnight(today), to: eod(today) };
    case "yesterday": {
      const yest = new Date(Date.UTC(y, m, d - 1));
      return { from: midnight(yest), to: eod(yest) };
    }
    case "7d": {
      const f = new Date(Date.UTC(y, m, d - 6));
      return { from: midnight(f), to: eod(today) };
    }
    case "30d": {
      const f = new Date(Date.UTC(y, m, d - 29));
      return { from: midnight(f), to: eod(today) };
    }
    case "this_month": {
      const f = new Date(Date.UTC(y, m, 1));
      return { from: midnight(f), to: eod(today) };
    }
    case "last_month": {
      const f = new Date(Date.UTC(y, m - 1, 1));
      const t = new Date(Date.UTC(y, m, 0)); // last day of last month
      return { from: midnight(f), to: eod(t) };
    }
    default:
      return {};
  }
}

function getRange(query: Record<string, any>): { from: Date; to: Date } {
  const p = resolvePreset(query.preset);
  const fromStr = p.from ?? query.from;
  const toStr   = p.to   ?? query.to;
  return parseDateRange(fromStr, toStr);
}

export async function adminAnalyticsRoutes(app: FastifyInstance) {
  // All analytics routes require the analytics.view permission
  app.addHook("preHandler", requirePermission("admin.analytics.view"));

  app.get("/overview", async (req, reply) => {
    const range = getRange(req.query as Record<string, any>);
    const data  = await getAnalyticsOverview(range.from, range.to);
    return reply.send({ success: true, data });
  });

  app.get("/users", async (req, reply) => {
    const range = getRange(req.query as Record<string, any>);
    const data  = await getUserAnalytics(range.from, range.to);
    return reply.send({ success: true, data });
  });

  app.get("/financial", async (req, reply) => {
    const range = getRange(req.query as Record<string, any>);
    const data  = await getFinancialAnalytics(range.from, range.to);
    return reply.send({ success: true, data });
  });

  app.get("/revenue", async (req, reply) => {
    const range = getRange(req.query as Record<string, any>);
    const data  = await getRevenueAnalytics(range.from, range.to);
    return reply.send({ success: true, data });
  });

  app.get("/games", async (req, reply) => {
    const range = getRange(req.query as Record<string, any>);
    const data  = await getGameAnalytics(range.from, range.to);
    return reply.send({ success: true, data });
  });

  app.get("/tasks", async (req, reply) => {
    const range = getRange(req.query as Record<string, any>);
    const data  = await getTaskAnalytics(range.from, range.to);
    return reply.send({ success: true, data });
  });

  app.get("/kyc", async (req, reply) => {
    const range = getRange(req.query as Record<string, any>);
    const data  = await getKycAnalytics(range.from, range.to);
    return reply.send({ success: true, data });
  });

  app.get("/notifications", async (req, reply) => {
    const range = getRange(req.query as Record<string, any>);
    const data  = await getNotificationAnalytics(range.from, range.to);
    return reply.send({ success: true, data });
  });

  app.get("/referrals", async (req, reply) => {
    const range = getRange(req.query as Record<string, any>);
    const data  = await getReferralAnalytics(range.from, range.to);
    return reply.send({ success: true, data });
  });
}
