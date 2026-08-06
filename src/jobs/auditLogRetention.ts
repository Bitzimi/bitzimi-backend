/**
 * Audit Log Retention Job
 *
 * Purges AuditLog entries older than system.log_retention_days (default 90).
 * Reads the retention period from SystemConfig at runtime — admin can adjust
 * it via Admin → Platform Settings without a server restart.
 *
 * Schedule: daily (runs once on startup, then every 24 hours).
 */
import { db } from "../db";
import { getConfigValue } from "../modules/admin/config/admin.config.service";

async function purgeExpiredAuditLogs(): Promise<void> {
  const retentionDays = await getConfigValue<number>("system.log_retention_days", 90);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const result = await db.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  if (result.count > 0) {
    console.log(`[AuditLogRetention] Purged ${result.count} audit log entries older than ${retentionDays} days`);
  }
}

export function startAuditLogRetentionJob(): void {
  purgeExpiredAuditLogs().catch(err => console.error("[AuditLogRetention] Error on startup run:", err));
  setInterval(
    () => purgeExpiredAuditLogs().catch(err => console.error("[AuditLogRetention] Error:", err)),
    24 * 60 * 60 * 1000,
  );
}
