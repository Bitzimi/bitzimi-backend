/**
 * Monthly Referral Challenge Service — Phase 20 (Corrected)
 *
 * Three separate prize pools, one per program level:
 *   - Referral pool:   $200 default — distributed equally among top 50 referral-level users
 *   - Affiliate pool:  $350 default — distributed equally among top 10 affiliate-level users
 *   - Ambassador pool: $400 default — distributed equally among top 3 ambassador-level users
 *
 * VIP grants (1st=30d, 2nd=20d, 3rd=10d) are awarded to the overall top 3
 * referrers across all levels and are issued by admin via grantVipReward().
 *
 * All features gated by: feature.monthly_challenge (default: false).
 */
import { db } from "../../db";
import { getConfigValue } from "../admin/config/admin.config.service";
import { creditWallet, writeLedgerEntry } from "../wallets/wallets.service";

type ProgramLevel = "referral" | "affiliate" | "ambassador";

export async function getActiveChallenge() {
  const now = new Date();
  return db.referralChallenge.findFirst({
    where: {
      status: "active",
      startAt: { lte: now },
      endAt:   { gte: now },
    },
  });
}

// ── Per-level leaderboard helpers ─────────────────────────────────────────────

async function buildLevelLeaderboard(
  challengeId: string,
  level: ProgramLevel,
  topN: number,
): Promise<Array<{ rank: number; userId: string; username: string; referrals: number }>> {
  // Group entries by referrerId, only for referrers at the given programLevel
  const grouped = await db.challengeEntry.groupBy({
    by:      ["referrerId"],
    where:   { challengeId },
    _count:  { referrerId: true },
    orderBy: { _count: { referrerId: "desc" } },
  });

  // Filter to only users whose programLevel matches
  const levelFiltered: Array<{ userId: string; referrals: number }> = [];
  for (const row of grouped) {
    if (levelFiltered.length >= topN) break;
    const user = await db.user.findUnique({
      where:  { id: row.referrerId },
      select: { programLevel: true },
    });
    if (user?.programLevel === level) {
      levelFiltered.push({ userId: row.referrerId, referrals: row._count.referrerId });
    }
  }

  // Enrich with username
  return Promise.all(
    levelFiltered.slice(0, topN).map(async (row, idx) => {
      const profile = await db.userProfile.findUnique({
        where:  { userId: row.userId },
        select: { username: true },
      });
      return {
        rank:      idx + 1,
        userId:    row.userId,
        username:  profile?.username ?? "unknown",
        referrals: row.referrals,
      };
    }),
  );
}

// ── Leaderboard APIs ──────────────────────────────────────────────────────────

/**
 * User-facing: returns ONLY the leaderboard for the given program level.
 * The route layer resolves the level from req.user.sub before calling this.
 */
export async function getUserLevelLeaderboard(level: ProgramLevel) {
  const enabled = await getConfigValue<boolean>("feature.monthly_challenge", false);
  if (!enabled) return { enabled: false, challenge: null, leaderboard: [] };

  const challenge = await getActiveChallenge();
  if (!challenge) return { enabled: true, challenge: null, leaderboard: [] };

  const topN =
    level === "referral"   ? challenge.referralTopN  :
    level === "affiliate"  ? challenge.affiliateTopN  :
                             challenge.ambassadorTopN;

  const pool =
    level === "referral"   ? challenge.referralPool  :
    level === "affiliate"  ? challenge.affiliatePool  :
                             challenge.ambassadorPool;

  const leaderboard = await buildLevelLeaderboard(challenge.id, level, topN);

  return {
    enabled:   true,
    level,
    challenge: {
      id:     challenge.id,
      title:  challenge.title,
      period: challenge.period,
      endAt:  challenge.endAt.toISOString(),
      pool,
      topN,
      status: challenge.status,
    },
    leaderboard,
  };
}

/**
 * Admin-facing: returns all three leaderboards simultaneously.
 * Called only from the admin route — never exposed to regular users.
 */
export async function getCurrentChallengeLeaderboard(challengeId?: string) {
  const enabled = await getConfigValue<boolean>("feature.monthly_challenge", false);
  if (!enabled) return { enabled: false, challenge: null, leaderboards: {} };

  const challenge = challengeId
    ? await db.referralChallenge.findUnique({ where: { id: challengeId } })
    : await getActiveChallenge();

  if (!challenge) return { enabled: true, challenge: null, leaderboards: {} };

  const [referralBoard, affiliateBoard, ambassadorBoard] = await Promise.all([
    buildLevelLeaderboard(challenge.id, "referral",   challenge.referralTopN),
    buildLevelLeaderboard(challenge.id, "affiliate",  challenge.affiliateTopN),
    buildLevelLeaderboard(challenge.id, "ambassador", challenge.ambassadorTopN),
  ]);

  return {
    enabled:   true,
    challenge: {
      id:             challenge.id,
      title:          challenge.title,
      period:         challenge.period,
      endAt:          challenge.endAt.toISOString(),
      referralPool:   challenge.referralPool,
      affiliatePool:  challenge.affiliatePool,
      ambassadorPool: challenge.ambassadorPool,
      referralTopN:   challenge.referralTopN,
      affiliateTopN:  challenge.affiliateTopN,
      ambassadorTopN: challenge.ambassadorTopN,
      status:         challenge.status,
    },
    leaderboards: {
      referral:   referralBoard,
      affiliate:  affiliateBoard,
      ambassador: ambassadorBoard,
    },
  };
}

