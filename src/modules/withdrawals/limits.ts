import { db } from "../../db";
import { dec } from "../../utils/dec";
import { config } from "../../config";
import { getConfigValue } from "../admin/config/admin.config.service";

export type UserTier = "free" | "verified" | "vip";

// Read tier caps from SystemConfig; fall back to config.ts hardcoded values if not set.
// SystemConfig keys: withdrawal.limits.{tier}.daily / .monthly
// Admin changes take effect immediately (no cache).
export async function getTierLimits(tier: UserTier): Promise<{ daily: number; monthly: number }> {
  const fallback = config.withdrawalLimits[tier];
  const [daily, monthly] = await Promise.all([
    getConfigValue<number>(`withdrawal.limits.${tier}.daily`,   fallback.daily),
    getConfigValue<number>(`withdrawal.limits.${tier}.monthly`, fallback.monthly),
  ]);
  return { daily, monthly };
}

export async function resolveUserTier(userId: string): Promise<UserTier> {
  const [kyc, sub] = await Promise.all([
    db.kycSubmission.findUnique({ where: { userId } }),
    db.subscription.findUnique({ where: { userId } }),
  ]);
  const isVIP = !!(sub?.isActive && sub.endsAt > new Date());
  if (isVIP) return "vip";
  if (kyc?.status === "verified") return "verified";
  return "free";
}

function todayUTC()    { return new Date().toISOString().slice(0, 10); }
function thisMonthUTC(){ return new Date().toISOString().slice(0, 7); }

export async function getUsedAmounts(userId: string): Promise<{ dailyUsed: number; monthlyUsed: number }> {
  const rec = await db.withdrawalLimit.findUnique({ where: { userId } });
  if (!rec) return { dailyUsed: 0, monthlyUsed: 0 };

  const today     = todayUTC();
  const thisMonth = thisMonthUTC();
  const lastDaily   = rec.lastDailyReset.toISOString().slice(0, 10);
  const lastMonthly = rec.lastMonthlyReset.toISOString().slice(0, 7);

  const dailyUsed   = lastDaily   === today    ? dec(rec.dailyUsed)   : 0;
  const monthlyUsed = lastMonthly === thisMonth ? dec(rec.monthlyUsed) : 0;

  if (lastDaily !== today || lastMonthly !== thisMonth) {
    await db.withdrawalLimit.update({ where: { userId }, data: { dailyUsed, monthlyUsed, lastDailyReset: new Date(), lastMonthlyReset: new Date() } });
  }
  return { dailyUsed, monthlyUsed };
}

export interface LimitCheckResult {
  allowed: boolean; reason?: string;
  dailyLimit: number; monthlyLimit: number;
  dailyUsed: number; monthlyUsed: number;
  dailyRemaining: number; monthlyRemaining: number;
}

export async function checkLimit(userId: string, amount: number, tier: UserTier): Promise<LimitCheckResult> {
  const limits = await getTierLimits(tier);
  const { dailyUsed, monthlyUsed } = await getUsedAmounts(userId);
  const dailyRemaining   = Math.max(0, limits.daily   - dailyUsed);
  const monthlyRemaining = Math.max(0, limits.monthly - monthlyUsed);

  if (amount > dailyRemaining) return { allowed: false, reason: `Daily withdrawal limit exceeded. Remaining today: $${dailyRemaining.toLocaleString()}`, dailyLimit: limits.daily, monthlyLimit: limits.monthly, dailyUsed, monthlyUsed, dailyRemaining, monthlyRemaining };
  if (amount > monthlyRemaining) return { allowed: false, reason: `Monthly withdrawal limit exceeded. Remaining this month: $${monthlyRemaining.toLocaleString()}`, dailyLimit: limits.daily, monthlyLimit: limits.monthly, dailyUsed, monthlyUsed, dailyRemaining, monthlyRemaining };
  return { allowed: true, dailyLimit: limits.daily, monthlyLimit: limits.monthly, dailyUsed, monthlyUsed, dailyRemaining, monthlyRemaining };
}

