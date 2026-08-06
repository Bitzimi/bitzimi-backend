/**
 * Admin Notification Service — platform-wide notification oversight.
 *
 * Admins with admin.notifications.view can read and inspect all notifications.
 * Admins with admin.notifications.manage can delete individual notifications.
 * Admins with admin.notifications.broadcast can send global announcements.
 *
 * Broadcast logic lives in the user-facing notifications.service.ts and is
 * re-exported here for admin route use.
 */
import { db } from "../../../db";

export interface AdminNotificationItem {
  id:        string;
  userId:    string;
  username:  string | null;
  email:     string;
  type:      string;
  title:     string;
  message:   string;
  read:      boolean;
  createdAt: string;
}

// ── Statistics ─────────────────────────────────────────────────────────────────

export async function adminGetNotificationStats() {
  const since7d  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000);
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [total, unread, last7d, last30d, byType] = await Promise.all([
    db.notification.count(),
    db.notification.count({ where: { read: false } }),
    db.notification.count({ where: { createdAt: { gte: since7d } } }),
    db.notification.count({ where: { createdAt: { gte: since30d } } }),
    db.notification.groupBy({
      by: ["type"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    }),
  ]);

  return {
    total,
    unread,
    read: total - unread,
    last7d,
    last30d,
    byType: byType.map(r => ({ type: r.type, count: r._count.id })),
  };
}

// ── List all notifications (admin oversight) ───────────────────────────────────

export async function adminListNotifications(opts: {
  userId?: string;
  type?:   string;
  read?:   boolean;
  cursor?: string;
  limit?:  number;
}) {
  const { userId, type, read, cursor, limit = 50 } = opts;
  const take = Math.min(limit, 100);

  const where: any = {};
  if (userId) where.userId = userId;
  if (type)   where.type   = type;
  if (read !== undefined) where.read = read;

  if (cursor) {
    const anchor = await db.notification.findUnique({ where: { id: cursor } });
    if (anchor) {
      where.createdAt = { lt: anchor.createdAt };
    }
  }

  const rows = await db.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: take + 1,
    include: {
      user: {
        select: { email: true, profile: { select: { username: true } } },
      },
    },
  });

  const hasMore    = rows.length > take;
  const items      = hasMore ? rows.slice(0, take) : rows;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return {
    items: items.map(n => ({
      id:        n.id,
      userId:    n.userId,
      username:  n.user.profile?.username ?? null,
      email:     n.user.email,
      type:      n.type,
      title:     n.title,
      message:   n.message,
      read:      n.read,
      createdAt: n.createdAt.toISOString(),
    })) satisfies AdminNotificationItem[],
    nextCursor,
    hasMore,
  };
}

// ── Delete a specific notification ─────────────────────────────────────────────

export async function adminDeleteNotification(id: string) {
  const n = await db.notification.findUnique({ where: { id } });
  if (!n) throw Object.assign(new Error("Notification not found"), { statusCode: 404 });
  await db.notification.delete({ where: { id } });
  return { deleted: true };
}

// ── Delete all notifications for a specific user ───────────────────────────────

export async function adminDeleteUserNotifications(userId: string) {
  const { count } = await db.notification.deleteMany({ where: { userId } });
  return { deleted: count };
}

// ── Notification type distribution (for filter dropdown) ──────────────────────

export async function adminListNotificationTypes() {
  const rows = await db.notification.groupBy({
    by: ["type"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });
  return rows.map(r => ({ type: r.type, count: r._count.id }));
}
