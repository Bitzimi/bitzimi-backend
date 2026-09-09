import fs from "node:fs";
const path = "src/modules/games/matchmaking/matchmaking.service.ts";
let s = fs.readFileSync(path, "utf8");
const a = s.indexOf("export async function createMatchForPlayers");
const b = s.indexOf("async function resolveDiceClash", a);
if (a < 0 || b < 0) throw new Error("createMatch repair markers not found");
const block = `export async function createMatchForPlayers(player1Id: string, player2Id: string, gameType: MatchGameType, stake: number) {
  const totalPool = stake * 2; const feeRate = await getGameFeeRate(gameType); const fee = totalPool * feeRate; const serverSeed = generateServerSeed(); const serverSeedHash = hashServerSeed(serverSeed); const verificationId = gameType === "reaction_tap" ? undefined : generateVerificationId(gameType);
  const match = await db.$transaction(async tx => { for (const pid of [player1Id, player2Id]) { await debitWallet(tx, pid, "game", stake); } return tx.pvpMatch.create({ data: { gameType, stake, player1Id, player2Id, serverSeedHash, verificationId } }); });
  try { if (gameType === "dice_clash") await resolveDiceClash(match.id, player1Id, player2Id, stake, fee, totalPool, serverSeed, feeRate); else if (gameType === "pvp_coinflip") await resolveCoinFlip(match.id, player1Id, player2Id, stake, fee, totalPool, serverSeed, feeRate); } catch (err) { console.error(\`[Matchmaking] Immediate settlement deferred for \${match.id}:\`, err); }
  return db.pvpMatch.findUniqueOrThrow({ where: { id: match.id } });
}

export async function createReservedMatchForPlayers(player1Id: string, player2Id: string, gameType: MatchGameType, stake: number) {
  const totalPool = stake * 2; const feeRate = await getGameFeeRate(gameType); const fee = totalPool * feeRate; const serverSeed = generateServerSeed(); const serverSeedHash = hashServerSeed(serverSeed); const verificationId = gameType === "reaction_tap" ? undefined : generateVerificationId(gameType);
  const match = await db.pvpMatch.create({ data: { gameType, stake, player1Id, player2Id, serverSeedHash, verificationId } });
  try { if (gameType === "dice_clash") await resolveDiceClash(match.id, player1Id, player2Id, stake, fee, totalPool, serverSeed, feeRate); else if (gameType === "pvp_coinflip") await resolveCoinFlip(match.id, player1Id, player2Id, stake, fee, totalPool, serverSeed, feeRate); } catch (err) { console.error(\`[Matchmaking] Immediate settlement deferred for \${match.id}:\`, err); }
  return db.pvpMatch.findUniqueOrThrow({ where: { id: match.id } });
}

`;
s = s.slice(0, a) + block + s.slice(b);
s = s.replace('createMatchForPlayers(userId, opponent.userId, gameType, stake, true)', 'createReservedMatchForPlayers(userId, opponent.userId, gameType, stake)');
fs.writeFileSync(path, s);
console.log("Repaired reserved-match implementation.");
