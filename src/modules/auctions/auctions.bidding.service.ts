/**
 * Auction Bidding Service — Phase 22.3
 *
 * Implements:
 *   - Atomic bid placement (DB transaction)
 *   - Game Wallet deduction
 *   - Pool accumulation
 *   - Last-bidder-wins leader tracking
 *   - Last-minute extension (extensionWindowSeconds → extensionDurationSeconds)
 *   - Participant count (deduplicated)
 *   - Ledger entry for every deduction
 *   - SSE broadcast on every bid
 *   - Per-auction in-flight guard (prevents concurrent bids from same user)
 *   - Auto-end on timer expiry via scheduler
 *
 * Security:
 *   - All business logic lives HERE — never on the client
 *   - Amount is always read from auction.bidAmount, never from request body
 *   - Atomic $transaction prevents race conditions
 *   - In-flight set prevents duplicate concurrent bids from same user/auction pair
 */

import { db } from "../../db";
import { debitWallet, writeLedgerEntry } from "../wallets/wallets.service";
import { broadcast } from "./auctions.sse";
import { getConfigValue } from "../admin/config/admin.config.service";

// ─── In-flight guard ─────────────────────────────────────────────────────────
// Prevents a single user from placing two concurrent bids on the same auction.
// Key: `${userId}:${auctionId}`

const inFlight = new Set<string>();

// ─── Place Bid ────────────────────────────────────────────────────────────────

export interface PlaceBidResult {
  bid: {
    id: string;
    bidNumber: number;
    amount: number;
    createdAt: string;
  };
  auction: {
    id: string;
    status: string;
    currentPool: number;
    bidCount: number;
    participantCount: number;
    currentLeaderMasked: string;
    endsAt: string | null;
    extensionCount: number;
    wasExtended: boolean;
  };
}

export async function placeBid(userId: string, auctionId: string): Promise<PlaceBidResult> {
  // ── Feature flag check ─────────────────────────────────────────────────
  const biddingEnabled = await getConfigValue<boolean>("feature.auction_bidding", false);
  if (!biddingEnabled) throw Object.assign(
    new Error("Bidding is not currently enabled. Please try again shortly."),
    { statusCode: 403, code: "FEATURE_DISABLED" }
  );

  // ── In-flight guard ────────────────────────────────────────────────────
  const key = `${userId}:${auctionId}`;
  if (inFlight.has(key)) throw Object.assign(
    new Error("A bid is already being processed. Please wait."),
    { statusCode: 429, code: "BID_IN_PROGRESS" }
  );
  inFlight.add(key);

  try {
    return await _doBid(userId, auctionId);
  } finally {
    inFlight.delete(key);
  }
}

