/**
 * Admin middleware — enforces role and permission checks.
 *
 * Usage in a route plugin:
 *   app.addHook("onRequest", authenticate);
 *   app.addHook("onRequest", requirePermission("admin.kyc.approve"));
 *
 * ROLE_PERMISSIONS is the single source of truth in utils/rolePermissions.ts.
 * The frontend mirrors it in src/app/admin/permissions.ts for UI-only hints.
 */
import { FastifyRequest, FastifyReply } from "fastify";
import { UserRole } from "../../utils/jwt";
import { roleHasPermission } from "../../utils/rolePermissions";

/** Fastify hook factory — call with the required permission string. */
export function requirePermission(permission: string) {
  return async function permissionGuard(req: FastifyRequest, reply: FastifyReply) {
    const role = req.user?.role as UserRole | undefined;
    if (!role || role === "user") {
      return reply.status(403).send({
        error: { code: "FORBIDDEN", message: "Admin access required" },
      });
    }
    if (!roleHasPermission(role, permission)) {
      return reply.status(403).send({
        error: {
          code: "INSUFFICIENT_PERMISSION",
          message: `Missing permission: ${permission}`,
        },
      });
    }
  };
}
