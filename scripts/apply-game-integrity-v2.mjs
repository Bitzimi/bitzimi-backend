import fs from "node:fs";

const path = "src/modules/games/matchmaking/matchmaking.service.ts";
let s = fs.readFileSync(path, "utf8");

const between = (source, startMarker, endMarker, replacement) => {
  const a = source.indexOf(startMarker);
  const b = source.indexOf(endMarker, a + startMarker.length);
  if (a < 0 || b < 0) throw new Error(`Cannot replace block: ${startMarker}`);
  return source.slice(0, a) + replacement + source.slice(b);
};

const joinQueue = [
  "export async function joinQueue(userId: string, gameType: MatchGameType, stake: number) {",
  "  const activeMatch = await db.pvpMatch.findFirst({ where: { gameType, status: \"active\", OR: [{ player1Id: userId }, { player2Id: userId }] } });",
  "  if (activeMatch) { const entry = await db.matchmakingQueue.findFirst({ where: { userId, gameType, matchId: activeMatch.id } }); return { status: \"matched\" as const, queueId: entry?.id ?? \"\", matchId: activeMatch.id }; }",
  "  const now = new Date();",
  "  const [enabled, maintenance, configuredStakes] = await Promise.all([getConfigValue<boolean>(\"game.\" + gameType + \".enabled\", true), getConfigValue<boolean>(\"game.\" + gameType + \".maintenance\", false), getConfigValue<number[]>(\"game.\" + gameType + \".stakes\", [])]);",
  "  if (!enabled) throw Object.assign(new Error(gameType + \" is currently unavailable\"), { statusCode: 503, code: \"GAME_DISABLED\" });",
  "  if (maintenance) throw Object.assign(new Error(gameType + \" is under maintenance\"), { statusCode: 503, code: \"GAME_MAINTENANCE\" });",
  "  if (configuredStakes.length && !configuredStakes.includes(stake)) throw Object.assign(new Error(\"Stake $\" + stake + \" is not available for this game\"), { statusCode: 400, code: \"INVALID_STAKE\" });",
  "  const existing = await db.matchmakingQueue.findFirst({ where: { userId, gameType, stake, status: { in: [\"reserved\", \"waiting\"] }, expiresAt: { gt: now } } });",
  "  if (existing) {",
  "    if (existing.status === \"reserved\") return { status: \"waiting\" as const, queueId: existing.id };",
  "    await db.$transaction(async tx => { await debitWallet(tx, userId, \"game\", stake); const claimed = await tx.matchmakingQueue.updateMany({ where: { id: existing.id, status: \"waiting\" }, data: { status: \"reserved\", expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } }); if (!claimed.count) throw Object.assign(new Error(\"Queue state changed; please search again\"), { statusCode: 409, code: \"QUEUE_STATE_CHANGED\" }); });",
  "    return { status: \"waiting\" as const, queueId: existing.id };",
  "  }",
  "  const opponent = await db.matchmakingQueue.findFirst({ where: { gameType, stake, status: \"reserved\", userId: { not: userId }, expiresAt: { gt: now } }, orderBy: { createdAt: \"asc\" } });",
  "  if (!opponent) { const entry = await db.$transaction(async tx => { await debitWallet(tx, userId, \"game\", stake); return tx.matchmakingQueue.create({ data: { userId, gameType, stake, status: \"reserved\", expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } }); }); return { status: \"waiting\" as const, queueId: entry.id }; }",
  "  try {",
  "    await db.$transaction(async tx => { await debitWallet(tx, userId, \"game\", stake); const claimed = await tx.matchmakingQueue.updateMany({ where: { id: opponent.id, status: \"reserved\", expiresAt: { gt: now } }, data: { status: \"matched\" } }); if (!claimed.count) throw Object.assign(new Error(\"Opponent is no longer available\"), { statusCode: 409, code: \"OPPONENT_UNAVAILABLE\" }); });",
  "    const match = await createMatchForPlayers(userId, opponent.userId, gameType, stake, true);",
  "    await db.matchmakingQueue.update({ where: { id: opponent.id }, data: { matchId: match.id } });",
  "    const mine = await db.matchmakingQueue.create({ data: { userId, gameType, stake, status: \"matched\", matchId: match.id, expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } });",
  "    setImmediate(() => { activateReferral(userId).catch(() => {}); activateReferral(opponent.userId).catch(() => {}); });",
  "    return { status: \"matched\" as const, queueId: mine.id, matchId: match.id };",
  "  } catch (err) {",
  "    await db.$transaction(async tx => { await creditWallet(tx, userId, \"game\", stake); await creditWallet(tx, opponent.userId, \"game\", stake); await tx.matchmakingQueue.updateMany({ where: { id: opponent.id, status: \"matched\", matchId: null }, data: { status: \"reserved\", expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } }); }).catch(() => {});",
  "    throw err;",
  "  }",
  "}",
  ""
].join("\n");
s = between(s, "export async function joinQueue", "export async function getQueueStatus", joinQueue);