async function _doBid(userId: string, auctionId: string): Promise<PlaceBidResult> {
  const now = new Date();

  // ── Pre-transaction auction read ───────────────────────────────────────
  const auction = await db.auction.findUnique({ where: { id: auctionId } });
  if (!auction) throw Object.assign(new Error("Auction not found."), { statusCode: 404 });
  if (auction.status !== "live") throw Object.assign(
    new Error(`Auction is not live (current status: ${auction.status}).`),
    { statusCode: 400, code: "NOT_LIVE" }
  );
  if (!auction.endsAt) throw Object.assign(new Error("Auction has no end time."), { statusCode: 400 });
  if (auction.endsAt <= now) throw Object.assign(
    new Error("Auction has already expired."),
    { statusCode: 400, code: "EXPIRED" }
  );

  // ── Timer extension check ──────────────────────────────────────────────
  const remainingMs   = auction.endsAt.getTime() - now.getTime();
  const windowMs      = auction.extensionWindowSeconds * 1000;
  const extensionMs   = auction.extensionDurationSeconds * 1000;
  const willExtend    = remainingMs <= windowMs;
  const newEndsAt     = willExtend
    ? new Date(now.getTime() + extensionMs)
    : auction.endsAt;

  // ── Deduplicate participant check ──────────────────────────────────────
  // We check BEFORE the transaction to avoid a slow serializable read inside tx.
  const existingBid = await db.auctionBid.findFirst({
    where: { auctionId, userId },
    select: { id: true },
  });
  const isNewParticipant = !existingBid;

  // ── Atomic transaction ─────────────────────────────────────────────────
  let result!: PlaceBidResult;

  await db.$transaction(async (tx) => {
    // 1. Re-read auction INSIDE tx to get fresh state
    const fresh = await tx.auction.findUnique({ where: { id: auctionId } });
    if (!fresh || fresh.status !== "live") {
      throw Object.assign(new Error("Auction is no longer live."), { statusCode: 400 });
    }
    if (fresh.endsAt && fresh.endsAt <= new Date()) {
      throw Object.assign(new Error("Auction has just expired."), { statusCode: 400 });
    }

    // 2. Debit Game Wallet — throws INSUFFICIENT_BALANCE if balance is low
    await debitWallet(tx, userId, "game", fresh.bidAmount);

    // 3. Clear previous leading bid for this auction
    await tx.auctionBid.updateMany({
      where: { auctionId, isLeading: true },
      data:  { isLeading: false },
    });

    // 4. Create new bid record
    const newBidNumber = fresh.bidCount + 1;
    const bid = await tx.auctionBid.create({
      data: {
        auctionId,
        userId,
        amount:    fresh.bidAmount,
        bidNumber: newBidNumber,
        isLeading: true,
      },
    });

    // 5. Update auction state
    const updatedAuction = await tx.auction.update({
      where: { id: auctionId },
      data: {
        currentLeaderId:  userId,
        currentPool:      { increment: fresh.bidAmount },
        bidCount:         { increment: 1 },
        participantCount: isNewParticipant ? { increment: 1 } : undefined,
        endsAt:           willExtend ? newEndsAt : undefined,
        extensionCount:   willExtend ? { increment: 1 } : undefined,
        lastExtendedAt:   willExtend ? now : undefined,
        lastBidAt:        now,
      },
    });

    // 6. Ledger entry
    await writeLedgerEntry(tx, {
      userId,
      type:          "auction_bid",
      fromWallet:    "game",
      amount:        fresh.bidAmount,
      description:   `Auction bid #${newBidNumber} — ${fresh.title}`,
      referenceId:   bid.id,
      referenceType: "auction_bid",
      metadata: {
        auctionId,
        bidNumber: newBidNumber,
        title:     fresh.title,
      },
    });

    // Build result
    const maskedLeader = userId.slice(0, 2) + "***";
    result = {
      bid: {
        id:        bid.id,
        bidNumber: bid.bidNumber,
        amount:    bid.amount,
        createdAt: bid.createdAt.toISOString(),
      },
      auction: {
        id:                   updatedAuction.id,
        status:               updatedAuction.status,
        currentPool:          updatedAuction.currentPool,
        bidCount:             updatedAuction.bidCount,
        participantCount:     updatedAuction.participantCount,
        currentLeaderMasked:  maskedLeader,
        endsAt:               updatedAuction.endsAt?.toISOString() ?? null,
        extensionCount:       updatedAuction.extensionCount,
        wasExtended:          willExtend,
      },
    };
  });

  // ── SSE broadcast (after commit) ───────────────────────────────────────
  broadcast({
    type:      "bid_placed",
    auctionId,
    data: {
      bidNumber:            result.bid.bidNumber,
      amount:               result.bid.amount,
      currentPool:          result.auction.currentPool,
      bidCount:             result.auction.bidCount,
      participantCount:     result.auction.participantCount,
      currentLeaderMasked:  result.auction.currentLeaderMasked,
      endsAt:               result.auction.endsAt,
      extensionCount:       result.auction.extensionCount,
      wasExtended:          result.auction.wasExtended,
      timestamp:            new Date().toISOString(),
    },
  });

  return result;
}

// ─── Public bid history ───────────────────────────────────────────────────────

export async function getPublicBids(auctionId: string, limit = 20) {
  // Verify auction exists and is public
  const auction = await db.auction.findFirst({
    where: { id: auctionId, visibility: "public" },
    select: { id: true },
  });
  if (!auction) throw Object.assign(new Error("Auction not found."), { statusCode: 404 });

  const bids = await db.auctionBid.findMany({
    where:   { auctionId },
    orderBy: { createdAt: "desc" },
    take:    limit,
    select:  {
      id:        true,
      bidNumber: true,
      isLeading: true,
      createdAt: true,
      // userId intentionally excluded — masked below
      userId:    true,
    },
  });

  return bids.map((b) => ({
    id:               b.id,
    bidNumber:        b.bidNumber,
    isLeading:        b.isLeading,
    userMasked:       b.userId.slice(0, 2) + "***",
    createdAt:        b.createdAt.toISOString(),
  }));
}

// ─── Admin bid history (full userId visible) ──────────────────────────────────

export async function adminGetBids(auctionId: string, limit = 100) {
  return db.auctionBid.findMany({
    where:   { auctionId },
    orderBy: { bidNumber: "desc" },
    take:    limit,
  });
}
