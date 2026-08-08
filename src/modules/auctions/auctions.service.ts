import { db } from "../../db";
import { getConfigValue } from "../admin/config/admin.config.service";
import { broadcast } from "./auctions.sse";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuctionPublic {
  id: string;
  title: string;
  description: string | null;
  rewardType: string;
  rewardName: string | null;
  rewardValue: number;
  rewardImageUrl: string | null;
  bidAmount: number;
  durationMinutes: number;
  extensionWindowSeconds: number;
  extensionDurationSeconds: number;
  startsAt: string;
  endsAt: string | null;
  status: string;
  currentLeaderId: string | null;
  currentLeaderMasked: string | null;
  currentPool: number;
  bidCount: number;
  participantCount: number;
  extensionCount: number;
  lastBidAt: string | null;
  createdAt: string;
}

export interface AuctionAdmin extends AuctionPublic {
  visibility: string;
  createdBy: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface AuctionBidPublic {
  id: string;
  auctionId: string;
  userId: string;
  bidNumber: number;
  isLeading: boolean;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function maskLeader(id: string | null): string | null {
  if (!id) return null;
  return id.slice(0, 4) + "****";
}

function toPublic(a: any): AuctionPublic {
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    rewardType: a.rewardType ?? a.reward_type,
    rewardName: a.rewardName ?? a.reward_name,
    rewardValue: a.rewardValue ?? a.reward_value,
    rewardImageUrl: a.rewardImageUrl ?? a.reward_image_url,
    bidAmount: a.bidAmount ?? a.bid_amount,
    durationMinutes: a.durationMinutes ?? a.duration_minutes,
    extensionWindowSeconds: a.extensionWindowSeconds ?? a.extension_window_seconds,
    extensionDurationSeconds: a.extensionDurationSeconds ?? a.extension_duration_seconds,
    startsAt: (a.startsAt ?? a.starts_at)?.toISOString?.() ?? a.startsAt ?? a.starts_at,
    endsAt: (a.endsAt ?? a.ends_at)?.toISOString?.() ?? a.endsAt ?? a.ends_at ?? null,
    status: a.status,
    currentLeaderId: a.currentLeaderId ?? a.current_leader_id,
    currentLeaderMasked: maskLeader(a.currentLeaderId ?? a.current_leader_id),
    currentPool: a.currentPool ?? a.current_pool,
    bidCount: a.bidCount ?? a.bid_count,
    participantCount: a.participantCount ?? a.participant_count,
    extensionCount: a.extensionCount ?? a.extension_count,
    lastBidAt: (a.lastBidAt ?? a.last_bid_at)?.toISOString?.() ?? a.lastBidAt ?? a.last_bid_at ?? null,
    createdAt: (a.createdAt ?? a.created_at)?.toISOString?.() ?? a.createdAt ?? a.created_at,
  };
}

function toAdmin(a: any): AuctionAdmin {
  return {
    ...toPublic(a),
    visibility: a.visibility,
    createdBy: a.createdBy ?? a.created_by,
    updatedBy: a.updatedBy ?? a.updated_by ?? null,
    updatedAt: (a.updatedAt ?? a.updated_at)?.toISOString?.() ?? a.updatedAt ?? a.updated_at,
  };
}

async function recordStatusHistory(
  auctionId: string,
  fromStatus: string | null,
  toStatus: string,
  changedBy: string,
  reason?: string,
  metadata?: object
) {
  await db.auctionStatusHistory.create({
    data: {
      auctionId,
      fromStatus,
      toStatus,
      changedBy,
      reason,
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
  });
}

// ─── Public User API ─────────────────────────────────────────────────────────

export async function listPublicAuctions(): Promise<AuctionPublic[]> {
  const [auctionEnabled, auctionLive] = await Promise.all([
    getConfigValue<boolean>("feature.auction_marketplace", false),
    getConfigValue<boolean>("feature.auction_live", false),
  ]);
  if (!auctionEnabled) throw new Error("Auction marketplace is not currently available.");

  // When feature.auction_live is false, hide in-progress live auctions from users
  const statusFilter = auctionLive ? ["upcoming", "live", "ended"] : ["upcoming", "ended"];

  const rows = await db.auction.findMany({
    where: { visibility: "public", status: { in: statusFilter } },
    orderBy: [{ status: "asc" }, { startsAt: "asc" }],
  });
  return rows.map(toPublic);
}

export async function getPublicAuction(id: string): Promise<AuctionPublic> {
  const auctionEnabled = await getConfigValue<boolean>("feature.auction_marketplace", false);
  if (!auctionEnabled) throw new Error("Auction marketplace is not currently available.");

  const row = await db.auction.findFirst({
    where: { id, visibility: "public", status: { in: ["upcoming", "live", "ended"] } },
  });
  if (!row) throw new Error("Auction not found.");
  return toPublic(row);
}

export async function getMyCollection(userId: string) {
  const rows = await db.auctionCollection.findMany({
    where: { userId },
    include: { auction: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id:            r.id,
    auctionId:     r.auctionId,
    status:        r.status,
    claimedAt:     r.claimedAt?.toISOString() ?? null,
    expiresAt:     r.expiresAt?.toISOString() ?? null,
    deliveryNotes: r.deliveryNotes,
    // rewardData intentionally excluded from list — only returned by /claim endpoint
    createdAt:     r.createdAt.toISOString(),
    auction:       toPublic(r.auction),
  }));
}

// ─── Admin API ───────────────────────────────────────────────────────────────

export async function adminListAuctions(filters?: {
  status?: string;
  visibility?: string;
}) {
  const where: any = {};
  if (filters?.status) where.status = filters.status;
  if (filters?.visibility) where.visibility = filters.visibility;

  const rows = await db.auction.findMany({ where, orderBy: { createdAt: "desc" } });
  return rows.map(toAdmin);
}

export async function adminGetAuction(id: string): Promise<AuctionAdmin> {
  const row = await db.auction.findUnique({ where: { id } });
  if (!row) throw new Error("Auction not found.");
  return toAdmin(row);
}

export async function adminGetAuctionStatistics() {
  const [total, live, upcoming, ended, cancelled] = await Promise.all([
    db.auction.count(),
    db.auction.count({ where: { status: "live" } }),
    db.auction.count({ where: { status: "upcoming" } }),
    db.auction.count({ where: { status: "ended" } }),
    db.auction.count({ where: { status: "cancelled" } }),
  ]);

  const poolAgg = await db.auction.aggregate({
    _sum: { currentPool: true, bidCount: true },
    where: { status: { in: ["live", "ended"] } },
  });

  const recentBids = await db.auctionBid.count({
    where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });

  return {
    total,
    live,
    upcoming,
    ended,
    cancelled,
    draft: total - live - upcoming - ended - cancelled,
    totalPool: poolAgg._sum.currentPool ?? 0,
    totalBids: poolAgg._sum.bidCount ?? 0,
    bidsLast24h: recentBids,
  };
}

export async function adminCreateAuction(
  data: {
    title: string;
    description?: string;
    rewardType: string;
    rewardName?: string;
    rewardValue: number;
    rewardImageUrl?: string;
    bidAmount: number;
    durationMinutes: number;
    extensionWindowSeconds?: number;
    extensionDurationSeconds?: number;
    startsAt: string;
    visibility?: string;
  },
  adminId: string
): Promise<AuctionAdmin> {
  const row = await db.auction.create({
    data: {
      title: data.title,
      description: data.description,
      rewardType: data.rewardType,
      rewardName: data.rewardName,
      rewardValue: data.rewardValue,
      rewardImageUrl: data.rewardImageUrl,
      bidAmount: data.bidAmount,
      durationMinutes: data.durationMinutes,
      extensionWindowSeconds: data.extensionWindowSeconds ?? 60,
      extensionDurationSeconds: data.extensionDurationSeconds ?? 600,
      startsAt: new Date(data.startsAt),
      visibility: data.visibility ?? "private",
      status: "draft",
      createdBy: adminId,
    },
  });
  await recordStatusHistory(row.id, null, "draft", adminId, "Auction created");
  return toAdmin(row);
}

export async function adminUpdateAuction(
  id: string,
  data: {
    title?: string;
    description?: string;
    rewardType?: string;
    rewardName?: string;
    rewardValue?: number;
    rewardImageUrl?: string | null;
    bidAmount?: number;
    durationMinutes?: number;
    extensionWindowSeconds?: number;
    extensionDurationSeconds?: number;
    startsAt?: string;
    visibility?: string;
  },
  adminId: string
): Promise<AuctionAdmin> {
  const existing = await db.auction.findUnique({ where: { id } });
  if (!existing) throw new Error("Auction not found.");
  if (!["draft", "upcoming"].includes(existing.status)) {
    throw new Error("Only draft or upcoming auctions can be edited.");
  }

  const update: any = { updatedBy: adminId };
  if (data.title !== undefined) update.title = data.title;
  if (data.description !== undefined) update.description = data.description;
  if (data.rewardType !== undefined) update.rewardType = data.rewardType;
  if (data.rewardName !== undefined) update.rewardName = data.rewardName;
  if (data.rewardValue !== undefined) update.rewardValue = data.rewardValue;
  if (data.rewardImageUrl !== undefined) update.rewardImageUrl = data.rewardImageUrl;
  if (data.bidAmount !== undefined) update.bidAmount = data.bidAmount;
  if (data.durationMinutes !== undefined) update.durationMinutes = data.durationMinutes;
  if (data.extensionWindowSeconds !== undefined) update.extensionWindowSeconds = data.extensionWindowSeconds;
  if (data.extensionDurationSeconds !== undefined) update.extensionDurationSeconds = data.extensionDurationSeconds;
  if (data.startsAt !== undefined) update.startsAt = new Date(data.startsAt);
  if (data.visibility !== undefined) update.visibility = data.visibility;

  const row = await db.auction.update({ where: { id }, data: update });
  return toAdmin(row);
}

export async function adminActivateAuction(id: string, adminId: string): Promise<AuctionAdmin> {
  const enabled = await getConfigValue<boolean>("feature.auction_marketplace", false);
  if (!enabled) throw new Error("Enable the feature.auction_marketplace flag before activating auctions.");

  const row = await db.auction.findUnique({ where: { id } });
  if (!row) throw new Error("Auction not found.");
  if (row.status !== "draft") throw new Error("Only draft auctions can be activated.");

  const updated = await db.auction.update({
    where: { id },
    data: { status: "upcoming", updatedBy: adminId },
  });
  await recordStatusHistory(id, "draft", "upcoming", adminId, "Auction activated");
  return toAdmin(updated);
}

export async function adminLaunchAuction(id: string, adminId: string): Promise<AuctionAdmin> {
  const row = await db.auction.findUnique({ where: { id } });
  if (!row) throw new Error("Auction not found.");
  if (row.status !== "upcoming") throw new Error("Only upcoming auctions can be launched.");

  const endsAt = new Date(Date.now() + row.durationMinutes * 60 * 1000);
  const updated = await db.auction.update({
    where: { id },
    data: { status: "live", endsAt, updatedBy: adminId },
  });
  await recordStatusHistory(id, "upcoming", "live", adminId, "Auction launched manually");
  return toAdmin(updated);
}

export async function adminPauseAuction(id: string, adminId: string, reason?: string): Promise<AuctionAdmin> {
  const row = await db.auction.findUnique({ where: { id } });
  if (!row) throw new Error("Auction not found.");
  if (row.status !== "live") throw new Error("Only live auctions can be paused.");

  const updated = await db.auction.update({
    where: { id },
    data: { status: "paused", updatedBy: adminId },
  });
  await recordStatusHistory(id, "live", "paused", adminId, reason ?? "Paused by admin");
  return toAdmin(updated);
}

export async function adminResumeAuction(id: string, adminId: string): Promise<AuctionAdmin> {
  const row = await db.auction.findUnique({ where: { id } });
  if (!row) throw new Error("Auction not found.");
  if (row.status !== "paused") throw new Error("Only paused auctions can be resumed.");

  const updated = await db.auction.update({
    where: { id },
    data: { status: "live", updatedBy: adminId },
  });
  await recordStatusHistory(id, "paused", "live", adminId, "Auction resumed by admin");
  return toAdmin(updated);
}

export async function adminEndAuction(id: string, adminId: string, reason?: string): Promise<AuctionAdmin> {
  const row = await db.auction.findUnique({ where: { id } });
  if (!row) throw new Error("Auction not found.");
  if (!["live", "paused"].includes(row.status)) {
    throw new Error("Only live or paused auctions can be ended.");
  }

  // Wrap status update and collection record creation in one transaction so a crash
  // between them cannot leave the auction "ended" with no winner collection record.
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.auction.update({
      where: { id },
      data: { status: "ended", endsAt: new Date(), updatedBy: adminId },
    });

    if (row.currentLeaderId) {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await tx.auctionCollection.upsert({
        where:  { auctionId: id },
        create: { userId: row.currentLeaderId, auctionId: id, status: "pending_claim", expiresAt },
        update: {},
      });
    }

    return u;
  });
  await recordStatusHistory(id, row.status, "ended", adminId, reason ?? "Ended by admin");