/**
 * Called after a referred user purchases VIP for the first time.
 * Records a ChallengeEntry if there's an active challenge.
 */
export async function recordChallengeEntryOnVip(referredUserId: string): Promise<void> {
  const enabled = await getConfigValue<boolean>("feature.monthly_challenge", false);
  if (!enabled) return;

  const activeChallenge = await getActiveChallenge();
  if (!activeChallenge) return;

  const referred = await db.user.findUnique({
    where:  { id: referredUserId },
    select: { uplineId: true },
  });
  if (!referred?.uplineId) return;

  // Idempotent — unique constraint on (challengeId, referredId)
  await db.challengeEntry.upsert({
    where:  { challengeId_referredId: { challengeId: activeChallenge.id, referredId: referredUserId } },
    create: { challengeId: activeChallenge.id, referrerId: referred.uplineId, referredId: referredUserId },
    update: {},
  });
}

// ── VIP Grant ─────────────────────────────────────────────────────────────────

/** Read VIP bonus days from SystemConfig (all configurable by admin). */
async function getVipGrantDays(): Promise<Record<1 | 2 | 3, number>> {
  const [r1, r2, r3] = await Promise.all([
    getConfigValue<number>("challenge.vip_grant.rank1_days", 30),
    getConfigValue<number>("challenge.vip_grant.rank2_days", 20),
    getConfigValue<number>("challenge.vip_grant.rank3_days", 10),
  ]);
  return { 1: r1, 2: r2, 3: r3 };
}

/**
 * Grant VIP time to a user without triggering payment or commission.
 * Extends active subscription or creates a new one from now.
 * Records in VipGrant table and writes ledger entry.
 */
export async function grantVipReward(opts: {
  userId:      string;
  durationDays: number;
  grantedBy:   string;
  reason?:     string;
  challengeId?: string;
}): Promise<void> {
  const { userId, durationDays, grantedBy, reason, challengeId } = opts;
  const durationMs = durationDays * 24 * 60 * 60 * 1000;

  await db.$transaction(async (tx) => {
    // Extend existing subscription or create new one
    const existing = await tx.subscription.findUnique({ where: { userId } });
    const now      = new Date();

    let appliedUntil: Date;
    if (existing && existing.isActive && existing.endsAt > now) {
      // Extend from current expiry
      appliedUntil = new Date(existing.endsAt.getTime() + durationMs);
      await tx.subscription.update({
        where: { userId },
        data:  { endsAt: appliedUntil, isActive: true },
      });
    } else {
      // Start fresh VIP period from now
      appliedUntil = new Date(now.getTime() + durationMs);
      await tx.subscription.upsert({
        where:  { userId },
        create: { userId, plan: "monthly", price: 0, isActive: true, startedAt: now, endsAt: appliedUntil, paymentRef: `grant:${grantedBy}` },
        update: { isActive: true, endsAt: appliedUntil, startedAt: now, paymentRef: `grant:${grantedBy}` },
      });
    }

    // Record the grant
    await tx.vipGrant.create({
      data: { userId, grantedBy, durationDays, reason: reason ?? null, challengeId: challengeId ?? null, appliedUntil },
    });

    // Ledger entry for audit trail — not a financial transaction, amount=0
    await writeLedgerEntry(tx, {
      userId,
      type:          "vip_grant",
      amount:        0,
      description:   `VIP granted: ${durationDays} days${reason ? ` — ${reason}` : ""}`,
      referenceId:   challengeId ?? null,
      referenceType: challengeId ? "challenge_reward" : "admin_grant",
      metadata:      { durationDays, grantedBy, challengeId },
    });
  });
}

// ── Admin operations ──────────────────────────────────────────────────────────

export async function adminCreateChallenge(input: {
  title:          string;
  description?:   string;
  period:         string;
  startAt:        string;
  endAt:          string;
  referralPool?:  number;
  referralTopN?:  number;
  affiliatePool?: number;
  affiliateTopN?: number;
  ambassadorPool?:number;
  ambassadorTopN?:number;
}) {
  return db.referralChallenge.create({
    data: {
      title:          input.title,
      description:    input.description ?? null,
      period:         input.period,
      startAt:        new Date(input.startAt),
      endAt:          new Date(input.endAt),
      referralPool:   input.referralPool  ?? 200,
      referralTopN:   input.referralTopN  ?? 50,
      affiliatePool:  input.affiliatePool ?? 350,
      affiliateTopN:  input.affiliateTopN ?? 10,
      ambassadorPool: input.ambassadorPool ?? 400,
      ambassadorTopN: input.ambassadorTopN ?? 3,
      status:         "upcoming",
    },
  });
}

