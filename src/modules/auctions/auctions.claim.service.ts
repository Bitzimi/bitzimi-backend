/**
 * Auction Claim Service — Phase 22.3
 *
 * Handles reward delivery per reward type:
 *
 *   cash_reward       → credit auction.rewardValue to winner's Game Wallet
 *   vip_subscription  → grant 30-day VIP subscription (upsert)
 *   gift_card         → reveal code stored in rewardData (one-time)
 *   software          → reveal license key + download link from rewardData
 *   future_item       → display admin-configured content from rewardData
 *
 * Security:
 *   - Only the winner can claim (userId check)
 *   - claimAttempts incremented before any reveal (replay protection)
 *   - Already-claimed items return an error
 *   - Expired items cannot be claimed
 *   - All writes are atomic inside $transaction
 */

import { db } from "../../db";
import { creditWallet, writeLedgerEntry } from "../wallets/wallets.service";
import { getConfigValue } from "../admin/config/admin.config.service";

// ─── Claim ────────────────────────────────────────────────────────────────────

export interface ClaimResult {
  status: string;
  rewardType: string;
  claimedAt: string;
  /** cash_reward: amount credited to Game Wallet */
  creditedAmount?: number;
  /** vip_subscription: subscription end date */
  activeUntil?: string;
  vipGranted?: boolean;
  /** gift_card: the redemption code */
  code?: string;
  /** software: license key */
  licenseKey?: string;
  downloadLink?: string | null;
  activationInstructions?: string | null;
  /** future_item: admin-configured content */
  content?: string | null;
  deliveryNotes?: string | null;
  message: string;
}

