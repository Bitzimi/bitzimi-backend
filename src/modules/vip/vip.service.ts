/**
 * VIP Subscription Service — platform VIP only ($4/month, 30-day).
 *
 * Football-specific subscription system was removed in the architectural cleanup.
 * This is the single VIP system for the entire Bitzimi platform.
 *
 * Streak rewards (USD, days 1–7 repeating cycle):
 *   Day 1: $0.05 | Day 2: $0.10 | Day 3: $0.15 | Day 4: $0.20
 *   Day 5: $0.30 | Day 6: $0.40 | Day 7: $0.50
 *
 * Streak reset rules:
 *   - Claim requires ≥24 hours since last claim
 *   - If >N hours have elapsed (default 48) → streak resets to 0 before advancing
 *   - After day 7 → resets to day 1 (cycles indefinitely)
 *
 * CONFIGURATION:
 *   VIP price, streak rewards, and streak reset hours are read from SystemConfig
 *   at runtime with a 60-second in-memory cache. Defaults are used if unavailable.
 *   Keys: platform.vip_price_usd | vip.streak_rewards_usd | vip.streak_reset_hours
 */
import { db } from "../../db";
import { debitWallet, creditWallet, writeLedgerEntry } from "../wallets/wallets.service";
import { createNotification } from "../notifications/notifications.service";
import { getConfigValue } from "../admin/config/admin.config.service";

const VIP_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — structural, not admin-configurable

interface VipConfig {
  vipPrice:         number;
  streakRewards:    number[];
  streakResetHours: number;
}

const DEFAULT_VIP_CONFIG: VipConfig = {
  vipPrice:         4.00,
  streakRewards:    [0.05, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50],
  streakResetHours: 48,
};

// 60-second in-memory cache so admin changes propagate within 1 minute
let _vipConfigCache: { config: VipConfig; expiresAt: number } | null = null;
const VIP_CONFIG_CACHE_TTL = 60_000;

async function getVipConfig(): Promise<VipConfig> {
  if (_vipConfigCache && Date.now() < _vipConfigCache.expiresAt) return _vipConfigCache.config;

  const rows = await db.systemConfig.findMany({
    where: { key: { in: ["platform.vip_price_usd", "vip.streak_rewards_usd", "vip.streak_reset_hours"] } },
  });
  const byKey = Object.fromEntries(rows.map(r => [r.key, r.value]));

  const parsedPrice = parseFloat(JSON.parse(byKey["platform.vip_price_usd"] ?? "null"));
  const parsedRewards = (() => {
    try {
      const v = JSON.parse(byKey["vip.streak_rewards_usd"] ?? "null");
      return Array.isArray(v) && v.length > 0 ? v : DEFAULT_VIP_CONFIG.streakRewards;
    } catch { return DEFAULT_VIP_CONFIG.streakRewards; }
  })();
  const parsedResetHours = parseFloat(JSON.parse(byKey["vip.streak_reset_hours"] ?? "null"));

  const config: VipConfig = {
    vipPrice:         isFinite(parsedPrice)      ? parsedPrice      : DEFAULT_VIP_CONFIG.vipPrice,
    streakRewards:    parsedRewards,
    streakResetHours: isFinite(parsedResetHours) ? parsedResetHours : DEFAULT_VIP_CONFIG.streakResetHours,
  };

  _vipConfigCache = { config, expiresAt: Date.now() + VIP_CONFIG_CACHE_TTL };
  return config;
}

// ── Get VIP status ─────────────────────────────────────────────────────────────

export async function getVipStatus(userId: string) {
  const [{ vipPrice, streakRewards, streakResetHours }, sub, streak] = await Promise.all([
    getVipConfig(),
    db.subscription.findUnique({ where: { userId } }),
    db.vipStreak.findUnique({ where: { userId } }),
  ]);

  const isActive = !!(sub?.isActive && sub.endsAt > new Date());
  const daysRemaining = sub?.endsAt
    ? Math.max(0, Math.ceil((sub.endsAt.getTime() - Date.now()) / 86400000))
    : 0;

  // Streak state
  const currentStreak   = streak?.currentStreak ?? 0;
  const lastClaim       = streak?.lastClaimDate ?? null;
  const hoursSinceClaim = lastClaim
    ? (Date.now() - lastClaim.getTime()) / 3600000
    : Infinity;
  const canClaimToday   = isActive && hoursSinceClaim >= 24;
  const nextDay         = (currentStreak % 7) + 1;  // what day would next claim be
  const nextRewardUSD   = streakRewards[nextDay - 1] ?? 0.05;

  return {
    isActive,
    plan:         sub?.plan ?? null,
    price:        vipPrice,
    startedAt:    sub?.startedAt?.toISOString() ?? null,
    endsAt:       sub?.endsAt?.toISOString() ?? null,
    daysRemaining,
    streak: {
      current:      currentStreak,
      canClaimToday,
      nextRewardUSD,
      lastClaim:    lastClaim?.toISOString() ?? null,
      totalEarned:  streak?.totalEarned ?? 0,
      rewards:      streakRewards.map((amount, i) => ({ day: i + 1, amountUSD: amount })),
    },
  };
}

// ── Subscribe ──────────────────────────────────────────────────────────────────