export async function recordWithdrawal(userId: string, amount: number, tx?: any): Promise<void> {
  // Accepts an optional Prisma transaction client (tx) so it can be called inside
  // a db.$transaction — making the limit increment atomic with the wallet debit.
  // Falls back to db for any standalone callers.
  // Atomic increment prevents concurrent withdrawals from overwriting each other's
  // usage counts (PostgreSQL READ COMMITTED race).
  const client = tx ?? db;
  await client.withdrawalLimit.upsert({
    where:  { userId },
    create: { userId, dailyUsed: amount, monthlyUsed: amount, lastDailyReset: new Date(), lastMonthlyReset: new Date() },
    update: { dailyUsed: { increment: amount }, monthlyUsed: { increment: amount } },
  });
}

/**
 * Atomically checks and claims the withdrawal limit allowance inside an open transaction.
 *
 * Problem this solves: checkLimit() reads dailyUsed/monthlyUsed outside the transaction,
 * so two concurrent withdrawal requests can both pass the limit check before either records
 * usage — effectively doubling the withdrawal against a single limit window.
 *
 * Fix: at the START of the db.$transaction, acquire a row-level lock on the
 * withdrawal_limits row (SELECT ... FOR UPDATE). This serializes concurrent requests
 * for the same user: the second request blocks until the first transaction commits,
 * then re-reads the committed dailyUsed (which now includes the first request) and
 * correctly rejects if the limit is exceeded.
 *
 * After the lock + re-check pass, delegates to recordWithdrawal() for the increment.
 * If the surrounding transaction rolls back (e.g. insufficient wallet balance), the
 * increment rolls back too — limits are never left inconsistent.
 */
export async function claimWithdrawalLimit(
  userId:     string,
  amount:     number,
  tierLimits: { daily: number; monthly: number },
  tx:         any,
): Promise<void> {
  // Step 1: Ensure the row exists so FOR UPDATE has something to lock.
  // ON CONFLICT DO NOTHING is a no-op for existing rows.
  await tx.$executeRaw`
    INSERT INTO withdrawal_limits (user_id, daily_used, monthly_used, last_daily_reset, last_monthly_reset)
    VALUES (${userId}, 0, 0, NOW(), NOW())
    ON CONFLICT (user_id) DO NOTHING
  `;

  // Step 2: Lock the row for the duration of this transaction.
  // Any concurrent withdrawal for this user blocks here until we commit or roll back.
  const rows = await tx.$queryRaw<Array<{
    daily_used:         number;
    monthly_used:       number;
    last_daily_reset:   Date;
    last_monthly_reset: Date;
  }>>`
    SELECT daily_used, monthly_used, last_daily_reset, last_monthly_reset
    FROM withdrawal_limits
    WHERE user_id = ${userId}
    FOR UPDATE
  `;

  const row         = rows[0]; // guaranteed to exist after the INSERT above
  const today       = new Date().toISOString().slice(0, 10);
  const thisMonth   = new Date().toISOString().slice(0, 7);
  const lastDaily   = row.last_daily_reset.toISOString().slice(0, 10);
  const lastMonthly = row.last_monthly_reset.toISOString().slice(0, 7);

  // Apply the same reset logic as getUsedAmounts: if the period has rolled over,
  // treat the used amount as 0 (the reset will be written by recordWithdrawal below).
  const lockedDailyUsed   = lastDaily   === today    ? dec(row.daily_used)   : 0;
  const lockedMonthlyUsed = lastMonthly === thisMonth ? dec(row.monthly_used) : 0;

  if (lockedDailyUsed + amount > tierLimits.daily) {
    const remaining = Math.max(0, tierLimits.daily - lockedDailyUsed);
    throw Object.assign(
      new Error(`Daily withdrawal limit exceeded. Remaining today: $${remaining.toLocaleString()}`),
      { statusCode: 400, code: "LIMIT_EXCEEDED" },
    );
  }
  if (lockedMonthlyUsed + amount > tierLimits.monthly) {
    const remaining = Math.max(0, tierLimits.monthly - lockedMonthlyUsed);
    throw Object.assign(
      new Error(`Monthly withdrawal limit exceeded. Remaining this month: $${remaining.toLocaleString()}`),
      { statusCode: 400, code: "LIMIT_EXCEEDED" },
    );
  }

  // Step 3: Claim the allowance — increment inside the same transaction while the lock is held.
  await recordWithdrawal(userId, amount, tx);
}