  return toAdmin(updated);
}

export async function adminCancelAuction(id: string, adminId: string, reason?: string): Promise<AuctionAdmin> {
  const row = await db.auction.findUnique({ where: { id } });
  if (!row) throw new Error("Auction not found.");
  if (row.status === "ended") throw new Error("Ended auctions cannot be cancelled.");

  const updated = await db.auction.update({
    where: { id },
    data: { status: "cancelled", updatedBy: adminId },
  });
  await recordStatusHistory(id, row.status, "cancelled", adminId, reason ?? "Cancelled by admin");
  return toAdmin(updated);
}

export async function adminDeleteAuction(id: string): Promise<void> {
  const row = await db.auction.findUnique({ where: { id } });
  if (!row) throw new Error("Auction not found.");
  if (!["draft", "cancelled"].includes(row.status)) {
    throw new Error("Only draft or cancelled auctions can be deleted.");
  }
  await db.auction.delete({ where: { id } });
}

// ─── Collection Admin API ────────────────────────────────────────────────────

export async function adminListCollection(filters?: { status?: string }) {
  const where: any = {};
  if (filters?.status) where.status = filters.status;

  const rows = await db.auctionCollection.findMany({
    where,
    include: { auction: true },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    auctionId: r.auctionId,
    status: r.status,
    claimedAt: r.claimedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    deliveryNotes: r.deliveryNotes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    auction: toPublic(r.auction),
  }));
}

