/**
 * Football AI Daily Points Service — Phase 20 (Corrected)
 *
 * Daily points are NOT the same for all users. Priority: VIP > KYC Verified > Normal.
 *
 *   VIP user:               25 points/day
 *   KYC-verified user:      15 points/day
 *   Normal user:            10 points/day
 *
 * Uses existing platform truth:
 *   - VIP: Subscription model (isActive && endsAt > now)
 *   - KYC: KycSubmission model (status === "verified")
 *   - No new verification systems created.
 *
 * 1000 points = $2 credited to game wallet.
 * Activity scoring counts the visit (1 unit), NOT the point amount (Correction 10).
 */
import { db } from "../../db";
import { creditWallet, writeLedgerEntry } from "../wallets/wallets.service";
import { getConfigValue } from "../admin/config/admin.config.service";
import { isUserVIP } from "../affiliates/commissions";
import { recordFootballActivity } from "../ambassadors/activityEvents";

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // "2025-01-15"
}

/** Read all configurable football-points values from SystemConfig. */
async function getPointsConfig() {
  const [vip, verified, normal, perConversion, usdPerConversion] = await Promise.all([
    getConfigValue<number>("football.points_per_day",        25),
    getConfigValue<number>("football.points_verified",       15),
    getConfigValue<number>("football.points_normal",         10),
    getConfigValue<number>("football.points_per_conversion", 1000),
    getConfigValue<number>("football.usd_per_conversion",    2.00),
  ]);
  return { vip, verified, normal, perConversion, usdPerConversion };
}

/**
 * Determine daily point award for a user based on their current tier.
 * Priority: VIP > KYC Verified > Normal.
 * All values are read from SystemConfig — admin can change them without a deploy.
 */
async function getDailyPoints(userId: string): Promise<{ points: number; tier: "vip" | "verified" | "normal" }> {
  const [vip, kyc, cfg] = await Promise.all([
    isUserVIP(userId),
    db.kycSubmission.findUnique({ where: { userId }, select: { status: true } }),
    getPointsConfig(),
  ]);

  if (vip) return { points: cfg.vip, tier: "vip" };
  if (kyc?.status === "verified") return { points: cfg.verified, tier: "verified" };
  return { points: cfg.normal, tier: "normal" };
}

export async function claimDailyPoints(userId: string): Promise<{
  alreadyClaimed:  boolean;
  points:          number;
  tier:            "vip" | "verified" | "normal";
  currentBalance:  number;
}> {
  const enabled = await getConfigValue<boolean>("feature.football_daily_points", false);
  if (!enabled) {
    throw Object.assign(new Error("Football daily points are not yet enabled"), {
      statusCode: 403, code: "FEATURE_DISABLED",
    });
  }

  const claimDate         = todayUTC();
  const { points, tier }  = await getDailyPoints(userId);

  // Try to create the claim — unique constraint rejects duplicates
  try {
    await db.footballHubDailyClaim.create({
      data: { userId, claimDate, points },
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      const balance = await getPointsBalance(userId);
      return { alreadyClaimed: true, points: 0, tier, currentBalance: balance.currentPoints };
    }
    throw err;
  }

  // Upsert running balance
  const balance = await db.footballPointsBalance.upsert({
    where:  { userId },
    create: { userId, totalPoints: points, currentPoints: points, totalConverted: 0 },
    update: {
      totalPoints:   { increment: points },
      currentPoints: { increment: points },
    },
  });

  // Activity scoring counts the VISIT (1 unit), not the point amount — Correction 10
  recordFootballActivity(userId);

  return {
    alreadyClaimed: false,
    points,
    tier,
    currentBalance: balance.currentPoints,
  };
}

export async function getPointsBalance(userId: string): Promise<{
  totalPoints:      number;
  currentPoints:    number;
  totalConverted:   number;
  nextConversionAt: number;
  dailyPoints:      number;
  tier:             "vip" | "verified" | "normal";
}> {
  const [row, { points: dailyPoints, tier }, cfg] = await Promise.all([
    db.footballPointsBalance.findUnique({ where: { userId } }),
    getDailyPoints(userId),
    getPointsConfig(),
  ]);

  const current = row?.currentPoints ?? 0;

  return {
    totalPoints:      row?.totalPoints    ?? 0,
    currentPoints:    current,
    totalConverted:   row?.totalConverted ?? 0,
    nextConversionAt: Math.max(0, cfg.perConversion - current),
    dailyPoints,
    tier,
  };
}

export async function convertPoints(userId: string): Promise<{
  converted:  number;
  credited:   number;
  remaining:  number;
}> {
  const [enabled, cfg] = await Promise.all([
    getConfigValue<boolean>("feature.football_daily_points", false),
    getPointsConfig(),
  ]);

  if (!enabled) {
    throw Object.assign(new Error("Football daily points are not yet enabled"), {
      statusCode: 403, code: "FEATURE_DISABLED",
    });
  }

  const balance = await db.footballPointsBalance.findUnique({ where: { userId } });
  const current = balance?.currentPoints ?? 0;

  if (current < cfg.perConversion) {
    throw Object.assign(
      new Error(`Need ${cfg.perConversion} points to convert. You have ${current}.`),
      { statusCode: 400, code: "INSUFFICIENT_POINTS" }
    );
  }

  const batches   = Math.floor(current / cfg.perConversion);
  const consumed  = batches * cfg.perConversion;
  const earned    = parseFloat((batches * cfg.usdPerConversion).toFixed(2));
  const remaining = current - consumed;

  await db.$transaction(async (tx) => {
    await tx.footballPointsBalance.update({
      where: { userId },
      data:  { currentPoints: remaining, totalConverted: { increment: consumed } },
    });
    await creditWallet(tx, userId, "game", earned);
    await writeLedgerEntry(tx, {
      userId,
      type:          "football_points_conversion",
      toWallet:      "game",
      amount:        earned,
      description:   `Football points conversion: ${consumed} points → $${earned}`,
      referenceType: "football_points",
      metadata:      { pointsConsumed: consumed, batches, usdEarned: earned },
    });
  });

  return { converted: consumed, credited: earned, remaining };
}
