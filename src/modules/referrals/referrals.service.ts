/**
 * Referral Service
 *
 * Referral reward is paid ONCE and ONLY ONCE:
 *   • When the referred user purchases VIP for the FIRST TIME.
 *   • NOT on registration, deposit, bet, task, or any other activity.
 *   • NOT on VIP renewal — only the very first purchase triggers the reward.
 *
 * Idempotency: `referralRewarded = true` on the Referral record permanently
 * marks the reward as paid. Even if called multiple times, it never pays twice.
 *
 * CONFIGURATION:
 *   Bonus amount is read from SystemConfig key "referral.bonus_usd" with a
 *   60-second in-memory cache. Defaults to $0.50 if unavailable.
 */
import { creditWallet, writeLedgerEntry } from "../wallets/wallets.service";
import { db } from "../../db";

const DEFAULT_REFERRAL_BONUS_USD = 0.50;

// 60-second in-memory cache so admin bonus changes propagate within 1 minute
let _bonusCache: { bonus: number; expiresAt: number } | null = null;
const BONUS_CACHE_TTL = 60_000;

async function getReferralBonus(): Promise<number> {
  if (_bonusCache && Date.now() < _bonusCache.expiresAt) return _bonusCache.bonus;
  const row = await db.systemConfig.findUnique({ where: { key: "referral.bonus_usd" } });
  const bonus = row
    ? (parseFloat(JSON.parse(row.value)) || DEFAULT_REFERRAL_BONUS_USD)
    : DEFAULT_REFERRAL_BONUS_USD;
  _bonusCache = { bonus, expiresAt: Date.now() + BONUS_CACHE_TTL };
  return bonus;
}

// ── List tier-1 referrals ─────────────────────────────────────────────────────

export async function listReferrals(userId: string) {
  const referrals = await db.referral.findMany({
    where:   { referrerId: userId },
    orderBy: { createdAt: "desc" },
    include: {
      referred: {
        include: {
          profile:      { select: { username: true } },
          subscription: { select: { isActive: true, endsAt: true } },
        },
      },
    },
  });

  return referrals.map(r => {
    const isVIP = !!(r.referred.subscription?.isActive && r.referred.subscription.endsAt > new Date());
    return {
      id:               r.id,
      referredId:       r.referredId,
      username:         r.referred.profile?.username ?? "",
      isVIP,
      isActive:         r.isActive,
      referralRewarded: r.referralRewarded,
      activatedAt:      r.activatedAt?.toISOString() ?? null,
      rewardedAt:       r.rewardedAt?.toISOString() ?? null,
      joinedAt:         r.createdAt.toISOString(),
    };
  });
}

// ── Referral stats ────────────────────────────────────────────────────────────

export async function getReferralStats(userId: string) {
  const [referrals, bonusPerReferral] = await Promise.all([
    db.referral.findMany({ where: { referrerId: userId } }),
    getReferralBonus(),
  ]);
  const rewarded = referrals.filter(r => r.referralRewarded).length;
  const active   = referrals.filter(r => r.isActive).length;
  const pending  = referrals.length - rewarded;
  const earned   = rewarded * bonusPerReferral;

  return {
    totalReferrals:   referrals.length,
    activeReferrals:  active,
    pendingReferrals: pending,
    totalEarned:      earned,
    bonusPerReferral,
  };
}

// ── Pay referral bonus on FIRST VIP purchase (called from vip.service.ts) ────
//
// Idempotency guarantee:
//   • referralRewarded flag checked before and inside transaction.
//   • VIP renewals: function returns immediately — no double payment.

export async function payReferralBonusOnFirstVIP(referredUserId: string): Promise<void> {
  const referral = await db.referral.findUnique({ where: { referredId: referredUserId } });
  if (!referral)                 return; // not a referred user
  if (referral.referralRewarded) return; // already rewarded — idempotency guard

  // Read bonus from SystemConfig (cached 60s)
  const bonusUSD = await getReferralBonus();

  await db.$transaction(async (tx) => {
    // Re-check inside transaction to guard concurrent VIP purchases
    const locked = await tx.referral.findUnique({ where: { referredId: referredUserId } });
    if (!locked || locked.referralRewarded) return;

    await tx.referral.update({
      where: { referredId: referredUserId },
      data: {
        referralRewarded: true,
        rewardedAt:       new Date(),
        isActive:         true,
        activatedAt:      new Date(),
      },
    });

    // Credit one-time bonus to referrer's referral wallet
    await creditWallet(tx, referral.referrerId, "referral", bonusUSD);
    await writeLedgerEntry(tx, {
      userId: referral.referrerId, type: "referral_bonus", toWallet: "referral",
      amount: bonusUSD, description: "Referral bonus — referred user purchased VIP",
      referenceId: referredUserId, referenceType: "referral",
    });
  });
}

// ── activateReferral: no-op (previously called on bet/deposit, now removed) ──
// Kept for backward compatibility with import sites.
// Referral activation now requires a first VIP purchase.
export async function activateReferral(_referredUserId: string): Promise<void> {
  /* no-op — replaced by payReferralBonusOnFirstVIP() */
}
