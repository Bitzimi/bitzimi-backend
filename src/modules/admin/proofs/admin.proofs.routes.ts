import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import { auditLogHook } from "../../../middleware/auditLog";
import { getProofReviewQueue, adminListProofs, adminDecideProof } from "./admin.proofs.service";

export async function adminProofsRoutes(app: FastifyInstance) {
  app.addHook("onRequest",  authenticate);
  app.addHook("onResponse", auditLogHook);

  // GET /api/v1/admin/proofs/queue — AI borderline cases (70–84%); ?all=true includes decided items
  app.get("/queue", { onRequest: [requirePermission("admin.tasks.proofs.view")] }, async (req, reply) => {
    const q = z.object({ all: z.enum(["true", "false"]).optional() }).parse(req.query);
    return reply.send({ data: await getProofReviewQueue({ includeDecided: q.all === "true" }) });
  });

  // GET /api/v1/admin/proofs — all proofs paginated
  app.get("/", { onRequest: [requirePermission("admin.tasks.proofs.view")] }, async (req, reply) => {
    const q = z.object({ status: z.string().optional(), cursor: z.string().optional(), limit: z.coerce.number().int().default(50) }).parse(req.query);
    return reply.send({ data: await adminListProofs(q) });
  });

  // POST /api/v1/admin/proofs/:reviewId/decide
  app.post("/:reviewId/decide", { onRequest: [requirePermission("admin.tasks.proofs.approve")] }, async (req, reply) => {
    const { reviewId } = req.params as { reviewId: string };
    const body = z.object({
      decision: z.enum(["approved", "rejected"]),
      note:     z.string().max(500).optional(),
    }).parse(req.body);
    const data = await adminDecideProof(reviewId, req.user.sub, body.decision, body.note);
    return reply.send({ data });
  });
}
