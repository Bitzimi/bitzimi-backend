import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { getAffiliateTree, getAffiliateCommissions, getAffiliateStats } from "./affiliates.service";
import { submitAffiliateApplication, getAffiliateApplication } from "./affiliates.application.service";
import { getConfigValue } from "../admin/config/admin.config.service";

async function assertAffiliateEnabled(): Promise<void> {
  const enabled = await getConfigValue<boolean>("feature.affiliate_program", true);
  if (!enabled) {
    throw Object.assign(new Error("Affiliate program is currently disabled"), {
      statusCode: 403, code: "FEATURE_DISABLED",
    });
  }
}

export async function affiliatesRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // ── Affiliate tree / commissions / stats ──────────────────────────────────

  // GET /api/v1/affiliates/tree — full 3-tier downline tree
  app.get("/tree", async (req, reply) => {
    await assertAffiliateEnabled();
    return reply.send({ data: await getAffiliateTree(req.user.sub) });
  });

  // GET /api/v1/affiliates/commissions — paginated commission history
  app.get("/commissions", async (req, reply) => {
    await assertAffiliateEnabled();
    const q = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    return reply.send({ data: await getAffiliateCommissions(req.user.sub, q) });
  });

  // GET /api/v1/affiliates/stats — commission totals by type and tier
  app.get("/stats", async (req, reply) => {
    await assertAffiliateEnabled();
    return reply.send({ data: await getAffiliateStats(req.user.sub) });
  });

  // ── Affiliate application ─────────────────────────────────────────────────

  // GET /api/v1/affiliates/application — current user's application status
  // Returns { data: null } if no application has been submitted yet
  app.get("/application", async (req, reply) => {
    return reply.send({ data: await getAffiliateApplication(req.user.sub) });
  });

  // POST /api/v1/affiliates/apply — submit or re-apply for the affiliate program
  app.post("/apply", async (req, reply) => {
    await assertAffiliateEnabled();
    const body = z.object({
      fullName:           z.string().min(2).max(100).trim(),
      socialPlatform:     z.enum(["facebook", "x", "telegram", "whatsapp", "instagram", "youtube", "tiktok", "discord"]),
      socialLink:         z.string().url().max(500),
      socialUsername:     z.string().min(1).max(200).trim(),
      totalMembers:       z.number().int().min(1000),
      screenshotDataUrl:  z.string().optional(), // base64 data URL — ownership proof screenshot
    }).parse(req.body);

    const result = await submitAffiliateApplication(req.user.sub, body);
    return reply.status(201).send({ data: result });
  });
}
