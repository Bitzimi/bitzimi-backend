import { db } from "../../db";
import { dec } from "../../utils/dec";

function parseMetadata(raw: any): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "object") return { ...raw };
  try { return JSON.parse(raw); } catch { return {}; }
}

function walletLabel(value: any): string {
  return String(value ?? "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function gameLabel(value: any): string {
  const names: Record<string,string> = {
    color_game: "Colour Prediction", color_prediction: "Colour Prediction", colour_prediction: "Colour Prediction",
    spin_battle: "Spin Battle", dice_clash: "Dice Clash", dice_royale: "Dice Royale", dice_arena: "Dice Arena",
    pvp_coinflip: "Coin Flip", coin_flip: "Coin Flip", pvp_coin_flip: "Coin Flip", reaction_tap: "Reaction Tap",
  };
  const key = String(value ?? "").toLowerCase().replace(/[-\s]/g, "_");
  return names[key] ?? walletLabel(key);
}

async function hydrateTransaction(raw: any) {
  let type = raw.type;
  let description = raw.description;
  let metadata = parseMetadata(raw.metadata);
  if (raw.fromWallet) metadata.fromWallet = raw.fromWallet;
  if (raw.toWallet) metadata.toWallet = raw.toWallet;

  try {
    if (raw.referenceType === "withdrawal" && raw.referenceId) {
      const w = await db.withdrawal.findUnique({ where: { id: raw.referenceId }, select: { id: true, paymentMethod: true, destination: true, txHash: true, fee: true, netAmount: true, processedAt: true, status: true } });
      if (w) metadata = { ...metadata, method: w.paymentMethod, destination: w.destination, txHash: w.txHash ?? metadata.txHash ?? null, withdrawalId: w.id, fee: dec(w.fee), netAmount: dec(w.netAmount), withdrawalStatus: w.status, processedAt: w.processedAt?.toISOString() ?? null, referenceCode: w.txHash ?? null, referenceKind: w.paymentMethod === "crypto" ? "blockchain_hash" : "bank_reference" };
    }
    if (raw.referenceType === "deposit" && raw.referenceId) {
      const d = await db.deposit.findUnique({ where: { id: raw.referenceId }, select: { id: true, paymentMethod: true, paymentAddress: true, txHash: true, confirmedAt: true, status: true } });
      if (d) metadata = { ...metadata, method: d.paymentMethod, paymentAddress: d.paymentAddress, txHash: d.txHash ?? metadata.txHash ?? null, depositId: d.id, depositStatus: d.status, confirmedAt: d.confirmedAt?.toISOString() ?? null, referenceCode: d.txHash ?? null, referenceKind: d.paymentMethod === "crypto" ? "blockchain_hash" : "bank_reference", network: d.paymentMethod === "crypto" ? "USDT BEP-20" : undefined };
    }
    if (raw.referenceType === "task_proof" && raw.referenceId) {
      const proof = await db.taskProof.findUnique({ where: { id: raw.referenceId }, select: { id: true, taskId: true, userId: true, rewardAmount: true, task: { select: { id: true, title: true, type: true, advertiserId: true } } } });
      if (proof) metadata = { ...metadata, proofId: proof.id, taskId: proof.taskId, taskTitle: proof.task?.title, taskType: proof.task?.type, workerId: proof.userId, advertiserId: proof.task?.advertiserId, rewardAmount: proof.rewardAmount, sourceLabel: proof.task?.title ? `Task: ${proof.task.title}` : "Completed Task", destinationLabel: raw.toWallet ? `${walletLabel(raw.toWallet)} Wallet` : "Task Wallet" };
    }
    if (raw.referenceType === "referral" && raw.referenceId) {
      const r = await db.referral.findUnique({ where: { referredId: raw.referenceId }, select: { referredId: true, referrerId: true } });
      if (r) metadata = { ...metadata, referredUserId: r.referredId, referrerId: r.referrerId, rewardTrigger: "First VIP purchase", sourceLabel: "Referral - First VIP purchase", destinationLabel: raw.toWallet ? `${walletLabel(raw.toWallet)} Wallet` : "Referral Wallet" };
    }
    if (raw.referenceType === "challenge_reward" && raw.referenceId) {
      const c = await db.referralChallenge.findUnique({ where: { id: raw.referenceId }, select: { id: true, title: true, period: true } });
      if (c) metadata = { ...metadata, challengeId: c.id, challengeTitle: c.title, challengePeriod: c.period, sourceLabel: `Monthly Challenge: ${c.title}`, destinationLabel: raw.toWallet ? `${walletLabel(raw.toWallet)} Wallet` : "Task Wallet" };
    }
    if (raw.referenceType === "game_bet" && raw.referenceId) {
      const b = await db.gameBet.findUnique({ where: { id: raw.referenceId }, select: { id: true, amount: true, round: { select: { id: true, gameType: true, lobbyId: true, roundNumber: true } } } });
      if (b) metadata = { ...metadata, gameType: b.round.gameType, stake: b.amount, stakeRoom: b.amount, roundId: b.round.id, roundNumber: b.round.roundNumber, ...(b.round.lobbyId ? { lobby: b.round.lobbyId } : {}) };
    }
    if (raw.referenceType === "game_round") {
      const roundId = metadata.roundId ?? raw.referenceId;
      if (roundId) {
        const round = await db.gameRound.findUnique({ where: { id: String(roundId) }, select: { id: true, gameType: true, lobbyId: true, roundNumber: true, resultData: true } }).catch(() => null);
        if (round) {
          let result: any = null; try { result = round.resultData ? JSON.parse(round.resultData) : null; } catch {}
          metadata = { ...metadata, roundId: round.id, gameType: round.gameType, ...(round.lobbyId ? { lobby: round.lobbyId } : {}), roundNumber: round.roundNumber, ...(result?.winner ? { winnerId: result.winner } : {}) };
        }
        const dice = await db.diceRound.findUnique({ where: { id: String(roundId) }, select: { id: true, gameType: true, stake: true, roundNumber: true } }).catch(() => null);
        if (dice) metadata = { ...metadata, roundId: dice.id, gameType: dice.gameType, stake: dice.stake, stakeRoom: dice.stake, roundNumber: dice.roundNumber };
      }
    }
    if (raw.referenceType === "pvp_match" && raw.referenceId) {
      const m = await db.pvpMatch.findUnique({ where: { id: raw.referenceId }, select: { id: true, gameType: true, stake: true, player1Id: true, player2Id: true, resultData: true } });
      if (m) { let result: any = null; try { result = m.resultData ? JSON.parse(m.resultData) : null; } catch {}; metadata = { ...metadata, gameType: m.gameType, stake: m.stake, stakeRoom: m.stake, matchId: m.id, opponentId: m.player1Id === raw.userId ? m.player2Id : m.player1Id, ...(m.gameType === "dice_clash" ? { roll: m.player1Id === raw.userId ? result?.p1Roll : result?.p2Roll } : {}) }; }
    }
  } catch (err) {
    console.warn("[Transactions] detail hydration skipped:", err);
  }

  if (type === "affiliate_commission") metadata = { ...metadata, sourceLabel: metadata.sourceLabel ?? `${walletLabel(metadata.eventType ?? "Activity")} commission`, destinationLabel: metadata.destinationLabel ?? `${walletLabel(raw.toWallet ?? "affiliate")} Wallet` };
  if (type === "ambassador_commission") metadata = { ...metadata, sourceLabel: metadata.sourceLabel ?? `${walletLabel(metadata.eventType ?? "Activity")} reward`, destinationLabel: metadata.destinationLabel ?? `${walletLabel(raw.toWallet ?? "ambassador")} Wallet` };
  if (type === "referral_bonus") metadata = { ...metadata, sourceLabel: metadata.sourceLabel ?? "Referral Reward", destinationLabel: metadata.destinationLabel ?? `${walletLabel(raw.toWallet ?? "referral")} Wallet` };
  if ((metadata.gameType || raw.referenceType === "game_round" || raw.referenceType === "pvp_match") && /\b(void|refund|cancelled)\b/i.test(description ?? "")) type = "game_void";
  if (raw.referenceType === "auction_collection" && raw.referenceId) { const c = await db.auctionCollection.findUnique({ where: { id: raw.referenceId }, include: { auction: true } }).catch(() => null); if (c) metadata = { ...metadata, auctionId: c.auctionId, auctionTitle: c.auction?.title, rewardType: c.auction?.rewardType, sourceLabel: c.auction?.title ? `Auction Reward: ${c.auction.title}` : "Auction Reward", destinationLabel: raw.toWallet ? `${walletLabel(raw.toWallet)} Wallet` : "Game Wallet" }; }
  if (raw.referenceType === "featured_request" && raw.referenceId) { const f = await db.featuredRequest.findUnique({ where: { id: raw.referenceId }, select: { id: true, taskId: true, durationDays: true, amount: true, userId: true, promotionId: true } }).catch(() => null); if (f) metadata = { ...metadata, taskId: f.taskId, durationDays: f.durationDays, promotionId: f.promotionId, sourceLabel: type === "featured_refund" ? "Featured Placement Refund" : "Featured Placement", destinationLabel: raw.toWallet ? `${walletLabel(raw.toWallet)} Wallet` : undefined }; }
  const lower = String(description ?? "").toLowerCase();
  if ((metadata.voided === true || metadata.voided === "true") || (type === "transfer" && /colour\s+prediction.*void|color\s+prediction.*void|colour\s+game.*void|color\s+game.*void/.test(lower))) type = "game_void";
  if (type === "transfer" && raw.fromWallet && raw.toWallet) description = `Wallet Transfer - ${walletLabel(raw.fromWallet)} Wallet → ${walletLabel(raw.toWallet)} Wallet`;
  if (raw.referenceType === "vip_subscription" || type === "vip_purchase") { type = "vip_purchase"; metadata = { ...metadata, subscriptionType: "VIP", subscriptionPlan: metadata.subscriptionPlan ?? "Monthly", durationDays: metadata.durationDays ?? 30, method: "Wallet", sourceLabel: `${walletLabel(raw.fromWallet ?? "game")} Wallet`, destinationLabel: "VIP Membership" }; description = `VIP Subscription - ${metadata.subscriptionPlan}`; }
  if (raw.referenceType === "vip_streak" || type === "streak_reward") { type = "streak_reward"; metadata = { ...metadata, rewardType: "Daily Streak", streakDay: metadata.day ?? metadata.streakDay ?? null, sourceLabel: "Daily Streak", destinationLabel: `${walletLabel(raw.toWallet ?? "game")} Wallet` }; description = `Daily Streak Reward${metadata.streakDay ? ` - Day ${metadata.streakDay}` : ""}`; }
  if (type === "referral_bonus") description = `Referral Bonus - ${metadata.rewardTrigger ?? "Referral reward"}`;
  if (type === "affiliate_commission") description = `Affiliate Commission - Tier ${metadata.tier ?? ""} - ${walletLabel(metadata.eventType ?? "commission")}`.replace(/- $/, "");
  if (type === "ambassador_commission") description = `Ambassador Reward - Tier ${metadata.tier ?? ""} - ${walletLabel(metadata.eventType ?? "commission")}`.replace(/- $/, "");
  if (type === "task_reward") description = `Task Reward - ${metadata.taskTitle ?? "Completed Task"}`;
  if (type === "challenge_reward") description = `Monthly Challenge Reward - ${walletLabel(metadata.level ?? "Reward")} - Rank ${metadata.rank ?? ""}`.replace(/- $/, "");
  if (type === "vip_grant") description = `VIP Grant - ${metadata.durationDays ?? 0} days${metadata.reason ? ` - ${metadata.reason}` : ""}`;
  if (type === "auction_bid") description = `Auction Bid${metadata.title ? ` - ${metadata.title}` : ""}${metadata.bidNumber ? ` - Bid #${metadata.bidNumber}` : ""}`;
  if (type === "featured_payment") description = `Featured Placement Payment - ${metadata.title ?? "Task"}${metadata.durationDays ? ` - ${metadata.durationDays} day(s)` : ""}`;
  if (type === "featured_refund") description = `Featured Placement Refund - ${metadata.taskId ?? "Task"}`;
  if (type === "withdrawal") description = `Withdrawal - ${walletLabel(metadata.method ?? "")}`;
  if (type === "deposit") description = `${walletLabel(metadata.method ?? "Deposit")} Deposit`;
  if (type.startsWith("game_") && metadata.gameType) {
    const action = type === "game_win" ? "Win" : type === "game_loss" ? "Loss" : type === "game_bet" ? "Bet" : "Void";
    const lobby = metadata.lobby ?? metadata.lobbyName ?? metadata.lobbyId;
    const stake = metadata.stakeRoom ?? metadata.stake ?? metadata.stakeAmount ?? metadata.roomStake;
    const context = lobby != null && String(lobby).trim() !== "" ? `Lobby ${String(lobby).replace(/^Lobby\s*/i, "")}` : stake != null && String(stake).trim() !== "" ? `Stake Room $${Number(stake).toLocaleString()}` : "";
    description = `${gameLabel(metadata.gameType)} ${action}${context ? ` - ${context}` : ""}`;
  }

  if (type !== "deposit" && type !== "withdrawal") { delete metadata.referenceCode; delete metadata.referenceKind; delete metadata.txHash; }
  return { ...raw, type, description, metadata: Object.keys(metadata).length ? JSON.stringify(metadata) : null };
}

function serializeTx(tx: any) {
  return {
    id: tx.id, type: tx.type, fromWallet: tx.fromWallet, toWallet: tx.toWallet,
    amount: dec(tx.amount), fee: dec(tx.fee), netAmount: dec(tx.netAmount), status: tx.status,
    description: tx.description, referenceId: tx.referenceId, referenceType: tx.referenceType,
    metadata: tx.metadata, createdAt: tx.createdAt.toISOString(),
  };
}

export async function listTransactions(userId: string, opts: { cursor?: string; limit: number; type?: string }) {
  const { cursor, limit, type } = opts;
  const where: any = { userId };
  if (type) where.type = type;
  if (cursor) { const anchor = await db.transaction.findUnique({ where: { id: cursor } }); if (anchor) where.createdAt = { lt: anchor.createdAt }; }
  const rows = await db.transaction.findMany({ where, orderBy: { createdAt: "desc" }, take: limit + 1 });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1].id : null;
  const hydrated = await Promise.all(items.map(hydrateTransaction));
  return { items: hydrated.map(serializeTx), nextCursor, hasMore };
}

export async function getTransaction(userId: string, txId: string) {
  const tx = await db.transaction.findFirst({ where: { id: txId, userId } });
  if (!tx) throw Object.assign(new Error("Transaction not found"), { statusCode: 404, code: "NOT_FOUND" });
  return serializeTx(await hydrateTransaction(tx));
}