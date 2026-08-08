/**
 * Admin Currency Management Routes — Phase 23.4
 *
 * GET    /api/v1/admin/currency             — list all currencies (admin view)
 * POST   /api/v1/admin/currency             — add new currency
 * PATCH  /api/v1/admin/currency/:code       — update fields
 * DELETE /api/v1/admin/currency/:code       — remove currency
 * POST   /api/v1/admin/currency/sync-rates  — trigger automatic rate sync
 */
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import { auditLogHook } from "../../../middleware/auditLog";
import {
  listAllCurrencies,
  createCurrency,
  updateCurrency,
  deleteCurrency,
  syncAutomaticRates,
} from "./admin.currency.service";

export async function adminCurrencyRoutes(app: FastifyInstance) {
  app.addHook("onRequest",  authenticate);
  app.addHook("onResponse", auditLogHook);

  // GET /api/v1/admin/currency
  app.get("/", { onRequest: [requirePermission("admin.config.view")] }, async (_req, reply) => {
    return reply.send({ data: await listAllCurrencies() });
  });

  // POST /api/v1/admin/currency/sync-rates  (must be before /:code to avoid conflict)
  app.post("/sync-rates", { onRequest: [requirePermission("admin.config.edit")] }, async (req, reply) => {
    const result = await syncAutomaticRates(req.user.sub);
    return reply.send({ data: result });
  });

  // POST /api/v1/admin/currency
  app.post("/", { onRequest: [requirePermission("admin.config.edit")] }, async (req, reply) => {
    const body = z.object({
      code:       z.string().min(2).max(5).regex(/^[A-Za-z]+$/),
      name:       z.string().min(2).max(80),
      symbol:     z.string().min(1).max(10),
      rate:       z.number().positive(),
      rateSource: z.enum(["manual", "automatic"]).optional(),
      sortOrder:  z.number().int().min(0).optional(),
      country:    z.string().max(80).optional(),
      flag:       z.string().max(10).optional(),
    }).parse(req.body);
    const entry = await createCurrency(body, req.user.sub);
    return reply.status(201).send({ data: entry });
  });

  // PATCH /api/v1/admin/currency/:code
  app.patch("/:code", { onRequest: [requirePermission("admin.config.edit")] }, async (req, reply) => {
    const { code } = req.params as { code: string };
    const body = z.object({
      name:       z.string().min(2).max(80).optional(),
      symbol:     z.string().min(1).max(10).optional(),
      rate:       z.number().positive().optional(),
      rateSource: z.enum(["manual", "automatic"]).optional(),
      enabled:    z.boolean().optional(),
      sortOrder:  z.number().int().min(0).optional(),
      country:    z.string().max(80).nullable().optional(),
      flag:       z.string().max(10).nullable().optional(),
      isDefault:  z.boolean().optional(),
    }).parse(req.body);
    const entry = await updateCurrency(code, body, req.user.sub);
    return reply.send({ data: entry });
  });

  // DELETE /api/v1/admin/currency/:code
  app.delete("/:code", { onRequest: [requirePermission("admin.config.edit")] }, async (req, reply) => {
    const { code } = req.params as { code: string };
    await deleteCurrency(code);
    return reply.status(204).send();
  });
}
