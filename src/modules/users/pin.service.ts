import { db } from "../../db";
import { hashPin, verifyPin } from "../../utils/hash";
import { issuePinToken } from "../withdrawals/pinTokens";

// ── PIN brute-force protection ─────────────────────────────────────────────────
// In-memory tracker: userId → { failCount, windowStart, lockedUntil }.
// Resets on server restart — acceptable because the user must already hold a
// valid JWT to reach this endpoint. Without lockout, a 4-digit PIN (10,000
// combinations) is breakable in ~50 min at the global 200/min rate limit.
// With this guard, 5 failures within 5 minutes → 15-minute account lock.

const PIN_MAX_ATTEMPTS = 5;
const PIN_WINDOW_MS    = 5 * 60 * 1000;   // 5-minute sliding window
const PIN_LOCKOUT_MS   = 15 * 60 * 1000;  // 15-minute lockout

interface PinAttemptRecord { failCount: number; windowStart: number; lockedUntil: number | null; }
const pinAttempts = new Map<string, PinAttemptRecord>();

function checkPinLockout(userId: string): void {
  const rec = pinAttempts.get(userId);
  if (!rec?.lockedUntil) return;
  if (Date.now() < rec.lockedUntil) {
    const secsLeft = Math.ceil((rec.lockedUntil - Date.now()) / 1000);
    throw Object.assign(
      new Error(`Too many incorrect PIN attempts. Try again in ${secsLeft} seconds.`),
      { statusCode: 429, code: "PIN_LOCKED" },
    );
  }
  // Lock has expired — clear record
  pinAttempts.delete(userId);
}

function recordPinFailure(userId: string): void {
  const now = Date.now();
  const rec = pinAttempts.get(userId) ?? { failCount: 0, windowStart: now, lockedUntil: null };
  if (now - rec.windowStart > PIN_WINDOW_MS) {
    // Outside the window — start fresh
    rec.failCount   = 1;
    rec.windowStart = now;
    rec.lockedUntil = null;
  } else {
    rec.failCount += 1;
  }
  if (rec.failCount >= PIN_MAX_ATTEMPTS) {
    rec.lockedUntil = now + PIN_LOCKOUT_MS;
  }
  pinAttempts.set(userId, rec);
}

function clearPinAttempts(userId: string): void {
  pinAttempts.delete(userId);
}

/** Set or update the user's 4-digit security PIN. */
export async function setSecurityPin(userId: string, pin: string): Promise<void> {
  const existing = await db.securityPin.findUnique({ where: { userId } });
  const pinHash  = await hashPin(pin);
  await db.securityPin.upsert({
    where:  { userId },
    update: { pinHash },
    create: { userId, pinHash },
  });

  setImmediate(() =>
    db.auditLog.create({ data: {
      actorId: userId, action: existing ? "USER change_security_pin" : "USER set_security_pin",
      targetType: "user", targetId: userId, httpStatus: 200,
    }}).catch(() => {})
  );
}

/**
 * Verify the PIN and issue a one-time PIN token.
 * The token is passed to POST /withdrawals and consumed on first use (5-min TTL).
 */
export async function verifySecurityPin(
  userId: string,
  pin: string
): Promise<{ pinToken: string; expiresInSeconds: number }> {
  // Brute-force guard — throws 429 if account is locked
  checkPinLockout(userId);

  const record = await db.securityPin.findUnique({ where: { userId } });
  if (!record) {
    throw Object.assign(
      new Error("No security PIN set. Configure your PIN in Settings first."),
      { statusCode: 400, code: "PIN_NOT_SET" }
    );
  }
  const valid = await verifyPin(pin, record.pinHash);
  if (!valid) {
    recordPinFailure(userId);
    throw Object.assign(new Error("Incorrect PIN"), { statusCode: 401, code: "INCORRECT_PIN" });
  }
  clearPinAttempts(userId);
  return { pinToken: issuePinToken(userId), expiresInSeconds: 300 };
}
