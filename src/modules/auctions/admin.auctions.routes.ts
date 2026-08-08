import { FastifyInstance } from "fastify";
import { requirePermission } from "../admin/admin.middleware";
import {
  adminListAuctions,
  adminGetAuction,
  adminGetAuctionStatistics,
  adminCreateAuction,
  adminUpdateAuction,
  adminActivateAuction,
  adminLaunchAuction,
  adminPauseAuction,
  adminResumeAuction,
  adminEndAuction,
  adminCancelAuction,
  adminDeleteAuction,
  adminListCollection,
  adminUpdateCollectionItem,
} from "./auctions.service";
import { adminGetBids }       from "./auctions.bidding.service";
import { adminSetRewardData }  from "./auctions.claim.service";

export async function adminAuctionsRoutes(app: FastifyInstance) {
  // Statistics (static before param routes)
  app.get(
    "/statistics",
    { onRequest: [requirePermission("admin.auction.statistics")] },
    async (req, reply) => {
      try {
        const stats = await adminGetAuctionStatistics();
        return reply.send({ stats });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // Collection (static before param routes)
  app.get(
    "/collection",
    { onRequest: [requirePermission("admin.auction.view")] },
    async (req, reply) => {
      try {
        const { status } = req.query as { status?: string };
        const items = await adminListCollection({ status });
        return reply.send({ items });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.patch(
    "/collection/:id",
    { onRequest: [requirePermission("admin.auction.manage")] },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const adminId = (req.user as any).sub;
        const body = req.body as { status?: string; deliveryNotes?: string; expiresAt?: string };
        const item = await adminUpdateCollectionItem(id, body, adminId);
        return reply.send({ item });
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );

  // Set reward data (gift card code, license key, etc.) before winner claims
  app.put(
    "/collection/:id/reward-data",
    { onRequest: [requirePermission("admin.auction.manage")] },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const body = req.body as { rewardData?: string | null; deliveryNotes?: string | null };
        const item = await adminSetRewardData(id, body);
        return reply.send({ item });
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );

  // List auctions
  app.get(
    "/",
    { onRequest: [requirePermission("admin.auction.view")] },
    async (req, reply) => {
      try {
        const { status, visibility } = req.query as { status?: string; visibility?: string };
        const auctions = await adminListAuctions({ status, visibility });
        return reply.send({ auctions });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // Create auction
  app.post(
    "/",
    { onRequest: [requirePermission("admin.auction.manage")] },
    async (req, reply) => {
      try {
        const adminId = (req.user as any).sub;
        const body = req.body as any;
        const auction = await adminCreateAuction(body, adminId);
        return reply.status(201).send({ auction });
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );

  // Get single auction
  app.get(
    "/:id",
    { onRequest: [requirePermission("admin.auction.view")] },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const auction = await adminGetAuction(id);
        return reply.send({ auction });
      } catch (err: any) {
        return reply.status(404).send({ error: err.message });
      }
    }
  );

  // Update auction
  app.put(
    "/:id",
    { onRequest: [requirePermission("admin.auction.manage")] },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const adminId = (req.user as any).sub;
        const body = req.body as any;
        const auction = await adminUpdateAuction(id, body, adminId);
        return reply.send({ auction });
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );

  // Delete auction
  app.delete(
    "/:id",
    { onRequest: [requirePermission("admin.auction.manage")] },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        await adminDeleteAuction(id);
        return reply.send({ success: true });
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );

  // Status transitions
  app.post(
    "/:id/activate",
    { onRequest: [requirePermission("admin.auction.manage")] },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const adminId = (req.user as any).sub;
        const auction = await adminActivateAuction(id, adminId);
        return reply.send({ auction });
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );

  app.post(
    "/:id/launch",
    { onRequest: [requirePermission("admin.auction.manage")] },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const adminId = (req.user as any).sub;
        const auction = await adminLaunchAuction(id, adminId);
        return reply.send({ auction });
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );

  app.post(
    "/:id/pause",
    { onRequest: [requirePermission("admin.auction.manage")] },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const adminId = (req.user as any).sub;
        const { reason } = (req.body as any) ?? {};
        const auction = await adminPauseAuction(id, adminId, reason);
        return reply.send({ auction });
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );

  app.post(
    "/:id/resume",
    { onRequest: [requirePermission("admin.auction.manage")] },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const adminId = (req.user as any).sub;
        const auction = await adminResumeAuction(id, adminId);
        return reply.send({ auction });
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );

  app.post(
    "/:id/end",
    { onRequest: [requirePermission("admin.auction.manage")] },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const adminId = (req.user as any).sub;
        const { reason } = (req.body as any) ?? {};
        const auction = await adminEndAuction(id, adminId, reason);
        return reply.send({ auction });
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );

  app.post(
    "/:id/cancel",
    { onRequest: [requirePermission("admin.auction.manage")] },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const adminId = (req.user as any).sub;
        const { reason } = (req.body as any) ?? {};
        const auction = await adminCancelAuction(id, adminId, reason);
        return reply.send({ auction });
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );

  // Admin: view bid history for an auction
  app.get(
    "/:id/bids",
    { onRequest: [requirePermission("admin.auction.view")] },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const { limit } = req.query as { limit?: string };
        const bids = await adminGetBids(id, limit ? Math.min(parseInt(limit), 500) : 100);
        return reply.send({ bids });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );
}
