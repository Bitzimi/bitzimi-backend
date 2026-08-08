/**
 * VIP Streak Reminder Job
 *
 * Identifies VIP users who haven't claimed their daily streak reward
 * and sends in-app notifications.
 *
 * Schedule: daily at 18:00 UTC (configurable via STREAK_REMINDER_HOUR)
 * TODO(future): Replace setInterval with BullMQ repeatable job.
 */
import { db } from "../db";
import { createNotification } from "../modules/notifications/notifications.service";

const REMINDER_HOUR = parseInt(process.env.STREAK_REMINDER_HOUR ?? "18", 10);

async function sendStreakReminders(): Promise<void> {
  const now    = new Date();
  const hour   = now.getUTCHours();

  // Only fire at configured reminder hour (±30 minute window)
  if (Math.abs(hour - REMINDER_HOUR) > 0) return;

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Find VIP users who haven't claimed today
  const vipUsers = await db.subscription.findMany({
    where: { isActive: true, endsAt: { gt: now } },
    include: {
      user: {
        include: {
          vipStreak: { select: { lastClaimDate: true, currentStreak: true } },
        },
      },
    },
  });

  const needsReminder = vipUsers.filter(sub => {
    const lastClaim = sub.user.vipStreak?.lastClaimDate;
    return !lastClaim || lastClaim < twentyFourHoursAgo;
  });

  if (needsReminder.length === 0) return;

  console.log(`[StreakReminder] Sending reminders to ${needsReminder.length} VIP user(s)`);

  for (const sub of needsReminder) {
    const nextDay = ((sub.user.vipStreak?.currentStreak ?? 0) % 7) + 1;
    await createNotification({
      userId:  sub.userId,
      type:    "daily_streak",
      title:   "Your daily streak reward is waiting! 🔥",
      message: `Claim your Day ${nextDay} VIP streak reward before midnight.`,
      metadata: { nextDay },
    });
  }
}

export function startStreakReminderJob(): void {
  // Check every 30 minutes — fires the actual logic only at the right hour
  setInterval(sendStreakReminders, 30 * 60 * 1000).unref();
  sendStreakReminders(); // run once on startup (no-op if wrong hour)
}