export async function subscribeVIP(userId: string) {
  // Check KYC requirement before anything else
  const kycRequired = await getConfigValue<boolean>("feature.kyc_required_vip", true);
  if (kycRequired) {
    const kyc = await db.kycSubmission.findUnique({ where: { userId } });
    if (!kyc || kyc.status !== "approved") {
      throw Object.assign(
        new Error("Identity verification (KYC) must be approved before upgrading to VIP"),
        { statusCode: 403, code: "KYC_REQUIRED" }
      );
    }
  }

  const existing = await db.subscription.findUnique({ where: { userId } });
  if (existing?.isActive && existing.endsAt > new Date()) {
    throw Object.assign(new Error("You already have an active VIP subscription"), {
      statusCode: 409, code: "ALREADY_SUBSCRIBED",
    });
  }

  // Determine if this is the user's FIRST EVER VIP purchase.
  // Renewals have an existing subscription record; first-time users do not.
  const isFirstVIPPurchase = !existing;

  // Read price from SystemConfig before entering the transaction
  const { vipPrice } = await getVipConfig();

  await db.$transaction(async (tx) => {
    // Re-check inside the transaction: two concurrent subscribe requests both pass
    // the "already active" guard outside the tx. Only one should win.
    const currentSub = await tx.subscription.findUnique({ where: { userId } });
    if (currentSub?.isActive && currentSub.endsAt > new Date()) {
      throw Object.assign(new Error("You already have an active VIP subscription"), {
        statusCode: 409, code: "ALREADY_SUBSCRIBED",
      });
    }

    // Deduct subscription price from game wallet
    await debitWallet(tx, userId, "game", vipPrice);

    const now    = new Date();
    const endsAt = new Date(now.getTime() + VIP_DURATION_MS);

    await tx.subscription.upsert({
      where:  { userId },
      create: { userId, plan: "monthly", price: vipPrice, isActive: true, startedAt: now, endsAt },
      update: { isActive: true, startedAt: now, endsAt, cancelledAt: null },
    });

    // Initialise streak record if needed
    await tx.vipStreak.upsert({ where: { userId }, create: { userId }, update: {} });
    await writeLedgerEntry(tx, {
      userId, type: "transfer", fromWallet: "game", amount: vipPrice,
      description: "VIP subscription payment", referenceType: "vip_subscription",
    });

    // ── First-time VIP purchase: enqueue referral bonus + affiliate commission jobs ──
    // Jobs are created INSIDE the transaction so they are atomic with the subscription.
    // If this transaction rolls back for any reason, no jobs are enqueued.
    // If the transaction commits, jobs are guaranteed to exist and will be processed
    // by the worker even if the server restarts between commit and processing.
    if (isFirstVIPPurchase) {
      await tx.commissionJob.create({
        data: {
          jobType: "pay_referral_bonus",
          payload: JSON.stringify({ referredUserId: userId }),
        },
      });
      await tx.commissionJob.create({
        data: {
          jobType: "distribute_commissions",
          payload: JSON.stringify({
            sourceUserId: userId,
            eventType:    "vip_subscription",
            grossAmount:  vipPrice,
          }),
        },
      });
    }
  });
  // NOTE: VIP renewals do NOT trigger referral or affiliate commissions.
  // Only the first-time VIP purchase generates commissions.

  return getVipStatus(userId);
}

// ── Claim daily streak ────────────────────────────────────────────────────────

export async function claimDailyStreak(userId: string) {
  const status = await getVipStatus(userId);
  if (!status.isActive) {
    throw Object.assign(new Error("VIP subscription required to claim streak rewards"), {
      statusCode: 403, code: "NOT_VIP",
    });
  }
  if (!status.streak.canClaimToday) {
    throw Object.assign(new Error("Streak already claimed today. Come back in 24 hours."), {
      statusCode: 429, code: "STREAK_ALREADY_CLAIMED",
    });
  }

  // Read streak config (already cached from getVipStatus call above, within same TTL window)
  const { streakRewards, streakResetHours } = await getVipConfig();

  const streak = await db.vipStreak.findUnique({ where: { userId } });
  const lastClaim       = streak?.lastClaimDate ?? null;
  const hoursSinceClaim = lastClaim
    ? (Date.now() - lastClaim.getTime()) / 3600000
    : Infinity;

  // Reset streak if gap exceeds configured reset threshold (default 48h)
  let currentStreak = streak?.currentStreak ?? 0;
  if (hoursSinceClaim > streakResetHours) currentStreak = 0;

  // Advance to next day (cycle after 7)
  const newStreak   = (currentStreak % 7) + 1;
  const rewardUSD   = streakRewards[newStreak - 1] ?? 0.05;
  const totalEarned = (streak?.totalEarned ?? 0) + rewardUSD;

  await db.$transaction(async (tx) => {
    // Atomic guard: only proceeds if the streak hasn't been claimed in the last 24 hours.
    // Two concurrent claim requests both pass the canClaimToday check outside the tx,
    // but only one can win the updateMany — the loser gets count=0 and double-credit is blocked.
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const guard = await tx.vipStreak.updateMany({
      where: {
        userId,
        OR: [
          { lastClaimDate: null },
          { lastClaimDate: { lte: twentyFourHoursAgo } },
        ],
      },
      data: { currentStreak: newStreak, lastClaimDate: new Date(), totalEarned },
    });
    if (guard.count === 0) {
      throw Object.assign(new Error("Streak already claimed today. Come back in 24 hours."), {
        statusCode: 429, code: "STREAK_ALREADY_CLAIMED",
      });
    }
    await creditWallet(tx, userId, "game", rewardUSD);
    await writeLedgerEntry(tx, {
      userId, type: "transfer", toWallet: "game", amount: rewardUSD,
      description: `VIP daily streak reward — day ${newStreak}`,
      referenceType: "vip_streak", metadata: { day: newStreak },
    });
  });

  setImmediate(() => createNotification({
    userId,
    type:    "daily_streak",
    title:   `Day ${newStreak} Streak Reward 🔥`,
    message: `$${rewardUSD.toFixed(2)} has been added to your game wallet. Keep claiming daily for bigger rewards!`,
    metadata: { day: newStreak, amountUSD: rewardUSD, totalEarned },
  }));

  return { amountUSD: rewardUSD, newStreak, totalEarned };
}
