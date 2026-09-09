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
