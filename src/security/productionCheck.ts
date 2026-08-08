/**
 * Production Environment Validation
 *
 * Called once at server startup. Fails fast in production if:
 *   - JWT secrets are the insecure development defaults
 *   - DATABASE_URL is not set
 *   - CORS origins are using localhost in production
 *
 * In development: logs warnings but does NOT crash.
 */
import { config } from "../config";

const DEV_DEFAULTS = [
  "dev_access_secret",
  "dev_refresh_secret",
  "dev_access_secret_change_in_production",
  "dev_refresh_secret_change_in_production",
];

export function validateProductionConfig(): void {
  const isProduction = config.env === "production";
  const errors: string[] = [];
  const warnings: string[] = [];

  // JWT secrets must not be the dev defaults in production
  if (DEV_DEFAULTS.includes(config.jwt.accessSecret)) {
    const msg = "JWT_ACCESS_SECRET is using the insecure development default";
    isProduction ? errors.push(msg) : warnings.push(msg);
  }
  if (DEV_DEFAULTS.includes(config.jwt.refreshSecret)) {
    const msg = "JWT_REFRESH_SECRET is using the insecure development default";
    isProduction ? errors.push(msg) : warnings.push(msg);
  }

  // Database URL must be configured in production
  if (isProduction && !process.env.DATABASE_URL) {
    errors.push("DATABASE_URL environment variable is not set");
  }

  // CORS origins should not include localhost in production
  const hasLocalhostOrigin = config.cors.origins.some(o => o.includes("localhost"));
  if (isProduction && hasLocalhostOrigin) {
    warnings.push("CORS_ORIGINS contains localhost — ensure this is intentional in production");
  }

  // Anthropic API key should be server-side only (not prefixed with VITE_)
  if (process.env.VITE_ANTHROPIC_API_KEY) {
    warnings.push(
      "VITE_ANTHROPIC_API_KEY is set — this exposes the key in the frontend bundle. " +
      "Use ANTHROPIC_API_KEY (no VITE_ prefix) for server-side Claude API calls."
    );
  }

  if (warnings.length > 0) {
    for (const w of warnings) console.warn(`[Security] ⚠️  ${w}`);
  }

  if (errors.length > 0) {
    console.error("[Security] 🚨 Production configuration errors:");
    for (const e of errors) console.error(`  • ${e}`);
    console.error("[Security] Server startup aborted. Fix the above errors before deploying.");
    process.exit(1);
  }

  if (isProduction) {
    console.log("[Security] ✅ Production configuration validated");
  }
}