export async function adminUpdateCollectionItem(
  id: string,
  data: { status?: string; deliveryNotes?: string; expiresAt?: string },
  adminId: string
) {
  const item = await db.auctionCollection.findUnique({ where: { id } });
  if (!item) throw new Error("Collection item not found.");

  const update: any = { updatedAt: new Date() };
  if (data.status !== undefined) update.status = data.status;
  if (data.deliveryNotes !== undefined) update.deliveryNotes = data.deliveryNotes;
  if (data.expiresAt !== undefined) update.expiresAt = new Date(data.expiresAt);
  if (data.status === "claimed") update.claimedAt = new Date();

  const updated = await db.auctionCollection.update({ where: { id }, data: update });
  return {
    id: updated.id,
    userId: updated.userId,
    auctionId: updated.auctionId,
    status: updated.status,
    claimedAt: updated.claimedAt?.toISOString() ?? null,
    expiresAt: updated.expiresAt?.toISOString() ?? null,
    deliveryNotes: updated.deliveryNotes,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

export async function runAuctionScheduler(): Promise<void> {
  const now = new Date();

  // Auto-launch upcoming auctions whose startsAt has passed
  const toLaunch = await db.auction.findMany({
    where: { status: "upcoming", startsAt: { lte: now } },
  });
  for (const auction of toLaunch) {
    const endsAt = new Date(now.getTime() + auction.durationMinutes * 60 * 1000);
    // Atomic guard: only proceeds if the auction is still "upcoming".
    // Prevents duplicate launches when multiple scheduler instances run concurrently.
    const launched = await db.auction.updateMany({
      where: { id: auction.id, status: "upcoming" },
      data:  { status: "live", endsAt },
    });
    if (launched.count > 0) {
      await recordStatusHistory(auction.id, "upcoming", "live", "system", "Auto-launched by scheduler");
    }
  }

  // Auto-end live auctions whose endsAt has passed
  const toEnd = await db.auction.findMany({
    where: { status: "live", endsAt: { lte: now } },
  });
  for (const auction of toEnd) {
    // Atomic: status update and collection record in one transaction so a crash
    // between them cannot leave the auction "ended" with no winner collection record.
    const settled = await db.$transaction(async (tx) => {
      const guard = await tx.auction.updateMany({
        where: { id: auction.id, status: "live" },
        data:  { status: "ended" },
      });
      if (guard.count === 0) return false; // Another scheduler instance already ended it

      if (auction.currentLeaderId) {
        const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        await tx.auctionCollection.upsert({
          where:  { auctionId: auction.id },
          create: { userId: auction.currentLeaderId, auctionId: auction.id, status: "pending_claim", expiresAt },
          update: {},
        });
      }

      return true;
    });
    if (!settled) continue;
    await recordStatusHistory(auction.id, "live", "ended", "system", "Auto-ended by scheduler");

    // Broadcast auction_ended so all SSE clients update in real-time
    broadcast({
      type:      "auction_ended",
      auctionId: auction.id,
      data: {
        status:               "ended",
        currentLeaderMasked:  auction.currentLeaderId
          ? auction.currentLeaderId.slice(0, 2) + "***"
          : null,
        currentPool: auction.currentPool,
        bidCount:    auction.bidCount,
        timestamp:   now.toISOString(),
      },
    });
  }
}
