import { FastifyInstance } from "fastify";
import { authenticate }    from "../../middleware/authenticate";
import {
  getActivePromotionForLocation,
  createFeaturedRequest,
  getMyFeaturedRequests,
  getFeaturedPricing,
} from "./promotions.service";

const VALID_LOCATIONS = ["wallet", "marketplace", "referral", "affiliate", "ambassador"];

export async function promotionsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/promotions/active?location=wallet
  app.get<{ Querystring: { location?: string } }>(
    "/active",
    async (req, reply) => {
      const { location } = req.query;
      if (!location) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT", message: "location query param required" } });
      }
      if (!VALID_LOCATIONS.includes(location)) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT", message: `location must be one of: ${VALID_LOCATIONS.join(", ")}` } });
      }
      const data = await getActivePromotionForLocation(location);
      return reply.send({ data });
    },
  );

  // POST /api/v1/promotions/featured-request
  app.post<{
    Body: { taskId: string; durationDays: number; locations: string[]; title: string };
  }>(
    "/featured-request",
    async (req, reply) => {
      const { taskId, durationDays, locations, title } = req.body ?? {};
      if (!taskId || !durationDays || !locations || !title) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT", message: "taskId, durationDays, locations, title are required" } });
      }
      if (!Array.isArray(locations) || locations.length === 0) {
        return reply.status(400).send({ error: { code: "INVALID_INPUT", message: "locations must be a non-empty array" } });
      }
      const data = await createFeaturedRequest(req.user.sub, {
        taskId,
        durationDays,
        locations: locations as any,
        title,
      });
      return reply.status(201).send({ data });
    },
  );

  // GET /api/v1/promotions/my-requests
  app.get("/my-requests", async (req, reply) => {
    const data = await getMyFeaturedRequests(req.user.sub);
    return reply.send({ data });
  });

  // GET /api/v1/promotions/pricing — public pricing list for authenticated users
  app.get("/pricing", async (_req, reply) => {
    const data = await getFeaturedPricing();
    return reply.send({ data });
  });
}
