/**
 * In-memory one-time PIN verification token store.
 *
 * A PIN token is issued after the user correctly enters their security PIN.
 * The withdrawal endpoint consumes the token (one-time use, 5-minute TTL).
 *
 * TODO(phase-3h): Replace with Redis for multi-instance deployments.
 */
import { randomUUID } from "crypto";

interface PinToken { userId: string; expiresAt: number; }

const store = new Map<string, PinToken>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes

// Cleanup expired tokens every minute
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (v.expiresAt < now) store.delete(k);
  }
}, 60_000);

export function issuePinToken(userId: string): string {
  const token = randomUUID();
  store.set(token, { userId, expiresAt: Date.now() + TTL_MS });
  return token;
}

export function consumePinToken(token: string, userId: string): boolean {
  const record = store.get(token);
  if (!record) return false;
  if (record.userId !== userId) return false;
  if (record.expiresAt < Date.now()) { store.delete(token); return false; }
  store.delete(token); // one-time use
  return true;
}
