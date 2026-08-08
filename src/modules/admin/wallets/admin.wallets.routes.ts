import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import {
  adminGetWalletStats,
  adminSearchWalletUsers,
  adminGetUserWallets,
  adminGetWalletLedger,
  adminCreditUserWallet,
  adminDebitUserWallet,
  adminFreezeWallet,
  adminUnfreezeWallet,
  adminRunWalletDiagnostics,
  adminGetWalletAuditLog,
} from "./admin.wallets.service";
export async function adminWalletsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/admin/wallets/stats
  app.get("/stats", { onRequest: [requirePermission("admin.wallets.view")] }, async (_req, reply) => {
    const data = await adminGetWalletStats();
    return reply.send({ data });
  });

  // GET /api/v1/admin/wallets/users
  app.get("/users", { onRequest: [requirePermission("admin.wallets.view")] }, async (req, reply) => {
    const query = z.object({
      search: z.string().optional(),
      cursor: z.string().optional(),
      limit:  z.string().transform(Number).optional(),
    }).parse(req.query);
    const data = await adminSearchWalletUsers(query);
    return reply.send({ data });
  });

  // GET /api/v1/admin/wallets/users/:userId
  app.get("/users/:userId", { onRequest: [requirePermission("admin.wallets.view")] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const data = await adminGetUserWallets(userId);
    return reply.send({ data });
  });

  // GET /api/v1/admin/wallets/users/:userId/ledger
  app.get("/users/:userId/ledger", { onRequest: [requirePermission("admin.wallets.view")] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const query = z.object({
      walletType: z.enum(["main","game","task","referral","affiliate","task_vault","ambassador"]).optional(),
      type:   z.string().optional(),
      cursor: z.string().optional(),
      limit:  z.string().transform(Number).optional(),
      from:   z.string().optional(),
      to:     z.string().optional(),
    }).parse(req.query);
    const data = await adminGetWalletLedger({ userId, ...query });
    return reply.send({ data });
  });

  // GET /api/v1/admin/wallets/ledger (global ledger — all users)
  app.get("/ledger", { onRequest: [requirePermission("admin.wallets.view")] }, async (req, reply) => {
    const query = z.object({
      userId:     z.string().optional(),
      walletType: z.string().optional(),
      type:       z.string().optional(),
      cursor:     z.string().optional(),
      limit:      z.string().transform(Number).optional(),
      from:       z.string().optional(),
      to:         z.string().optional(),
    }).parse(req.query);
    const data = await adminGetWalletLedger(query);
    return reply.send({ data });
  });

  // POST /api/v1/admin/wallets/users/:userId/credit
  app.post("/users/:userId/credit", { onRequest: [requirePermission("admin.wallets.manage")] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const adminId = req.user.sub;
    const body = z.object({
      walletType: z.enum(["main","game","task","referral","affiliate","task_vault","ambassador"]),
      amount:     z.number().positive(),
      reason:     z.string().min(5).max(500),
    }).parse(req.body);
    const data = await adminCreditUserWallet({ userId, adminId, ...body });
    return reply.send({ data });
  });

  // POST /api/v1/admin/wallets/users/:userId/debit
  app.post("/users/:userId/debit", { onRequest: [requirePermission("admin.wallets.manage")] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const adminId = req.user.sub;
    const body = z.object({
      walletType: z.enum(["main","game","task","referral","affiliate","task_vault","ambassador"]),
      amount:     z.number().positive(),
      reason:     z.string().min(5).max(500),
    }).parse(req.body);
    const data = await adminDebitUserWallet({ userId, adminId, ...body });
    return reply.send({ data });
  });

  // POST /api/v1/admin/wallets/users/:userId/freeze
  app.post("/users/:userId/freeze", { onRequest: [requirePermission("admin.wallets.manage")] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const adminId = req.user.sub;
    const body = z.object({
      walletType: z.enum(["main","game","task","referral","affiliate","task_vault","ambassador"]),
      reason:     z.string().min(5).max(500),
    }).parse(req.body);
    const data = await adminFreezeWallet({ userId, adminId, ...body });
    return reply.send({ data });
  });

  // POST /api/v1/admin/wallets/users/:userId/unfreeze
  app.post("/users/:userId/unfreeze", { onRequest: [requirePermission("admin.wallets.manage")] }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const adminId = req.user.sub;
    const body = z.object({
      walletType: z.enum(["main","game","task","referral","affiliate","task_vault","ambassador"]),
    }).parse(req.body);
    const data = await adminUnfreezeWallet({ userId, adminId, walletType: body.walletType });
    return reply.send({ data });
  });

  // GET /api/v1/admin/wallets/diagnostics
  app.get("/diagnostics", { onRequest: [requirePermission("admin.wallets.view")] }, async (_req, reply) => {
    const data = await adminRunWalletDiagnostics();
    return reply.send({ data });
  });

  // GET /api/v1/admin/wallets/audit
  app.get("/audit", { onRequest: [requirePermission("admin.wallets.view")] }, async (req, reply) => {
    const query = z.object({
      adminId: z.string().optional(),
      cursor:  z.string().optional(),
      limit:   z.string().transform(Number).optional(),
    }).parse(req.query);
    const data = await adminGetWalletAuditLog(query);
    return reply.send({ data });
  });
}
