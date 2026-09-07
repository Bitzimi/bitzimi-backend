import { db } from "../../db";
import { dec } from "../../utils/dec";

export type WalletType = "main"|"game"|"task"|"referral"|"affiliate"|"task_vault"|"ambassador";
const ALL_WALLET_TYPES: WalletType[] = ["main","game","task","referral","affiliate","task_vault","ambassador"];
const WITHDRAWAL_WALLET_TYPES: WalletType[] = ["game", "task", "referral", "affiliate", "ambassador"];

export async function getWallets(userId: string) {
  const wallets = await db.wallet.findMany({ where: { userId } });
  const balances: Record<string, number> = {};
  for (const w of wallets) balances[w.walletType] = dec(w.balance);
  for (const t of ALL_WALLET_TYPES) if (!(t in balances)) balances[t] = 0;
  const totalBalance = WITHDRAWAL_WALLET_TYPES.reduce((s, t) => s + (balances[t] ?? 0), 0);
  return { balances, summary: { totalBalance: parseFloat(totalBalance.toFixed(8)), availableBalance: parseFloat(totalBalance.toFixed(8)) } };
}

export async function getWallet(userId: string, walletType: WalletType) {
  const w = await db.wallet.findUnique({ where: { userId_walletType: { userId, walletType } } });
  if (!w) throw Object.assign(new Error("Wallet not found"), { statusCode: 404, code: "NOT_FOUND" });
  return { walletType: w.walletType, balance: dec(w.balance), lockedAmount: dec(w.lockedAmount), updatedAt: w.updatedAt.toISOString() };
}

export async function debitWallet(tx: any, userId: string, walletType: WalletType, amount: number): Promise<void> {
  const result = await tx.wallet.updateMany({ where: { userId, walletType, isFrozen: false, balance: { gte: amount } }, data: { balance: { decrement: amount } } });
  if (result.count === 0) {
    const w = await tx.wallet.findUnique({ where: { userId_walletType: { userId, walletType } } });
    if (!w) throw new Error(`Wallet ${walletType} not found`);
    if (w.isFrozen) throw Object.assign(new Error(`Wallet ${walletType} is frozen`), { statusCode: 403, code: "WALLET_FROZEN" });
    throw Object.assign(new Error("Insufficient balance"), { statusCode: 400, code: "INSUFFICIENT_BALANCE" });
  }
}

export async function creditWallet(tx: any, userId: string, walletType: WalletType, amount: number): Promise<void> {
  await tx.wallet.update({ where: { userId_walletType: { userId, walletType } }, data: { balance: { increment: amount } } });
}

export async function transferBetweenWallets(userId: string, from: WalletType, to: WalletType, amount: number): Promise<void> {
  if (from === to) throw Object.assign(new Error("Cannot transfer to the same wallet"), { statusCode: 400, code: "SAME_WALLET" });
  await db.$transaction(async (tx) => {
    await debitWallet(tx, userId, from, amount);
    await creditWallet(tx, userId, to, amount);
    await writeLedgerEntry(tx, { userId, type: "transfer", fromWallet: from, toWallet: to, amount, description: `Wallet transfer: ${from} → ${to}`, referenceType: "wallet_transfer" });
  });
}

