/**
 * Activity Scoring Foundation — Phase 20
 *
 * Fire-and-forget helpers called from existing event handlers.
 * Each function updates one dimension of AmbassadorActivityScore and recomputes
 * the weighted composite score.
 *
 * Weights (defined in architecture audit):
 *   Game Activity    25%
 *   Deposits         20%
 *   VIP Subscription 20%
 *   Tasks            15%
 *   Football AI      5%
 *   Other            15%
 *
 * All functions are non-blocking — callers should invoke without await or
 * wrap in setImmediate() so failures never affect the primary flow.
 */
import { db } from "../../db";
import { getConfigValue } from "../admin/config/admin.config.service";

const DEFAULT_WEIGHTS = {
  gameScore:     0.25,
  depositScore:  0.20,
  vipScore:      0.20,
  taskScore:     0.15,
  footballScore: 0.05,
  otherScore:    0.15,
};

/** Read activity score weights from SystemConfig; falls back per-key to DEFAULT_WEIGHTS. */
async function getActivityWeights(): Promise<typeof DEFAULT_WEIGHTS> {
  const [game, deposit, vip, task, football, other] = await Promise.all([
    getConfigValue<number>("ambassador.activity_weights.game",     DEFAULT_WEIGHTS.gameScore),
    getConfigValue<number>("ambassador.activity_weights.deposit",  DEFAULT_WEIGHTS.depositScore),
    getConfigValue<number>("ambassador.activity_weights.vip",      DEFAULT_WEIGHTS.vipScore),
    getConfigValue<number>("ambassador.activity_weights.task",     DEFAULT_WEIGHTS.taskScore),
    getConfigValue<number>("ambassador.activity_weights.football", DEFAULT_WEIGHTS.footballScore),
    getConfigValue<number>("ambassador.activity_weights.other",    DEFAULT_WEIGHTS.otherScore),
  ]);
  // Validate each weight is a non-negative number; fall back to default if not
  const safe = (v: unknown, d: number) =>
    (typeof v === "number" && v >= 0) ? v : d;
  return {
    gameScore:     safe(game,     DEFAULT_WEIGHTS.gameScore),
    depositScore:  safe(deposit,  DEFAULT_WEIGHTS.depositScore),
    vipScore:      safe(vip,      DEFAULT_WEIGHTS.vipScore),
    taskScore:     safe(task,     DEFAULT_WEIGHTS.taskScore),
    footballScore: safe(football, DEFAULT_WEIGHTS.footballScore),
    otherScore:    safe(other,    DEFAULT_WEIGHTS.otherScore),
  };
}

async function upsertScore(userId: string, updates: Partial<{
  gameScore:    number;
  depositScore: number;
  vipScore:     number;
  taskScore:    number;
  footballScore:number;
  otherScore:   number;
}>): Promise<void> {
  // Fetch current values (or defaults) and apply updates
  const current = await db.ambassadorActivityScore.upsert({
    where:  { userId },
    create: { userId, ...updates },
    update: updates,
  });

  // Read weights from SystemConfig and recompute composite
  const W = await getActivityWeights();
  const composite = parseFloat((
    (current.gameScore     * W.gameScore)   +
    (current.depositScore  * W.depositScore) +
    (current.vipScore      * W.vipScore)     +
    (current.taskScore     * W.taskScore)    +
    (current.footballScore * W.footballScore)+
    (current.otherScore    * W.otherScore)
  ).toFixed(4));

  await db.ambassadorActivityScore.update({
    where: { userId },
    data:  { compositeScore: composite },
  });
}

/** Call after any game bet settles (win or loss). increment = fee paid or bet amount. */
export function recordGameActivity(userId: string, increment: number): void {
  upsertScore(userId, { gameScore: { increment } as any }).catch(() => {});
}

/** Call after a deposit is confirmed. */
export function recordDepositActivity(userId: string, amountUsd: number): void {
  upsertScore(userId, { depositScore: { increment: amountUsd } as any }).catch(() => {});
}

/** Call after VIP subscription is activated. */
export function recordVipActivity(userId: string, priceUsd: number): void {
  upsertScore(userId, { vipScore: { increment: priceUsd } as any }).catch(() => {});
}

/** Call after a task proof is approved and reward paid. */
export function recordTaskActivity(userId: string, rewardUsd: number): void {
  upsertScore(userId, { taskScore: { increment: rewardUsd } as any }).catch(() => {});
}

/** Call after a Football Hub daily claim succeeds. */
export function recordFootballActivity(userId: string): void {
  upsertScore(userId, { footballScore: { increment: 1 } as any }).catch(() => {});
}

/** Call for any other platform activity (referral bonus earned, etc.). */
export function recordOtherActivity(userId: string, value: number): void {
  upsertScore(userId, { otherScore: { increment: value } as any }).catch(() => {});
}
