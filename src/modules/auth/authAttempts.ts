/**
 * Login Attempt Tracker — persistent brute-force protection.
 *
 * After MAX_ATTEMPTS failed logins within WINDOW_MS from the same email,
 * that email is locked for LOCKOUT_MS milliseconds.
 *
 * State is stored in the LoginAttempt table so it:
 *   - survives server restarts
 *   - is consistent across multiple backend instances sharing the same DB
 *
 * Uses atomic raw SQL upserts to avoid race conditions when concurrent
 * failed login requests arrive simultaneously.
 */

import { db } from "../../db";
import { Prisma } from "@prisma/client";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS   = 15 * 60 * 1000;  // 15 minutes
const WINDOW_MS    =  5 * 60 * 1000;  // 5-minute sliding window

/**
 * Check whether an email is currently locked out.
 * Throws 429 if locked. No-op if clear.
 */
export async function checkLockout(email: string): Promise<void> {
  const key = email.toLowerCase();
  const rec = await db.loginAttempt.findUnique({ where: { email: key } });
  if (!rec?.lockedUntil) return;

  const now = new Date();
  if (now >= rec.lockedUntil) {
    // Lock has expired — clear the row so future attempts start fresh
    await db.loginAttempt.delete({ where: { email: key } }).catch(() => {});
    return;
  }

  const remainingS = Math.ceil((rec.lockedUntil.getTime() - now.getTime()) / 1000);
  throw Object.assign(
    new Error(`Account temporarily locked due to too many failed attempts. Try again in ${remainingS}s.`),
    { statusCode: 429, code: "ACCOUNT_LOCKED", retryAfterSeconds: remainingS },
  );
}

/** Record a successful login — deletes the attempt row entirely. */
export async function recordSuccess(email: string): Promise<void> {
  await db.loginAttempt.delete({ where: { email: email.toLowerCase() } }).catch(() => {});
}

/**
 * Record a failed login attempt — locks the email after MAX_ATTEMPTS within WINDOW_MS.
 *
 * Uses an atomic SQL upsert (INSERT ... ON CONFLICT DO UPDATE) so concurrent
 * requests from multiple instances reliably increment the counter without races.
 */
export async function recordFailure(email: string): Promise<void> {
  const key          = email.toLowerCase();
  const now          = new Date();
  const windowStart  = new Date(now.getTime() - WINDOW_MS);

  // Atomic upsert: if the row is new OR the window has expired, reset count to 1.
  // Otherwise increment the existing count within the window.
  // Uses standard ON CONFLICT … DO UPDATE (ANSI SQL — PostgreSQL compatible).
  await db.$executeRaw`
    INSERT INTO login_attempts (email, fail_count, window_start, locked_until, updated_at)
    VALUES (${key}, 1, ${now}, NULL, ${now})
    ON CONFLICT (email) DO UPDATE SET
      fail_count   = CASE
                       WHEN login_attempts.window_start < ${windowStart}
                       THEN 1
                       ELSE login_attempts.fail_count + 1
                     END,
      window_start = CASE
                       WHEN login_attempts.window_start < ${windowStart}
                       THEN ${now}
                       ELSE login_attempts.window_start
                     END,
      updated_at   = ${now}
  `;

  // Read back the new count and apply lock if threshold reached
  const rec = await db.loginAttempt.findUnique({ where: { email: key } });
  if (rec && rec.failCount >= MAX_ATTEMPTS && !rec.lockedUntil) {
    const lockedUntil = new Date(now.getTime() + LOCKOUT_MS);
    await db.loginAttempt.update({ where: { email: key }, data: { lockedUntil } });
    console.warn(`[AuthAttempts] Account locked: ${email} (${rec.failCount} failures in ${WINDOW_MS / 1000}s window)`);
  }
}
