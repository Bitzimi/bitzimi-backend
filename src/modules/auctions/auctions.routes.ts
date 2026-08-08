/**
 * Auction User Routes — Phase 22.1 + 22.3
 *
 * GET  /api/v1/auctions               — list public auctions
 * GET  /api/v1/auctions/collection/my — user's won collection
 * GET  /api/v1/auctions/:id           — single auction detail
 * GET  /api/v1/auctions/:id/bids      — public bid history (masked usernames)
 * GET  /api/v1/auctions/:id/events    — SSE stream for live updates
 * POST /api/v1/auctions/:id/bid       — place a bid (Game Wallet deduction)
 * POST /api/v1/auctions/collection/:id/claim — claim won reward
 */

import { FastifyInstance } from "fastify";
import { authenticate }    from "../../middleware/authenticate";
import { listPublicAuctions, getPublicAuction, getMyCollection } from "./auctions.service";
import { placeBid, getPublicBids }  from "./auctions.bidding.service";
import { claimAuctionReward }       from "./auctions.claim.service";
import { subscribe, unsubscribe }   from "./auctions.sse";
import { db }                       from "../../db";
import { getFeatureAccessLevel, canAccessFeature } from "../admin/config/admin.config.service";

async function assertAuctionAccess(userId: string, role: string): Promise<void> {
  const [sub, level] = await Promise.all([
    db.subscription.findUnique({ where: { userId } }),
    getFeatureAccessLevel("auction_marketplace"),
  ]);
  const isVip = !!(sub?.isActive && new Date(sub.endsAt) > new Date());
  if (!canAccessFeature(level, role, isVip)) {
    throw Object.assign(new Error("Auction marketplace is not available at your access level"), {
      statusCode: 403, code: "FEATURE_DISABLED",
    });
  }
}

export async function auctionsRoutes(app: FastifyInstance) {

  // ── GET /api/v1/auctions ──────────────────────────────────────────────────
  app.get("/", { onRequest: [authenticate] }, async (req, reply) => {
    try {
      await assertAuctionAccess(req.user.sub, req.user.role);
      const auctions = await listPublicAuctions();
      return reply.send({ auctions });
    } catch (err: any) {
      const status = (err as any).statusCode ?? 403;
      return reply.status(status).send({ error: err.message, code: err.code });
    }
  });

  // ── GET /api/v1/auctions/collection/my  (static — before /:id) ───────────
  app.get("/collection/my", { onRequest: [authenticate] }, async (req, reply) => {
    try {
      await assertAuctionAccess(req.user.sub, req.user.role);
      const items = await getMyCollection(req.user.sub);
      return reply.send({ items });
    } catch (err: any) {
      const status = (err as any).statusCode ?? 500;
      return reply.status(status).send({ error: err.message, code: err.code });
    }
  });

  // ── POST /api/v1/auctions/collection/:id/claim  (static prefix — before /:id) ──
  app.post("/collection/:id/claim", { onRequest: [authenticate] }, async (req, reply) => {
    try {
      await assertAuctionAccess(req.user.sub, req.user.role);
      const { id } = req.params as { id: string };
      const result = await claimAuctionReward(req.user.sub, id);
      return reply.send(result);
    } catch (err: any) {
      const status = (err as any).statusCode ?? 400;
      return reply.status(status).send({ error: err.message, code: err.code });
    }
  });

  // ── GET /api/v1/auctions/:id ──────────────────────────────────────────────
  app.get("/:id", { onRequest: [authenticate] }, async (req, reply) => {
    try {
      await assertAuctionAccess(req.user.sub, req.user.role);
      const { id }  = req.params as { id: string };
      const auction = await getPublicAuction(id);
      return reply.send({ auction });
    } catch (err: any) {
      const status = (err as any).statusCode ?? 404;
      return reply.status(status).send({ error: err.message, code: err.code });
    }
  });

  // ── GET /api/v1/auctions/:id/bids ─────────────────────────────────────────
  app.get("/:id/bids", { onRequest: [authenticate] }, async (req, reply) => {
    try {
      await assertAuctionAccess(req.user.sub, req.user.role);
      const { id }    = req.params as { id: string };
      const { limit } = req.query as { limit?: string };
      const bids      = await getPublicBids(id, limit ? Math.min(parseInt(limit), 50) : 20);
      return reply.send({ bids });
    } catch (err: any) {
      const status = (err as any).statusCode ?? 500;
      return reply.status(status).send({ error: err.message, code: err.code });
    }
  });

  // ── GET /api/v1/auctions/:id/events  (SSE) ────────────────────────────────
  // Clients connect here to receive real-time bid and state updates.
  // Auth header must be sent as query param ?token=... because SSE EventSource
  // does not support custom headers in browsers.
  app.get("/:id/events", async (req, reply) => {
    // Token auth via query param (browser SSE limitation)
    const { token } = req.query as { token?: string };

    // Lightweight JWT check without the full hook stack
    if (!token) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    try {
      // Reuse JWT secret from config for verification
      const config = await import("../../config").then(m => m.config);
      const jwt    = await import("jsonwebtoken");
      jwt.default.verify(token, config.jwt.accessSecret);
    } catch {
      return reply.status(401).send({ error: "Invalid token" });
    }

    const { id } = req.params as { id: string };

    // Set SSE headers
    reply.raw.writeHead(200, {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    });
    reply.raw.write(": connected\n\n");

    // Register subscriber
    subscribe(id, reply);

    // Send initial state
    try {
      const auction = await getPublicAuction(id);
      reply.raw.write(`data: ${JSON.stringify({ type: "initial_state", ...auction })}\n\n`);
    } catch { /* auction not found or not public */ }

    // Clean up on disconnect
    req.raw.on("close", () => {
      unsubscribe(id, reply);
    });

    // Keep connection open — reply stays hijacked
    return;
  });

  // ── POST /api/v1/auctions/:id/bid ─────────────────────────────────────────
  app.post("/:id/bid", { onRequest: [authenticate] }, async (req, reply) => {
    try {
      await assertAuctionAccess(req.user.sub, req.user.role);
      const { id } = req.params as { id: string };
      const result = await placeBid(req.user.sub, id);
      return reply.status(201).send(result);
    } catch (err: any) {
      const status = (err as any).statusCode ?? 400;
      return reply.status(status).send({ error: err.message, code: err.code });
    }
  });
}
