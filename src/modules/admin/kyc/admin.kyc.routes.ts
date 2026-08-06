import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import { auditLogHook } from "../../../middleware/auditLog";
import { getKycQueue, getKycSubmissionDetail, approveKyc, rejectKyc } from "./admin.kyc.service";

export async function adminKycRoutes(app: FastifyInstance) {
  app.addHook("onRequest",  authenticate);
  app.addHook("onResponse", auditLogHook);  // log all admin KYC mutations

  // GET /api/v1/admin/kyc?status=under_review
  app.get("/", { onRequest: [requirePermission("admin.kyc.view")] }, async (req, reply) => {
    const query = z.object({ status: z.string().optional() }).parse(req.query);
    const data  = await getKycQueue(query.status);
    return reply.send({ data });
  });

  // GET /api/v1/admin/kyc/:submissionId — detail with document URLs
  app.get("/:id", { onRequest: [requirePermission("admin.kyc.view")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data   = await getKycSubmissionDetail(id);
    return reply.send({ data });
  });

  // POST /api/v1/admin/kyc/:submissionId/approve
  app.post("/:id/approve", { onRequest: [requirePermission("admin.kyc.approve")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data   = await approveKyc(id, req.user.sub);
    return reply.send({ data });
  });

  // POST /api/v1/admin/kyc/:submissionId/reject
  app.post("/:id/reject", { onRequest: [requirePermission("admin.kyc.reject")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body   = z.object({ reason: z.string().min(1, "Rejection reason is required") }).parse(req.body);
    const data   = await rejectKyc(id, req.user.sub, body.reason);
    return reply.send({ data });
  });
}
