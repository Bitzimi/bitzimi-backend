/**
 * Maintenance Mode Middleware
 *
 * When maintenance.enabled = true in SystemConfig, all non-admin API requests
 * receive a 503 response with the maintenance message.
 *
 * Admin users (role != "user" and role != undefined) bypass maintenance and
 * can continue to use the platform normally.
 *
 * Routes that are always allowed:
 *   - GET /health
 *   - POST /api/v1/auth/login  (admins need to be able to log in)
 *   - POST /api/v1/auth/refresh
 *   - GET  /api/v1/public/*    (landing page stats)
 */
import { FastifyRequest, FastifyReply } from "fastify";
import { isMaintenanceEnabled, getConfigValue } from "../modules/admin/config/admin.config.service";

// Paths always allowed regardless of maintenance mode
const ALWAYS_ALLOWED = [
  "/health",
  "/api/v1/auth/login",
  "/api/v1/auth/register",  // allow new admin accounts to be created
  "/api/v1/auth/refresh",
  "/api/v1/public/",
];

// Cache maintenance state for up to 10 seconds to avoid a DB hit on every request
let _cachedEnabled: boolean = false;
let _cachedAt:      number  = 0;
const CACHE_TTL_MS  = 10_000;

async function checkMaintenance(): Promise<boolean> {
  if (Date.now() - _cachedAt < CACHE_TTL_MS) return _cachedEnabled;
  _cachedEnabled = await isMaintenanceEnabled();
  _cachedAt      = Date.now();
  return _cachedEnabled;
}

/** Call this to invalidate the maintenance cache immediately (e.g., after a config update). */
export function invalidateMaintenanceCache(): void {
  _cachedAt = 0;
}

export async function maintenanceModeHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Fast path: skip check if maintenance is known to be off
  const enabled = await checkMaintenance();
  if (!enabled) return;

  // Always allow certain paths
  const url = req.url;
  if (ALWAYS_ALLOWED.some(p => url.startsWith(p))) return;

  // Admin users bypass maintenance mode
  const role = req.user?.role;
  if (role && role !== "user") return;

  const message = await getConfigValue<string>(
    "maintenance.message",
    "Platform is under maintenance. Please try again shortly."
  );

  reply.status(503).send({
    error: {
      code:    "MAINTENANCE",
      message,
      retryAfter: 60,
    },
  });
}