export async function writeLedgerEntry(tx: any, entry: {
  userId: string;
  type: string;
  fromWallet?: string | null;
  toWallet?: string | null;
  amount: number;
  fee?: number;
  description: string;
  referenceId?: string | null;
  referenceType?: string | null;
  metadata?: Record<string, any>;
}): Promise<void> {
  const fee = entry.fee ?? 0;
  const netAmount = parseFloat((entry.amount - fee).toFixed(8));
  let metadata = entry.metadata ? { ...entry.metadata } : {};

  // Every ledger row carries explicit context so the wallet history never has to
  // infer meaning from the amount or a generic description.
  if (entry.fromWallet) metadata.fromWallet = entry.fromWallet;
  if (entry.toWallet) metadata.toWallet = entry.toWallet;
  if (entry.referenceId) metadata.referenceRecordId = entry.referenceId;
  if (entry.referenceType) metadata.referenceRecordType = entry.referenceType;

  try {
    if (entry.referenceType === "task" && entry.referenceId) {
      const task = await tx.task.findUnique({ where: { id: entry.referenceId }, select: { id: true, title: true, type: true, advertiserId: true, rewardPerSlot: true } });
      if (task) metadata = { ...metadata, taskId: task.id, taskTitle: task.title, taskType: task.type, advertiserId: task.advertiserId, rewardPerSlot: task.rewardPerSlot };
    }
    if (entry.referenceType === "task_proof" && entry.referenceId) {
      const proof = await tx.taskProof.findUnique({ where: { id: entry.referenceId }, select: { id: true, taskId: true, userId: true, rewardAmount: true, task: { select: { id: true, title: true, type: true, advertiserId: true } } } });
      if (proof) metadata = { ...metadata, proofId: proof.id, taskId: proof.taskId, taskTitle: proof.task?.title, taskType: proof.task?.type, workerId: proof.userId, advertiserId: proof.task?.advertiserId, rewardAmount: proof.rewardAmount };
    }
    if (entry.referenceType === "referral" && entry.referenceId) {
      const referral = await tx.referral.findUnique({ where: { referredId: entry.referenceId }, select: { referrerId: true, referredId: true } });
      if (referral) metadata = { ...metadata, referredUserId: referral.referredId, referrerId: referral.referrerId, rewardTrigger: "First VIP purchase" };
    }
    if (entry.referenceType === "challenge_reward" && entry.referenceId) {
      const challenge = await tx.referralChallenge.findUnique({ where: { id: entry.referenceId }, select: { id: true, title: true, period: true } });
      if (challenge) metadata = { ...metadata, challengeId: challenge.id, challengeTitle: challenge.title, challengePeriod: challenge.period };
    }
    if (entry.referenceType === "game_round") {
      const roundId = metadata.roundId ?? entry.referenceId;
      if (roundId) {
        const round = await tx.gameRound.findUnique({ where: { id: String(roundId) }, select: { id: true, gameType: true, lobbyId: true, roundNumber: true, resultData: true } }).catch(() => null);
        if (round) {
          let result: any = null;
          try { result = round.resultData ? JSON.parse(round.resultData) : null; } catch {}
          metadata = { ...metadata, roundId: round.id, gameType: round.gameType, ...(round.lobbyId ? { lobby: round.lobbyId } : {}), roundNumber: round.roundNumber, ...(result?.winner ? { winnerId: result.winner } : {}) };
        }
        const diceRound = await tx.diceRound.findUnique({ where: { id: String(roundId) }, select: { id: true, gameType: true, stake: true, roundNumber: true, resultData: true } }).catch(() => null);
        if (diceRound) {
          let result: any = null;
          try { result = diceRound.resultData ? JSON.parse(diceRound.resultData) : null; } catch {}
          metadata = { ...metadata, roundId: diceRound.id, gameType: diceRound.gameType, stake: diceRound.stake, stakeRoom: diceRound.stake, roundNumber: diceRound.roundNumber, ...(result?.rolls ? { rolls: result.rolls } : {}) };
        }
      }
    }
  } catch (enrichmentError) {
    console.warn("[Ledger] transaction metadata enrichment skipped:", enrichmentError);
  }

  if (entry.referenceType === "game_bet" && entry.referenceId) {
    const bet = await tx.gameBet.findUnique({ where: { id: entry.referenceId }, select: { amount: true, round: { select: { id: true, gameType: true, lobbyId: true, roundNumber: true } } } });
    if (bet) metadata = { gameType: bet.round.gameType, stake: bet.amount, stakeRoom: bet.amount, roundId: bet.round.id, roundNumber: bet.round.roundNumber, ...(bet.round.lobbyId ? { lobby: bet.round.lobbyId } : {}), ...metadata };
  }

  // PVP rows are enriched from the authoritative match record.
  let description = entry.description;
  const walletName = (value: any) => String(value ?? "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  if (entry.type === "transfer" && entry.fromWallet && entry.toWallet) description = `Wallet Transfer - ${walletName(entry.fromWallet)} Wallet → ${walletName(entry.toWallet)} Wallet`;
  if (entry.referenceType === "vip_subscription") { metadata = { ...metadata, subscriptionType: "VIP", subscriptionPlan: "Monthly", durationDays: 30, method: "Wallet", fromWallet: entry.fromWallet ?? "game" }; description = "VIP Subscription - Monthly"; }
  if (entry.referenceType === "vip_streak") { metadata = { ...metadata, rewardType: "VIP Daily Streak Reward", streakDay: metadata.day ?? null, destinationWallet: entry.toWallet ?? "game" }; description = `VIP Daily Streak Reward${metadata.streakDay ? ` - Day ${metadata.streakDay}` : ""}`; }
  if (entry.type === "referral_bonus") description = `Referral Bonus - ${metadata.rewardTrigger ?? "Referral reward"}`;
  if (entry.type === "affiliate_commission") description = `Affiliate Commission - Tier ${metadata.tier ?? ""} - ${walletName(metadata.eventType ?? "commission")}`.replace(/- $/, "");
  if (entry.type === "ambassador_commission") description = `Ambassador Reward - Tier ${metadata.tier ?? ""} - ${walletName(metadata.eventType ?? "commission")}`.replace(/- $/, "");
  if (entry.type === "task_reward") description = `Task Reward - ${metadata.taskTitle ?? "Completed Task"}`;
  if (entry.type === "challenge_reward") description = `Monthly Challenge Reward - ${walletName(metadata.level ?? "Reward")} - Rank ${metadata.rank ?? ""}`.replace(/- $/, "");
  if (entry.type === "vip_grant") description = `VIP Grant - ${metadata.durationDays ?? 0} days${metadata.reason ? ` - ${metadata.reason}` : ""}`;
  if (entry.type === "auction_bid") description = `Auction Bid${metadata.title ? ` - ${metadata.title}` : ""}${metadata.bidNumber ? ` - Bid #${metadata.bidNumber}` : ""}`;
  if (entry.type === "featured_payment") description = `Featured Placement Payment - ${metadata.title ?? "Task"}${metadata.durationDays ? ` - ${metadata.durationDays} day(s)` : ""}`;
  if (entry.type === "featured_refund") description = `Featured Placement Refund - ${metadata.taskId ?? "Task"}`;
  if (entry.type === "withdrawal") description = `Withdrawal - ${String(metadata.method ?? "").replace(/^./, c => c.toUpperCase())}`;
  if (entry.type === "deposit") description = `${String(metadata.method ?? "Deposit").replace(/^./, c => c.toUpperCase())} Deposit`;

  if (entry.referenceType === "pvp_match" && entry.referenceId) {
    const match = await tx.pvpMatch.findUnique({ where: { id: entry.referenceId }, select: { id: true, gameType: true, stake: true, player1Id: true, player2Id: true, resultData: true } });
    if (match) {
      let result: any = null;
      try { result = match.resultData ? JSON.parse(match.resultData) : null; } catch {}
      const opponentId = match.player1Id === entry.userId ? match.player2Id : match.player1Id;
      metadata = {
        gameType: match.gameType, stake: match.stake, stakeRoom: match.stake, matchId: match.id,
        ...(result?.coinFlip ? { coinFlip: result.coinFlip } : {}),
        ...(match.gameType === "pvp_coinflip" ? { selection: match.player1Id === entry.userId ? (result?.p1Side ?? "heads") : (result?.p2Side ?? "tails") } : {}),
        ...(match.gameType === "dice_clash" ? { roll: match.player1Id === entry.userId ? result?.p1Roll : result?.p2Roll } : {}),
        opponentId, ...metadata,
      };
    }
  }

  // Legacy Colour Prediction void rows were incorrectly typed as transfers.
  // Normalize them here as game_void while keeping the original database row intact.
  let ledgerType = entry.type;
  if (ledgerType === "transfer" && /colour\s+(prediction|game).*void|color\s+(prediction|game).*void/i.test(entry.description)) ledgerType = "game_void";

  await tx.transaction.create({
    data: {
      userId: entry.userId,
      type: ledgerType,
      fromWallet: entry.fromWallet ?? null,
      toWallet: entry.toWallet ?? null,
      amount: entry.amount,
      fee,
      netAmount,
      status: "completed",
      description,
      referenceId: entry.referenceId ?? null,
      referenceType: entry.referenceType ?? null,
      metadata: Object.keys(metadata).length ? JSON.stringify(metadata) : null,
    },
  });
}