const cleanup = [
  "export function startQueueCleanup(): void {",
  "  setInterval(() => {",
  "    (async () => {",
  "      const expired = await db.matchmakingQueue.findMany({ where: { status: { in: [\"waiting\", \"reserved\"] }, expiresAt: { lt: new Date() } }, take: 100 });",
  "      for (const entry of expired) {",
  "        if (entry.status === \"reserved\") await db.$transaction(async tx => { const claimed = await tx.matchmakingQueue.updateMany({ where: { id: entry.id, status: \"reserved\" }, data: { status: \"cancelled\" } }); if (claimed.count) await creditWallet(tx, entry.userId, \"game\", entry.stake); }).catch(() => {});",
  "        else await db.matchmakingQueue.updateMany({ where: { id: entry.id, status: \"waiting\" }, data: { status: \"cancelled\" } }).catch(() => {});",
  "      }",
  "      await recoverUnresolvedImmediateMatches(); await processReactionTapTimeouts();",
  "    })().catch(() => {});",
  "  }, 1000);",
  "}",
  ""
].join("\n");
s = between(s, "export function startQueueCleanup", "export async function joinQueue", cleanup);

const queueStatus = [
  "export async function getQueueStatus(userId: string, queueId: string) {",
  "  const entry = await db.matchmakingQueue.findFirst({ where: { id: queueId, userId } });",
  "  if (!entry) throw Object.assign(new Error(\"Queue entry not found\"), { statusCode: 404, code: \"NOT_FOUND\" });",
  "  if (entry.status === \"matched\" && entry.matchId) return { status: \"matched\" as const, matchId: entry.matchId };",
  "  if (entry.status === \"cancelled\" || new Date() > entry.expiresAt) {",
  "    if (entry.status === \"reserved\") await db.$transaction(async tx => { const claimed = await tx.matchmakingQueue.updateMany({ where: { id: queueId, userId, status: \"reserved\" }, data: { status: \"cancelled\" } }); if (claimed.count) await creditWallet(tx, userId, \"game\", entry.stake); });",
  "    else if (entry.status === \"waiting\") await db.matchmakingQueue.updateMany({ where: { id: queueId, userId, status: \"waiting\" }, data: { status: \"cancelled\" } });",
  "    return { status: \"cancelled\" as const };",
  "  }",
  "  return { status: \"waiting\" as const };",
  "}",
  "export async function leaveQueue(userId: string, queueId: string) { await db.$transaction(async tx => { const entry = await tx.matchmakingQueue.findFirst({ where: { id: queueId, userId } }); if (!entry) return; if (entry.status === \"reserved\") { const claimed = await tx.matchmakingQueue.updateMany({ where: { id: queueId, userId, status: \"reserved\" }, data: { status: \"cancelled\" } }); if (claimed.count) await creditWallet(tx, userId, \"game\", entry.stake); } else if (entry.status === \"waiting\") await tx.matchmakingQueue.updateMany({ where: { id: queueId, userId, status: \"waiting\" }, data: { status: \"cancelled\" } }); }); }",
  ""
].join("\n");
s = between(s, "export async function getQueueStatus", "async function createGameNotification", queueStatus + "async function createGameNotification");

const createMatch = [
  "export async function createMatchForPlayers(player1Id: string, player2Id: string, gameType: MatchGameType, stake: number, stakesAlreadyDebited = false) {",
  "  const totalPool = stake * 2; const feeRate = await getGameFeeRate(gameType); const fee = totalPool * feeRate; const serverSeed = generateServerSeed(); const serverSeedHash = hashServerSeed(serverSeed); const verificationId = gameType === \"reaction_tap\" ? undefined : generateVerificationId(gameType);",
  "  const match = await db.$transaction(async tx => {",
  "    if (!stakesAlreadyDebited) { for (const pid of [player1Id, player2Id]) { await debitWallet(tx, pid, \"game\", stake); } }",
  "    return tx.pvpMatch.create({ data: { gameType, stake, player1Id, player2Id, serverSeedHash, verificationId } });",
  "  });",
  "  try { if (gameType === \"dice_clash\") await resolveDiceClash(match.id, player1Id, player2Id, stake, fee, totalPool, serverSeed, feeRate); else if (gameType === \"pvp_coinflip\") await resolveCoinFlip(match.id, player1Id, player2Id, stake, fee, totalPool, serverSeed, feeRate); } catch (err) { console.error(`[Matchmaking] Immediate settlement deferred for ${match.id}:`, err); }",
  "  return db.pvpMatch.findUniqueOrThrow({ where: { id: match.id } });",
  "}",
  ""
].join("\n");
s = between(s, "export async function createMatchForPlayers", "async function resolveDiceClash", createMatch);

fs.writeFileSync(path, s);
console.log("Applied public matchmaking reservation and settlement integrity fixes.");
