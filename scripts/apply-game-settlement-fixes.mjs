import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function write(path, text) { fs.writeFileSync(path, text); }

// 1) 1v1 matches: debit the game wallet when the match is created, but DO NOT
// create a game_bet transaction. Final history is written only by settlement.
{
  const path = "src/modules/games/matchmaking/matchmaking.service.ts";
  let s = read(path);
  const old = 'const match = await db.$transaction(async tx => { for (const pid of [player1Id, player2Id]) { await debitWallet(tx, pid, "game", stake); await writeLedgerEntry(tx, { userId: pid, type: "game_bet", fromWallet: "game", amount: stake, description: `${gameType} match entry`, referenceType: "pvp_match", metadata: { gameType, stake } }); } return tx.pvpMatch.create({ data: { gameType, stake, player1Id, player2Id, serverSeedHash, verificationId } }); });';
  const neu = 'const match = await db.$transaction(async tx => { for (const pid of [player1Id, player2Id]) { await debitWallet(tx, pid, "game", stake); } return tx.pvpMatch.create({ data: { gameType, stake, player1Id, player2Id, serverSeedHash, verificationId } }); });';
  if (!s.includes(old)) throw new Error(`${path}: 1v1 game_bet entry target not found`);
  s = s.replace(old, neu);
  // Keep a waiting player alive long enough for real cross-device matchmaking;
  // the frontend also renews the lease while it is actively polling.
  s = s.replace('const QUEUE_TTL_MS = 60_000;', 'const QUEUE_TTL_MS = 5 * 60_000;');
  // Return the canonical opponent avatar so Coin Flip history can show both players.
  s = s.replace('profile:{select:{username:true}}', 'profile:{select:{username:true,avatarUrl:true}}');
  s = s.replace('opponent:{username:opponent.profile?.username??"Player",userId:opponent.id}', 'opponent:{username:opponent.profile?.username??"Player",userId:opponent.id,avatar:opponent.profile?.avatarUrl??null}');
  write(path, s);
}

// 2) Dice Royale / Arena: joining debits the wallet but does not create a
// transaction-history row. Settlement writes the final result transaction.
for (const path of [
  "src/modules/games/diceRoyale/diceRoyale.service.ts",
  "src/modules/games/diceArena/diceArena.service.ts",
]) {
  let s = read(path);
  const patterns = [
    /\n\s*await writeLedgerEntry\(tx, \{ userId, type: "game_bet", fromWallet: "game", amount: stake,\n\s*description: `Dice royale entry — stake \$\{stake\}`, referenceType: "game_round",\n\s*metadata: \{ roundId: state\.roundId, stake \} \}\);/,
    /\n\s*await writeLedgerEntry\(tx, \{ userId, type: "game_bet", fromWallet: "game", amount: stake,\n\s*description: `Dice arena entry — stake \$\{stake\}`, referenceType: "game_round",\n\s*metadata: \{ roundId: state\.roundId, stake \} \}\);/,
  ];
  let changed = false;
  for (const re of patterns) {
    const next = s.replace(re, "");
    if (next !== s) { s = next; changed = true; break; }
  }
  if (!changed) throw new Error(`${path}: dice game_bet entry target not found`);
  write(path, s);
}

// 3) Focused waiting-queue index for gameType + stake + status + creation order.
{
  const path = "prisma/schema.prisma";
  let s = read(path);
  const old = '  @@index([gameType, stake, status])\n  @@map("matchmaking_queues")';
  const neu = '  @@index([gameType, stake, status])\n  @@index([gameType, stake, status, createdAt])\n  @@map("matchmaking_queues")';
  if (!s.includes(old)) throw new Error(`${path}: matchmaking schema index target not found`);
  s = s.replace(old, neu);
  write(path, s);
}

// 4) Spin Battle snapshot exposes the same authoritative fee rate used by
// settlement, allowing the frontend to show exact decimal potential payouts.
{
  const path = "src/modules/games/spinBattle/spinBattle.service.ts";
  let s = read(path);
  const old = '  const totalPool = liveBets.reduce((sum, b) => sum + Number(b.amount), 0);\n  const myBet = userId ? liveBets.find(b => b.userId === userId) : undefined;';
  const neu = '  const totalPool = liveBets.reduce((sum, b) => sum + Number(b.amount), 0);\n  const feeRate = await getGameFeeRate("spin_battle");\n  const myBet = userId ? liveBets.find(b => b.userId === userId) : undefined;';
  if (!s.includes(old)) throw new Error(`${path}: snapshot payout target not found`);
  s = s.replace(old, neu);
  const retOld = '    totalPool, timeRemaining: remaining, winnerId:';
  const retNew = '    totalPool, feeRate, timeRemaining: remaining, winnerId:';
  if (!s.includes(retOld)) throw new Error(`${path}: snapshot return target not found`);
  s = s.replace(retOld, retNew);
  write(path, s);
}

console.log("Game settlement source fixes applied.");
