/**
 * Commission Engine — 3-tier MLM calculation and distribution.
 *
 * Phase 20 extension: per-upline programLevel check.
 *   Each beneficiary in the upline chain is checked for their programLevel.
 *   - "ambassador" level → Ambassador rates applied, credited to "ambassador" wallet.
 *   - "affiliate" or "referral" level → Standard affiliate rates, credited to "affiliate" wallet.
 *
 * CORRECTED LOGIC (Phase 3F Section D):
 *   Commission is generated when platform collects a fee from a VIP user,
 *   regardless of whether the VIP user won or lost.
 *
 *   grossAmount = the VIP user's individual fee contribution (stake × feeRate).
 *   NOT the total round fee.
 *
 *   NO commission on void / cancelled / refunded rounds.
 *
 * CONFIGURATION:
 *   Commission rates are read from SystemConfig at runtime with a 60-second
 *   in-memory cache. Defaults kick in when SystemConfig is unavailable.
 *   Config keys: affiliate.commission_rates.{event_type}
 *                ambassador.commission_rates.{event_type}
 */
import { creditWallet, writeLedgerEntry } from "../wallets/wallets.service";
import { db } from "../../db";

export type CommissionEvent = "vip_subscription" | "task_completion" | "game_fee" | "game_fee_multi";

// Fallback rates used when SystemConfig DB is unreachable
const DEFAULT_RATES: Record<CommissionEvent, number[]> = {
  vip_subscription: [0.28, 0.07, 0.04],
  task_completion:  [0.10, 0.03, 0.02],
  game_fee:         [0.20, 0.05, 0.03],
  game_fee_multi:   [0.10, 0.03, 0.02],
};

// Ambassador fallback rates — higher tiers, credited to "ambassador" wallet
const DEFAULT_AMBASSADOR_RATES: Record<CommissionEvent, number[]> = {
  vip_subscription: [0.40, 0.10, 0.06],
  task_completion:  [0.10, 0.03, 0.02],  // same as affiliate — tasks unaffected
  game_fee:         [0.40, 0.10, 0.06],
  game_fee_multi:   [0.20, 0.06, 0.04],
};

interface RateBundle {
  affiliate:   Record<CommissionEvent, number[]>;
  ambassador:  Record<CommissionEvent, number[]>;
}

// 60-second in-memory cache so admin rate changes propagate within 1 minute
let _rateCache: { bundle: RateBundle; expiresAt: number } | null = null;
const RATE_CACHE_TTL = 60_000;

async function getRates(): Promise<RateBundle> {
  if (_rateCache && Date.now() < _rateCache.expiresAt) return _rateCache.bundle;

  const AFFILIATE_KEYS = [
    "affiliate.commission_rates.vip_subscription",
    "affiliate.commission_rates.task_completion",
    "affiliate.commission_rates.game_fee",
    "affiliate.commission_rates.game_fee_multi",
  ];
  const AMBASSADOR_KEYS = [
    "ambassador.commission_rates.vip_subscription",
    "ambassador.commission_rates.task_completion",
    "ambassador.commission_rates.game_fee",
    "ambassador.commission_rates.game_fee_multi",
  ];

  const rows = await db.systemConfig.findMany({
    where: { key: { in: [...AFFILIATE_KEYS, ...AMBASSADOR_KEYS] } },
  });

  const byKey = Object.fromEntries(rows.map(r => [r.key, r.value]));

  const parseArr = (key: string, fallback: number[]): number[] => {
    try {
      const v = JSON.parse(byKey[key] ?? "null");
      return Array.isArray(v) && v.length >= 3 ? v : fallback;
    } catch {
      return fallback;
    }
  };

  const bundle: RateBundle = {
    affiliate: {
      vip_subscription: parseArr("affiliate.commission_rates.vip_subscription", DEFAULT_RATES.vip_subscription),
      task_completion:  parseArr("affiliate.commission_rates.task_completion",  DEFAULT_RATES.task_completion),
      game_fee:         parseArr("affiliate.commission_rates.game_fee",          DEFAULT_RATES.game_fee),
      game_fee_multi:   parseArr("affiliate.commission_rates.game_fee_multi",    DEFAULT_RATES.game_fee_multi),
    },
    ambassador: {
      vip_subscription: parseArr("ambassador.commission_rates.vip_subscription", DEFAULT_AMBASSADOR_RATES.vip_subscription),
      task_completion:  parseArr("ambassador.commission_rates.task_completion",  DEFAULT_AMBASSADOR_RATES.task_completion),
      game_fee:         parseArr("ambassador.commission_rates.game_fee",          DEFAULT_AMBASSADOR_RATES.game_fee),
      game_fee_multi:   parseArr("ambassador.commission_rates.game_fee_multi",    DEFAULT_AMBASSADOR_RATES.game_fee_multi),
    },
  };

  _rateCache = { bundle, expiresAt: Date.now() + RATE_CACHE_TTL };
  return bundle;
}

