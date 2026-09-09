import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function write(path, text) { fs.writeFileSync(path, text); }
function mustReplace(path, from, to, label) {
  const s = read(path);
  if (!s.includes(from)) throw new Error(`${path}: target not found: ${label}`);
  write(path, s.replace(from, to));
}

// 1) 1v1 matches: debit the game wallet when the match is created, but DO NOT
// create a game_bet transaction. The only transaction-history rows are created
// by the authoritative settlement (win/loss/refund) after the result is known.
{
  const path = "src/modules/games/matchmaking/matchmaking.service.ts";
  let s = read(path);
  const old = 'const match = await db.$transaction(async tx => { for (const pid of [player1Id, player2Id]) { await debitWallet(tx, pid, "game", stake); await writeLedgerEntry(tx, { userId: pid, type: "game_bet", fromWallet: "game", amount: stake, description: `${gameType} match entry`, referenceType: "pvp_match", metadata: { gameType, stake } }); } return tx.pvpMatch.create({ data: { gameType, stake, player1Id, player2Id, serverSeedHash, verificationId } }); });';
  const neu = 'const match = await db.$transaction(async tx => { for (const pid of [player1Id, player2Id]) { await debitWallet(tx, pid, "game", stake); } return tx.pvpMatch.create({ data: { gameType, stake, player1Id, player2Id, serverSeedHash, verificationId } }); });';
  if (!s.includes(old)) throw new Error(`${path}: 1v1 game_bet entry target not found`);
  s = s.replace(old, neu);
  write(path, s);
}

// 2) Dice Royale / Arena: same financial rule. Joining debits the wallet but
// creates no transaction-history row; settlement writes the final result row.
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

// 3) Add a focused waiting-queue index. Matching filters gameType/stake/status,
// excludes expired entries, and takes the oldest waiting opponent. The existing
// index is kept for compatibility; this one targets the hot matchmaking path.
{
  const path = "prisma/schema.prisma";
  let s = read(path);
  const old = '  @@index([gameType, stake, status])\n  @@map("matchmaking_queues")';
  const neu = '  @@index([gameType, stake, status])\n  @@index([gameType, stake, status, createdAt])\n  @@map("matchmaking_queues")';
  if (!s.includes(old)) throw new Error(`${path}: matchmaking schema index target not found`);
  s = s.replace(old, neu);
  write(path, s);
}

console.log("Game settlement source fixes applied.");