export async function adminActivateChallenge(id: string) {
  return db.referralChallenge.update({
    where: { id },
    data:  { status: "active" },
  });
}

/**
 * End a challenge and distribute the three cash pools.
 * Distributes each pool equally among the top-N of its program level.
 * VIP grants are separate — use grantVipReward() for top 3 winners.
 */
export async function adminEndAndDistributeChallenge(id: string, adminId: string): Promise<{
  referralWinners:   number;
  affiliateWinners:  number;
  ambassadorWinners: number;
  totalDistributed:  number;
}> {
  const challenge = await db.referralChallenge.findUnique({ where: { id } });
  if (!challenge) throw Object.assign(new Error("Challenge not found"), { statusCode: 404 });
  if (challenge.status === "ended") throw Object.assign(new Error("Already ended"), { statusCode: 409 });

  const [referralBoard, affiliateBoard, ambassadorBoard] = await Promise.all([
    buildLevelLeaderboard(id, "referral",   challenge.referralTopN),
    buildLevelLeaderboard(id, "affiliate",  challenge.affiliateTopN),
    buildLevelLeaderboard(id, "ambassador", challenge.ambassadorTopN),
  ]);

  let totalDistributed = 0;

  await db.$transaction(async (tx) => {
    await tx.referralChallenge.update({ where: { id }, data: { status: "ended" } });

    // Helper: distribute pool equally among winners of a level.
    // Each level's prize goes to the matching user wallet:
    //   referral  → referral wallet
    //   affiliate → affiliate wallet
    //   ambassador → ambassador wallet
    const LEVEL_WALLET: Record<ProgramLevel, "referral" | "affiliate" | "ambassador"> = {
      referral:   "referral",
      affiliate:  "affiliate",
      ambassador: "ambassador",
    };

    const distributePool = async (
      level: ProgramLevel,
      pool: number,
      winners: typeof referralBoard,
    ) => {
      if (winners.length === 0 || pool <= 0) return;
      const share = parseFloat((pool / winners.length).toFixed(2));
      const toWallet = LEVEL_WALLET[level];

      for (const winner of winners) {
        await creditWallet(tx, winner.userId, toWallet, share);
        await writeLedgerEntry(tx, {
          userId:        winner.userId,
          type:          "challenge_reward",
          toWallet,
          amount:        share,
          description:   `Monthly Challenge ${level} pool — Rank ${winner.rank} of ${winners.length}`,
          referenceId:   id,
          referenceType: "challenge_reward",
          metadata:      { challengeId: id, level, rank: winner.rank, referrals: winner.referrals, pool, winners: winners.length },
        });
        await tx.challengeReward.create({
          data: {
            challengeId: id,
            userId:      winner.userId,
            level,
            rank:        winner.rank,
            amount:      share,
            paid:        true,
            paidAt:      new Date(),
          },
        });
        totalDistributed += share;
      }
    };

    await distributePool("referral",   challenge.referralPool,   referralBoard);
    await distributePool("affiliate",  challenge.affiliatePool,  affiliateBoard);
    await distributePool("ambassador", challenge.ambassadorPool, ambassadorBoard);
  });

  // Grant VIP rewards to overall top 3 referrers (post-transaction, uses grantVipReward)
  const overallTop3 = await db.challengeEntry.groupBy({
    by:      ["referrerId"],
    where:   { challengeId: id },
    _count:  { referrerId: true },
    orderBy: { _count: { referrerId: "desc" } },
    take:    3,
  });

  const vipGrantDays = await getVipGrantDays();

  for (let i = 0; i < overallTop3.length; i++) {
    const rank = (i + 1) as 1 | 2 | 3;
    const days = vipGrantDays[rank];
    await grantVipReward({
      userId:       overallTop3[i].referrerId,
      durationDays: days,
      grantedBy:    adminId,
      reason:       `Monthly Challenge — Overall Rank ${rank} VIP reward`,
      challengeId:  id,
    });
  }

  return {
    referralWinners:   referralBoard.length,
    affiliateWinners:  affiliateBoard.length,
    ambassadorWinners: ambassadorBoard.length,
    totalDistributed:  parseFloat(totalDistributed.toFixed(2)),
  };
}

export async function adminListChallenges() {
  return db.referralChallenge.findMany({ orderBy: { createdAt: "desc" } });
}

export async function adminGrantVip(opts: {
  userId:       string;
  durationDays: number;
  grantedBy:    string;
  reason?:      string;
}): Promise<void> {
  await grantVipReward(opts);
}
