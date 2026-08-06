/**
 * Screenshot Retention Job
 *
 * Deletes task proof screenshots older than RETENTION_DAYS (default 90).
 * Matches the frontend VerificationConfig retention policy.
 *
 * Schedule: daily at 02:00 UTC
 * TODO(phase-3h): Replace setInterval with BullMQ repeatable job.
 *
 * NOTE: In production (S3 storage), this deletes S3 objects.
 * In local development, it deletes files from ./uploads/tasks/proofs/.
 */
import { db } from "../db";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";

const RETENTION_DAYS = parseInt(process.env.PROOF_RETENTION_DAYS ?? "90", 10);
const UPLOADS_DIR    = join(process.cwd(), "uploads");

async function deleteExpiredScreenshots(): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  // Find proof screenshots older than retention window where proof is settled
  const staleScreenshots = await db.taskProofScreenshot.findMany({
    where: {
      uploadedAt: { lt: cutoff },
      proof: {
        status: { in: ["approved", "rejected", "admin_approved", "admin_rejected"] },
      },
    },
    take: 500, // batch limit
  });

  if (staleScreenshots.length === 0) return;

  let deleted = 0;
  for (const s of staleScreenshots) {
    try {
      // Local storage deletion
      const localPath = join(UPLOADS_DIR, s.storageKey);
      if (existsSync(localPath)) unlinkSync(localPath);

      // TODO(production): delete from S3
      // await s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: s.storageKey }));

      await db.taskProofScreenshot.delete({ where: { id: s.id } });
      deleted++;
    } catch (err) {
      console.error(`[Retention] Failed to delete screenshot ${s.id}:`, err);
    }
  }

  if (deleted > 0) {
    console.log(`[Retention] Deleted ${deleted} expired proof screenshots (>${RETENTION_DAYS}d old)`);
  }
}

export function startScreenshotRetentionJob(): void {
  // Run once on startup, then every 24 hours
  deleteExpiredScreenshots().catch(err => console.error("[Retention] Startup run failed:", err));
  const timer = setInterval(deleteExpiredScreenshots, 24 * 60 * 60 * 1000);
  timer.unref(); // don't prevent graceful shutdown
}
