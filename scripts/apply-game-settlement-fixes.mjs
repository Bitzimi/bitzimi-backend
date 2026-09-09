import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function write(path, text) { fs.writeFileSync(path, text); }

{
  const path = "src/modules/games/matchmaking/matchmaking.service.ts";
  let s = read(path);
  const oldBet = 'const match = await db.$transaction(async tx => { for (const pid of [player1Id, player2Id]) { await debitWallet(tx, pid, "game", stake); await writeLedgerEntry(tx, { userId: pid, type: "game_bet", fromWallet: "game", amount: stake, description: `${gameType} match entry`, referenceType: "pvp_match", metadata: { gameType, stake } }); } return tx.pvpMatch.create({ data: { gameType, stake, player1Id, player2Id, serverSeedHash, verificationId } }); });';
  const newBet = 'const match = await db.$transaction(async tx => { for (const pid of [player1Id, player2Id]) { await debitWallet(tx, pid, "game", stake); } return tx.pvpMatch.create({ data: { gameType, stake, player1Id, player2Id, serverSeedHash, verificationId } }); });';
  if (s.includes(oldBet)) s = s.replace(oldBet, newBet);
  s = s.replace('const QUEUE_TTL_MS = 60_000;', 'const QUEUE_TTL_MS = 5 * 60_000;');
  const profilePair = 'player1:{include:{profile:{select:{username:true}}}},player2:{include:{profile:{select:{username:true}}}}';
  const profilePairWithAvatar = 'player1:{include:{profile:{select:{username:true,avatarUrl:true}}}},player2:{include:{profile:{select:{username:true,avatarUrl:true}}}}';
  if (s.includes(profilePair)) s = s.replace(profilePair, profilePairWithAvatar);
  s = s.replace('opponent:{username:opponent.profile?.username??"Player",userId:opponent.id}', 'opponent:{username:opponent.profile?.username??"Player",userId:opponent.id,avatar:opponent.profile?.avatarUrl??null}');

  // Coin Flip matchmaking is a paid, persistent action. Joining the same queue again
  // after a reload must be idempotent and must never debit the wallet twice.
  const recoveryAnchor = '  const activeMatch = await db.pvpMatch.findFirst({ where: { gameType, status: "active", OR: [{ player1Id: userId }, { player2Id: userId }] } });\n  if (activeMatch) { const entry = await db.matchmakingQueue.findFirst({ where: { userId, gameType, matchId: activeMatch.id } }); return { status: "matched" as const, queueId: entry?.id ?? "", matchId: activeMatch.id }; }\n  const now = new Date();';
  const recoveryReplacement = '  const now = new Date();\n  const existingMatched = await db.matchmakingQueue.findFirst({ where: { userId, gameType, status: "matched", matchId: { not: null }, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } });\n  if (existingMatched?.matchId) return { status: "matched" as const, queueId: existingMatched.id, matchId: existingMatched.matchId };\n  const activeMatch = await db.pvpMatch.findFirst({ where: { gameType, status: "active", OR: [{ player1Id: userId }, { player2Id: userId }] } });\n  if (activeMatch) { const entry = await db.matchmakingQueue.findFirst({ where: { userId, gameType, matchId: activeMatch.id } }); return { status: "matched" as const, queueId: entry?.id ?? "", matchId: activeMatch.id }; }';
  if (s.includes(recoveryAnchor)) s = s.replace(recoveryAnchor, recoveryReplacement, 1);

  const existingAnchor = '  const existing = await db.matchmakingQueue.findFirst({ where: { userId, gameType, stake, status: { in: ["reserved", "waiting"] }, expiresAt: { gt: now } } });\n  if (existing) {\n    if (existing.status === "reserved") return { status: "waiting" as const, queueId: existing.id };\n    await db.$transaction(async tx => { await debitWallet(tx, userId, "game", stake); const claimed = await tx.matchmakingQueue.updateMany({ where: { id: existing.id, status: "waiting" }, data: { status: "reserved", expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } }); if (!claimed.count) throw Object.assign(new Error("Queue state changed; please search again"), { statusCode: 409, code: "QUEUE_STATE_CHANGED" }); });\n    return { status: "waiting" as const, queueId: existing.id };\n  }';
  const existingReplacement = '  const existing = await db.matchmakingQueue.findFirst({ where: { userId, gameType, status: { in: ["reserved", "waiting"] }, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } });\n  if (existing) {\n    if (Number(existing.stake) !== Number(stake)) throw Object.assign(new Error(`You already have an active $${existing.stake} matchmaking search. Resume or cancel it before selecting another stake.`), { statusCode: 409, code: "ACTIVE_QUEUE_EXISTS" });\n    return { status: "waiting" as const, queueId: existing.id };\n  }';
  if (s.includes(existingAnchor)) s = s.replace(existingAnchor, existingReplacement, 1);
  write(path, s);
}

for (const path of ["src/modules/games/diceRoyale/diceRoyale.service.ts", "src/modules/games/diceArena/diceArena.service.ts"]) {
  let s = read(path);
  s = s.replace(/\n\s*await writeLedgerEntry\(tx, \{ userId, type: "game_bet", fromWallet: "game", amount: stake,\n\s*description: `Dice royale entry — stake \$\{stake\}`, referenceType: "game_round",\n\s*metadata: \{ roundId: state\.roundId, stake \} \}\);/, "");
  s = s.replace(/\n\s*await writeLedgerEntry\(tx, \{ userId, type: "game_bet", fromWallet: "game", amount: stake,\n\s*description: `Dice arena entry — stake \$\{stake\}`, referenceType: "game_round",\n\s*metadata: \{ roundId: state\.roundId, stake \} \}\);/, "");
  write(path, s);
}

{
  const path = "prisma/schema.prisma";
  let s = read(path);
  const old = '  @@index([gameType, stake, status])\n  @@map("matchmaking_queues")';
  const neu = '  @@index([gameType, stake, status])\n  @@index([gameType, stake, status, createdAt])\n  @@map("matchmaking_queues")';
  if (s.includes(old)) s = s.replace(old, neu);
  write(path, s);
}

{
  const path = "src/modules/games/spinBattle/spinBattle.service.ts";
  let s = read(path);
  const old = '  const totalPool = liveBets.reduce((sum, b) => sum + Number(b.amount), 0);\n  const myBet = userId ? liveBets.find(b => b.userId === userId) : undefined;';
  const neu = '  const totalPool = liveBets.reduce((sum, b) => sum + Number(b.amount), 0);\n  const feeRate = await getGameFeeRate("spin_battle");\n  const myBet = userId ? liveBets.find(b => b.userId === userId) : undefined;';
  if (s.includes(old)) s = s.replace(old, neu);
  const retOld = '    totalPool, timeRemaining: remaining, winnerId:';
  const retNew = '    totalPool, feeRate, timeRemaining: remaining, winnerId:';
  if (s.includes(retOld)) s = s.replace(retOld, retNew);
  write(path, s);
}

console.log("Game settlement source fixes applied.");