interface CommissionResult {
  distributed: boolean;
  tiers: Array<{ tier: number; beneficiaryId: string; commission: number; walletType: string }>;
  reason?: string;
}

interface UplineNode {
  id:           string;
  programLevel: string;
}

export async function isUserVIP(userId: string): Promise<boolean> {
  const sub = await db.subscription.findUnique({ where: { userId } });
  return !!(sub?.isActive && sub.endsAt > new Date());
}

async function resolveUplineChain(userId: string): Promise<UplineNode[]> {
  const uplines: UplineNode[] = [];
  let currentId = userId;
  for (let tier = 1; tier <= 3; tier++) {
    const user = await db.user.findUnique({
      where:  { id: currentId },
      select: { uplineId: true, programLevel: true },
    });
    if (!user?.uplineId) break;
    // Fetch the upline user's programLevel
    const uplineUser = await db.user.findUnique({
      where:  { id: user.uplineId },
      select: { id: true, programLevel: true },
    });
    if (!uplineUser) break;
    uplines.push({ id: uplineUser.id, programLevel: uplineUser.programLevel });
    currentId = user.uplineId;
  }
  return uplines;
}

export async function distributeCommissions(opts: {
  sourceUserId: string;
  eventType:    CommissionEvent;
  grossAmount:  number;
  eventRefId?:  string;
}): Promise<CommissionResult> {
  const { sourceUserId, eventType, grossAmount, eventRefId } = opts;

  // vip_subscription commissions are gated at the call site (only enqueued on first VIP purchase).
  // task_completion and game_fee commissions are paid immediately regardless of the source user's VIP status.
  // No VIP requirement is enforced here — all event types distribute freely.

  const uplineChain = await resolveUplineChain(sourceUserId);
  if (uplineChain.length === 0) {
    return { distributed: false, tiers: [], reason: "No upline chain" };
  }

  // Read rates from SystemConfig (60s cache)
  const rateBundle = await getRates();
  const results: Array<{ tier: number; beneficiaryId: string; commission: number; walletType: string }> = [];

  await db.$transaction(async (tx) => {
    // ── Idempotency guards ────────────────────────────────────────────────────
    if (eventType === "vip_subscription") {
      const existing = await tx.affiliateCommission.findFirst({
        where: { sourceUserId, eventType: "vip_subscription" },
      });
      if (existing) return;
    }
    if (eventRefId && eventType !== "vip_subscription") {
      const existing = await tx.affiliateCommission.findFirst({
        where: { sourceUserId, eventType, eventRefId },
      });
      if (existing) return;
    }

    for (let i = 0; i < uplineChain.length; i++) {
      const tier           = i + 1;
      const node           = uplineChain[i];
      const beneficiaryId  = node.id;
      const isAmbassador   = node.programLevel === "ambassador";

      // Select rate set and target wallet based on beneficiary's program level
      const rates      = isAmbassador ? rateBundle.ambassador[eventType] : rateBundle.affiliate[eventType];
      const walletType = isAmbassador ? "ambassador" : "affiliate";
      const rate       = rates[i] ?? 0;
      const commission = parseFloat((grossAmount * rate).toFixed(8));
      if (commission <= 0) continue;

      await creditWallet(tx, beneficiaryId, walletType as any, commission);
      await tx.affiliateCommission.create({
        data: { beneficiaryId, sourceUserId, tier, eventType, eventRefId, grossAmount, rate, commission, status: "paid" },
      });
      await writeLedgerEntry(tx, {
        userId: beneficiaryId,
        type: isAmbassador ? "ambassador_commission" : "affiliate_commission",
        toWallet: walletType,
        amount: commission,
        description: `Tier ${tier} ${walletType} commission — ${eventType}`,
        referenceId: eventRefId,
        referenceType: isAmbassador ? "ambassador_commission" : "affiliate_commission",
        metadata: { tier, eventType, sourceUserId, rate, programLevel: node.programLevel },
      });
      results.push({ tier, beneficiaryId, commission, walletType });
    }
  });

  return { distributed: results.length > 0, tiers: results };
}

/**
 * Trigger fee-based commission after a real game bet settles.
 * Call this for BOTH wins and losses. Do NOT call on void/cancelled rounds.
 * Enqueues a DB-backed job — survives server crash, retried up to 3x.
 */
export async function triggerGameFeeCommission(opts: {
  userId:      string;
  userFee:     number;   // stake × PLATFORM_FEE_RATE
  isMultiGame: boolean;
  eventRefId?: string;
}): Promise<void> {
  const eventType: CommissionEvent = opts.isMultiGame ? "game_fee_multi" : "game_fee";
  // Uses db directly (no import from commissionJob.ts) to avoid circular dependency.
  await db.commissionJob.create({
    data: {
      jobType: "distribute_commissions",
      payload: JSON.stringify({
        sourceUserId: opts.userId,
        eventType,
        grossAmount:  opts.userFee,
        eventRefId:   opts.eventRefId,
      }),
    },
  }).catch(err => console.error("[Commission] Failed to enqueue game fee job:", err));
}
