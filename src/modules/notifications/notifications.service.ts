/**
 * Notifications Service
 *
 * Stores and retrieves in-app notifications for users.
 * Notifications are created server-side by game settlement, task approval,
 * KYC decisions, VIP streak reminders, and admin broadcasts.
 *
 * TODO(phase-3h): Add WebSocket broadcast so clients receive notifications
 * in real time instead of polling. WebSocket channel per userId.
 */
import { db } from "../../db";

// ── Create a notification (called internally by other modules) ────────────────

export async function createNotification(opts: {
  userId:    string;
  type:      string;
  title:     string;
  message:   string;
  metadata?: object;
}): Promise<void> {
  await db.notification.create({
    data: {
      userId:   opts.userId,
      type:     opts.type,
      title:    opts.title,
      message:  opts.message,
      metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
    },
  }).catch(err => console.error("[Notification] create failed:", err));
}

// ── List notifications (paginated, newest first) ──────────────────────────────

export async function listNotifications(userId: string, opts: { cursor?: string; limit?: number }) {
  const { cursor, limit = 30 } = opts;
  const where: any = { userId };
  if (cursor) {
    const anchor = await db.notification.findUnique({ where: { id: cursor } });
    if (anchor) where.createdAt = { lt: anchor.createdAt };
  }

  const rows = await db.notification.findMany({
    where, orderBy: { createdAt: "desc" }, take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const items   = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: items.map(n => ({
      id:        n.id,
      type:      n.type,
      title:     n.title,
      message:   n.message,
      read:      n.read,
      metadata:  n.metadata ? JSON.parse(n.metadata as string) : null,
      createdAt: n.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? items[items.length - 1].id : null,
    hasMore,
  };
}

// ── Unread count ──────────────────────────────────────────────────────────────

export async function getUnreadCount(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, read: false } });
}

// ── Mark single notification as read ─────────────────────────────────────────

export async function markRead(userId: string, notificationId: string): Promise<void> {
  await db.notification.updateMany({
    where: { id: notificationId, userId },
    data:  { read: true },
  });
}

// ── Mark all as read ──────────────────────────────────────────────────────────

export async function markAllRead(userId: string): Promise<void> {
  await db.notification.updateMany({
    where: { userId, read: false },
    data:  { read: true },
  });
}

// ── Delete single notification ────────────────────────────────────────────────

export async function deleteNotification(userId: string, notificationId: string): Promise<void> {
  await db.notification.deleteMany({ where: { id: notificationId, userId } });
}

// ── Delete all notifications ──────────────────────────────────────────────────

export async function deleteAllNotifications(userId: string): Promise<void> {
  await db.notification.deleteMany({ where: { userId } });
}

// ── Admin broadcast ───────────────────────────────────────────────────────────

export async function broadcastNotification(opts: {
  type:     string;
  title:    string;
  message:  string;
  segment?: "all" | "vip" | "verified";
  metadata?: object;
}): Promise<{ sent: number }> {
  const { type, title, message, segment = "all", metadata } = opts;

  let userIds: string[];

  if (segment === "vip") {
    const subs = await db.subscription.findMany({
      where: { isActive: true, endsAt: { gt: new Date() } },
      select: { userId: true },
    });
    userIds = subs.map(s => s.userId);
  } else if (segment === "verified") {
    const kycs = await db.kycSubmission.findMany({
      where: { status: "verified" },
      select: { userId: true },
    });
    userIds = kycs.map(k => k.userId);
  } else {
    const users = await db.user.findMany({
      where: { suspendedAt: null },
      select: { id: true },
    });
    userIds = users.map(u => u.id);
  }

  const metaString = metadata ? JSON.stringify(metadata) : null;
  await db.notification.createMany({
    data: userIds.map(userId => ({ userId, type, title, message, metadata: metaString })),
  });

  return { sent: userIds.length };
}