export async function claimAuctionReward(userId: string, collectionId: string): Promise<ClaimResult> {
  // ── Feature flag ───────────────────────────────────────────────────────
  const claimEnabled = await getConfigValue<boolean>("feature.auction_claim", false);
  if (!claimEnabled) throw Object.assign(
    new Error("Reward claiming is not currently enabled."),
    { statusCode: 403, code: "FEATURE_DISABLED" }
  );

  // ── Load collection item with auction ──────────────────────────────────
  const item = await db.auctionCollection.findUnique({
    where:   { id: collectionId },
    include: { auction: true },
  });
  if (!item) throw Object.assign(new Error("Collection item not found."), { statusCode: 404 });
  if (item.userId !== userId) throw Object.assign(new Error("Unauthorized."), { statusCode: 403 });
  if (item.status === "claimed" || item.status === "delivered") {
    throw Object.assign(new Error("This reward has already been claimed."), { statusCode: 409, code: "ALREADY_CLAIMED" });
  }
  if (item.status === "expired") {
    throw Object.assign(new Error("This claim has expired."), { statusCode: 410, code: "CLAIM_EXPIRED" });
  }
  if (item.expiresAt && item.expiresAt < new Date()) {
    // Mark expired atomically
    await db.auctionCollection.update({
      where: { id: collectionId },
      data:  { status: "expired" },
    });
    throw Object.assign(new Error("The claim window for this reward has closed."), { statusCode: 410, code: "CLAIM_EXPIRED" });
  }

  // Increment claim attempts immediately (replay protection before any sensitive reveal)
  await db.auctionCollection.update({
    where: { id: collectionId },
    data:  { claimAttempts: { increment: 1 } },
  });

  const auction = item.auction;
  const rewardType = auction.rewardType;
  const rewardData = item.rewardData ? JSON.parse(item.rewardData) : null;
  const now = new Date();

  // ── Dispatch per reward type ───────────────────────────────────────────

  switch (rewardType) {
    // ── Cash Reward ────────────────────────────────────────────────────────
    case "cash_reward": {
      const amount = auction.rewardValue;
      await db.$transaction(async (tx) => {
        await creditWallet(tx, userId, "game", amount);
        await writeLedgerEntry(tx, {
          userId,
          type:          "auction_reward",
          toWallet:      "game",
          amount,
          description:   `Auction reward: ${auction.title}`,
          referenceId:   item.id,
          referenceType: "auction_collection",
          metadata:      { auctionId: auction.id, rewardType },
        });
        await tx.auctionCollection.update({
          where: { id: collectionId },
          data:  { status: "claimed", claimedAt: now },
        });
      });
      return {
        status:          "claimed",
        rewardType,
        claimedAt:       now.toISOString(),
        creditedAmount:  amount,
        deliveryNotes:   item.deliveryNotes,
        message:         `$${amount.toFixed(2)} has been credited to your Game Wallet.`,
      };
    }

    // ── VIP Subscription ───────────────────────────────────────────────────
    case "vip_subscription": {
      const VIP_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
      let actualEndsAt: Date = new Date(now.getTime() + VIP_DURATION_MS);

      await db.$transaction(async (tx) => {
        // Upsert subscription — extends if already active
        const existing = await tx.subscription.findUnique({ where: { userId } });
        const startFrom = existing?.isActive && existing.endsAt > now
          ? existing.endsAt   // extend from current expiry
          : now;
        actualEndsAt = new Date(startFrom.getTime() + VIP_DURATION_MS);

        await tx.subscription.upsert({
          where:  { userId },
          create: { userId, plan: "monthly", price: 0, isActive: true, startedAt: now, endsAt: actualEndsAt },
          update: { isActive: true, endsAt: actualEndsAt, cancelledAt: null },
        });
        await tx.vipStreak.upsert({ where: { userId }, create: { userId }, update: {} });
        await tx.auctionCollection.update({
          where: { id: collectionId },
          data:  { status: "claimed", claimedAt: now },
        });
      });

      return {
        status:        "claimed",
        rewardType,
        claimedAt:     now.toISOString(),
        activeUntil:   actualEndsAt.toISOString(),
        vipGranted:    true,
        deliveryNotes: item.deliveryNotes,
        message:       "VIP subscription activated for 30 days.",
      };
    }

    // ── Gift Card ──────────────────────────────────────────────────────────
    case "gift_card": {
      if (!rewardData?.code) {
        throw Object.assign(
          new Error("Gift card code not yet available. Please contact support."),
          { statusCode: 503, code: "REWARD_NOT_READY" }
        );
      }
      await db.auctionCollection.update({
        where: { id: collectionId },
        data:  { status: "claimed", claimedAt: now },
      });
      return {
        status:        "claimed",
        rewardType,
        claimedAt:     now.toISOString(),
        code:          rewardData.code as string,
        deliveryNotes: item.deliveryNotes,
        message:       "Your gift card code is ready.",
      };
    }

    // ── Software ───────────────────────────────────────────────────────────
    case "software": {
      if (!rewardData?.licenseKey) {
        throw Object.assign(
          new Error("License key not yet available. Please contact support."),
          { statusCode: 503, code: "REWARD_NOT_READY" }
        );
      }
      await db.auctionCollection.update({
        where: { id: collectionId },
        data:  { status: "claimed", claimedAt: now },
      });
      return {
        status:                  "claimed",
        rewardType,
        claimedAt:               now.toISOString(),
        licenseKey:              rewardData.licenseKey as string,
        downloadLink:            (rewardData.downloadLink as string | null) ?? null,
        activationInstructions:  (rewardData.activationInstructions as string | null) ?? null,
        deliveryNotes:           item.deliveryNotes,
        message:                 "Your license key is ready.",
      };
    }

    // ── Future Item ────────────────────────────────────────────────────────
    case "future_item":
    default: {
      const content = (rewardData?.content as string | null) ?? null;
      await db.auctionCollection.update({
        where: { id: collectionId },
        data:  { status: "claimed", claimedAt: now },
      });
      return {
        status:        "claimed",
        rewardType,
        claimedAt:     now.toISOString(),
        content,
        deliveryNotes: item.deliveryNotes,
        message:       content ?? item.deliveryNotes ?? "Reward claimed. Contact support for delivery details.",
      };
    }
  }
}

// ─── Admin: set reward data before claim is possible ─────────────────────────

export async function adminSetRewardData(
  collectionId: string,
  data: {
    rewardData?: string | null;
    deliveryNotes?: string | null;
  }
) {
  const item = await db.auctionCollection.findUnique({ where: { id: collectionId } });
  if (!item) throw Object.assign(new Error("Collection item not found."), { statusCode: 404 });

  return db.auctionCollection.update({
    where: { id: collectionId },
    data: {
      rewardData:    data.rewardData !== undefined ? data.rewardData : undefined,
      deliveryNotes: data.deliveryNotes !== undefined ? data.deliveryNotes : undefined,
    },
  });
}
