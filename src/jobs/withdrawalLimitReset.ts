/**
 * Withdrawal Limit Reset Job
 *
 * The limit system is lazy-reset: when getUsedAmounts() is called it checks
 * whether the daily/monthly period has rolled over and resets on-the-fly.
 * This job runs proactively at scheduled intervals so limits are fresh even
 * before the first request of a new day.
 *
 * Schedule:
 *   - Daily reset:   00:01 UTC every day
 *   - Monthly reset: 00:01 UTC on the 1st of each month
 *
 * In production, replace setInterval with a proper cron scheduler
 * (node-cron, Inngest, BullMQ repeatable jobs, or a cloud scheduler).
 *
 * TODO(phase-3h): Move to BullMQ repeatable job for reliability.
 */
import { db } from "../db";

function nowUTC() { return new Date(); }
function todayUTC() { return nowUTC().toISOString().slice(0, 10); }
function thisMonthUTC() { return nowUTC().toISOString().slice(0, 7); }

/** Reset daily limits for all users whose lastDailyReset is before today UTC. */
async function resetDailyLimits(): Promise<number> {
  const result = await db.withdrawalLimit.updateMany({
    where: {
      lastDailyReset: { lt: new Date(todayUTC()) },
    },
    data: {
      dailyUsed:     0,
      lastDailyReset: nowUTC(),
    },
  });
  return result.count;
}

/** Reset monthly limits for all users whose lastMonthlyReset is before this month UTC. */
async function resetMonthlyLimits(): Promise<number> {
  const firstOfMonth = new Date(`${thisMonthUTC()}-01`);
  const result = await db.withdrawalLimit.updateMany({
    where: {
      lastMonthlyReset: { lt: firstOfMonth },
    },
    data: {
      monthlyUsed:      0,
      lastMonthlyReset: nowUTC(),
    },
  });
  return result.count;
}

async function runReset() {
  try {
    const daily   = await resetDailyLimits();
    const monthly = await resetMonthlyLimits();
    if (daily > 0 || monthly > 0) {
      console.log(`[LimitReset] daily=${daily} monthly=${monthly} at ${new Date().toISOString()}`);
    }
  } catch (err) {
    console.error("[LimitReset] Failed:", err);
  }
}

/** Start the proactive reset scheduler. Call once from server startup. */
export function startWithdrawalLimitResetJob(): void {
  // Run once immediately on startup to catch any missed resets
  runReset();

  // Then every 5 minutes — lightweight bulk update, cheap even at scale
  const timer = setInterval(runReset, 5 * 60 * 1000);
  timer.unref(); // don't prevent graceful shutdown
}
