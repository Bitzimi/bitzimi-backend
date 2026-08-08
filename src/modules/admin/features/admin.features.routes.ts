/**
 * Admin Feature Management Routes — Phase 24.2
 *
 * Provides a typed, feature-specific API on top of the raw SystemConfig store.
 * Admin controls feature access levels and boolean flags from here.
 *
 * Feature access levels: "all" | "vip" | "staff" | "admin" | "disabled"
 */
import { FastifyInstance } from "fastify";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import { listConfig, setConfig, type FeatureAccessLevel } from "../config/admin.config.service";

const ACCESS_LEVELS: FeatureAccessLevel[] = ["all", "vip", "staff", "admin", "disabled"];

export async function adminFeaturesRoutes(app: FastifyInstance): Promise<void> {
  const viewGuard = [authenticate, requirePermission("admin.config.view")];
  const editGuard = [authenticate, requirePermission("admin.config.edit")];

  // GET / — list all feature flags and access levels
  app.get("/", { preHandler: viewGuard }, async (_req, reply) => {
    const allConfig = await listConfig();

    // Boolean feature flags (feature.* but NOT feature.access.*)
    const flags = allConfig
      .filter(c => c.key.startsWith("feature.") && !c.key.startsWith("feature.access."))
      .map(c => ({
        name:        c.key.replace("feature.", ""),
        key:         c.key,
        enabled:     !!c.value,
        description: c.description,
        updatedAt:   c.updatedAt,
        updatedBy:   c.updatedBy,
      }));

    // Feature access levels (feature.access.*)
    const accessLevels = allConfig
      .filter(c => c.key.startsWith("feature.access."))
      .map(c => ({
        name:        c.key.replace("feature.access.", ""),
        key:         c.key,
        level:       (c.value as FeatureAccessLevel) ?? "all",
        description: c.description,
        updatedAt:   c.updatedAt,
        updatedBy:   c.updatedBy,
      }));

    return reply.send({ data: { flags, accessLevels } });
  });

  // PUT /flag/:name — toggle a boolean feature flag on/off
  app.put("/flag/:name", { preHandler: editGuard }, async (req, reply) => {
    const { name } = req.params as { name: string };
    const body = req.body as any;
    if (typeof body?.enabled !== "boolean") {
      return reply.status(400).send({ error: { message: "body.enabled (boolean) is required" } });
    }
    const key = `feature.${name}`;
    const updated = await setConfig(key, body.enabled, req.user.sub);
    return reply.send({ data: { name, key, enabled: updated.value } });
  });

  // PUT /access/:name — set access level for a feature
  app.put("/access/:name", { preHandler: editGuard }, async (req, reply) => {
    const { name } = req.params as { name: string };
    const body = req.body as any;
    const level = body?.level as FeatureAccessLevel;
    if (!ACCESS_LEVELS.includes(level)) {
      return reply.status(400).send({
        error: { message: `level must be one of: ${ACCESS_LEVELS.join(", ")}` },
      });
    }
    const key = `feature.access.${name}`;
    const updated = await setConfig(key, level, req.user.sub);
    return reply.send({ data: { name, key, level: updated.value } });
  });
}
