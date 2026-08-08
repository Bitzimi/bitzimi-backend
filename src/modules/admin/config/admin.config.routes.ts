/**
 * Admin System Configuration Routes
 *
 * GET  /api/v1/admin/config          — list all config entries
 * GET  /api/v1/admin/config/:key     — get one entry
 * PUT  /api/v1/admin/config/:key     — set/update one entry
 * DELETE /api/v1/admin/config/:key   — remove one entry
 */
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import { auditLogHook } from "../../../middleware/auditLog";
import {
  listConfig,
  getConfig,
  setConfig,
  deleteConfig,
} from "./admin.config.service";
import { invalidateMaintenanceCache } from "../../../middleware/maintenanceMode";

export async function adminConfigRoutes(app: FastifyInstance) {
  app.addHook("onRequest",  authenticate);
  app.addHook("onResponse", auditLogHook);

  // GET /api/v1/admin/config — list all
  app.get("/", { onRequest: [requirePermission("admin.config.view")] }, async (_req, reply) => {
    return reply.send({ data: await listConfig() });
  });

  // GET /api/v1/admin/config/:key — get one
  app.get("/:key", { onRequest: [requirePermission("admin.config.view")] }, async (req, reply) => {
    const { key } = req.params as { key: string };
    const entry = await getConfig(decodeURIComponent(key));
    if (!entry) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Config key "${key}" not set` } });
    return reply.send({ data: entry });
  });

  // PUT /api/v1/admin/config/:key — set/update
  app.put("/:key", { onRequest: [requirePermission("admin.config.edit")] }, async (req, reply) => {
    const { key } = req.params as { key: string };
    const body = z.object({
      value:       z.any(),
      description: z.string().max(300).optional(),
    }).parse(req.body);

    const decodedKey = decodeURIComponent(key);
    const previous   = await getConfig(decodedKey);

    const entry = await setConfig(decodedKey, body.value, req.user.sub, body.description);

    // Immediately clear the maintenance cache so the new value takes effect
    // without waiting for the 10-second TTL to expire.
    if (decodedKey.startsWith("maintenance.")) {
      invalidateMaintenanceCache();
    }

    // Attach previousValue/newValue so auditLogHook can persist them
    (reply as any).__auditPreviousValue = previous?.rawValue ?? null;
    (reply as any).__auditNewValue      = entry.rawValue;

    return reply.send({ data: entry });
  });

  // DELETE /api/v1/admin/config/:key — remove
  app.delete("/:key", { onRequest: [requirePermission("admin.config.edit")] }, async (req, reply) => {
    const { key } = req.params as { key: string };
    const deleted = await deleteConfig(decodeURIComponent(key));
    if (!deleted) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Config key "${key}" not found` } });
    return reply.status(204).send();
  });
}
