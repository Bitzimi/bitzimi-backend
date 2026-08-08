import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import { auditLogHook } from "../../../middleware/auditLog";
import {
  adminListUsers, adminGetUserDetail, adminEditUser,
  adminSuspendUser, adminUnsuspendUser, adminSetVerification, adminOverrideLimits,
  adminForceVerifyEmail, adminDisable2FA, adminClearPin,
} from "./admin.users.service";

export async function adminUsersRoutes(app: FastifyInstance) {
  app.addHook("onRequest",  authenticate);
  app.addHook("onResponse", auditLogHook);

  // GET /api/v1/admin/users
  app.get("/", { onRequest: [requirePermission("admin.users.view")] }, async (req, reply) => {
    const q = z.object({
      cursor: z.string().optional(),
      limit:  z.coerce.number().int().min(1).max(100).default(50),
      search: z.string().optional(),
    }).parse(req.query);
    return reply.send({ data: await adminListUsers(q) });
  });

  // GET /api/v1/admin/users/:userId — full detail including game stats, transactions, task/referral summary
  app.get("/:userId", { onRequest: [requirePermission("admin.users.view")] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    return reply.send({ data: await adminGetUserDetail(userId) });
  });

  // PATCH /api/v1/admin/users/:userId
  app.patch("/:userId", { onRequest: [requirePermission("admin.users.edit")] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const body = z.object({
      role:     z.string().optional(),
      fullName: z.string().optional(),
      username: z.string().optional(),
    }).parse(req.body);
    return reply.send({ data: await adminEditUser(userId, req.user.sub, body) });
  });

  // POST /api/v1/admin/users/:userId/suspend
  app.post("/:userId/suspend", { onRequest: [requirePermission("admin.users.suspend")] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    return reply.send({ data: await adminSuspendUser(userId, req.user.sub) });
  });

  // POST /api/v1/admin/users/:userId/unsuspend
  app.post("/:userId/unsuspend", { onRequest: [requirePermission("admin.users.suspend")] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    return reply.send({ data: await adminUnsuspendUser(userId) });
  });

  // PATCH /api/v1/admin/users/:userId/verification
  app.patch("/:userId/verification", { onRequest: [requirePermission("admin.kyc.approve")] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const body = z.object({ status: z.enum(["unverified","pending","verified","rejected"]) }).parse(req.body);
    return reply.send({ data: await adminSetVerification(userId, body.status) });
  });

  // PATCH /api/v1/admin/users/:userId/limits
  app.patch("/:userId/limits", { onRequest: [requirePermission("admin.users.override_limits")] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const body = z.object({
      dailyUsed:   z.number().min(0),
      monthlyUsed: z.number().min(0),
    }).parse(req.body);
    return reply.send({ data: await adminOverrideLimits(userId, body.dailyUsed, body.monthlyUsed) });
  });

  // POST /api/v1/admin/users/:userId/force-verify-email
  app.post("/:userId/force-verify-email", { onRequest: [requirePermission("admin.users.edit")] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    return reply.send({ data: await adminForceVerifyEmail(userId, req.user.sub) });
  });

  // POST /api/v1/admin/users/:userId/disable-2fa
  app.post("/:userId/disable-2fa", { onRequest: [requirePermission("admin.users.edit")] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    return reply.send({ data: await adminDisable2FA(userId, req.user.sub) });
  });

  // POST /api/v1/admin/users/:userId/clear-pin
  app.post("/:userId/clear-pin", { onRequest: [requirePermission("admin.users.edit")] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    return reply.send({ data: await adminClearPin(userId, req.user.sub) });
  });
}
