import fs from "node:fs";

const matchmakingPath = "src/modules/games/matchmaking/matchmaking.service.ts";
const walletsPath = "src/modules/wallets/wallets.service.ts";

let wallets = fs.readFileSync(walletsPath, "utf8");
if (!wallets.includes('if (entry.type === "game_bet") return;')) {
  const marker = "  const fee = entry.fee ?? 0;\n";
  if (!wallets.includes(marker)) throw new Error("wallets.service.ts ledger marker not found");
  wallets = wallets.replace(marker, '  if (entry.type === "game_bet") return;\n' + marker);
  fs.writeFileSync(walletsPath, wallets);
}

let s = fs.readFileSync(matchmakingPath, "utf8");

const joinQueue = [
  "export async function joinQueue(userId: string, gameType: MatchGameType, stake: number) {",
  "  const activeMatch = await db.pvpMatch.findFirst({ where: { gameType, status: \"active\", OR: [{ player1Id: userId }, { player2Id: userId }] } });",
  "  if (activeMatch) {",
  "    const entry = await db.matchmakingQueue.findFirst({ where: { userId, gameType, matchId: activeMatch.id } });",
  "    return { status: \"matched\" as const, queueId: entry?.id ?? \"\", matchId: activeMatch.id };",
  "  }",
  "  const now = new Date();",
  "  const [enabled, maintenance, configuredStakes] = await Promise.all([",
  "    getConfigValue<boolean>(`game.${gameType}.enabled`, true),",
  "    getConfigValue<boolean>(`game.${gameType}.maintenance`, false),",
  "    getConfigValue<number[]>(`game.${gameType}.stakes`, []),",
  "  ]);",
  "  if (!enabled) throw Object.assign(new Error(`${gameType} is currently unavailable`), { statusCode: 503, code: \"GAME_DISABLED\" });",
  "  if (maintenance) throw Object.assign(new Error(`${gameType} is under maintenance`), { statusCode: 503, code: \"GAME_MAINTENANCE\" });",
  "  if (configuredStakes.length && !configuredStakes.includes(stake)) throw Object.assign(new Error(`Stake $${stake} is not available for this game`), { statusCode: 400, code: \"INVALID_STAKE\" });",
  "  const existing = await db.matchmakingQueue.findFirst({ where: { userId, gameType, stake, status: { in: [\"reserved\", \"waiting\"] }, expiresAt: { gt: now } } });",
  "  if (existing) {",
  "    if (existing.status === \"reserved\") return { status: \"waiting\" as const, queueId: existing.id };",
  "    await db.$transaction(async tx => {",
  "      await debitWallet(tx, userId, \"game\", stake);",
  "      const claimed = await tx.matchmakingQueue.updateMany({ where: { id: existing.id, status: \"waiting\" }, data: { status: \"reserved\", expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } });",
  "      if (!claimed.count) throw Object.assign(new Error(\"Queue state changed; please search again\"), { statusCode: 409, code: \"QUEUE_STATE_CHANGED\" });",
  "    });",
  "    return { status: \"waiting\" as const, queueId: existing.id };",
  "  }",
  "  const opponent = await db.matchmakingQueue.findFirst({ where: { gameType, stake, status: \"reserved\", userId: { not: userId }, expiresAt: { gt: now } }, orderBy: { createdAt: \"asc\" } });",
  "  if (!opponent) {",
  "    const entry = await db.$transaction(async tx => {",
  "      await debitWallet(tx, userId, \"game\", stake);",
  "      return tx.matchmakingQueue.create({ data: { userId, gameType, stake, status: \"reserved\", expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } });",
  "    });",
  "    return { status: \"waiting\" as const, queueId: entry.id };",
  "  }",
  "  try {",
  "    await db.$transaction(async tx => {",
  "      await debitWallet(tx, userId, \"game\", stake);",
  "      const claimed = await tx.matchmakingQueue.updateMany({ where: { id: opponent.id, status: \"reserved\", expiresAt: { gt: now } }, data: { status: \"matched\" } });",
  "      if (!claimed.count) throw Object.assign(new Error(\"Opponent is no longer available\"), { statusCode: 409, code: \"OPPONENT_UNAVAILABLE\" });",
  "    });",
  "    const match = await createMatchForPlayers(userId, opponent.userId, gameType, stake, true);",
  "    await db.matchmakingQueue.update({ where: { id: opponent.id }, data: { matchId: match.id } });",
  "    const myQueue = await db.matchmakingQueue.create({ data: { userId, gameType, stake, status: \"matched\", matchId: match.id, expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } });",
  "    setImmediate(() => { activateReferral(userId).catch(() => {}); activateReferral(opponent.userId).catch(() => {}); });",
  "    return { status: \"matched\" as const, queueId: myQueue.id, matchId: match.id };",
  "  } catch (err) {",
  "    await db.$transaction(async tx => {",
  "      await creditWallet(tx, userId, \"game\", stake);",
  "      await creditWallet(tx, opponent.userId, \"game\", stake);",
  "      await tx.matchmakingQueue.updateMany({ where: { id: opponent.id, status: \"matched\", matchId: null }, data: { status: \"reserved\", expiresAt: new Date(Date.now() + QUEUE_TTL_MS) } });",
  "    }).catch(() => {});",
  "    throw err;",
  "  }",
  "}",
  ""
].join("\n");

s = s.replace(/export async function joinQueue[\\s\\S]*?export async function getQueueStatus/, joinQueue + "export async function getQueueStatus");

const cleanup = [
  "export function startQueueCleanup(): void {",
  "  setInterval(() => {",
  "    (async () => {",
  "      const expired = await db.matchmakingQueue.findMany({ where: { status: { in: [\"waiting\", \"reserved\"] }, expiresAt: { lt: new Date() } }, take: 100 });",
  "      for (const entry of expired) {",
  "        if (entry.status === \"reserved\") {",
  "          await db.$transaction(async tx => {",
  "            const claimed = await tx.matchmakingQueue.updateMany({ where: { id: entry.id, status: \"reserved\" }, data: { status: \"cancelled\" } });",
  "            if (claimed.count) await creditWallet(tx, entry.userId, \"game\", entry.stake);",
  "          }).catch(() => {});",
  "        } else await db.matchmakingQueue.updateMany({ where: { id: entry.id, status: \"waiting\" }, data: { status: \"cancelled\" } }).catch(() => {});",
  "      }",
  "      await recoverUnresolvedImmediateMatches();",
  "      await processReactionTapTimeouts();",
  "    })().catch(() => {});",
  "  }, 1000);",
  "}",
  ""
].join("\n");
s = s.replace(/export function startQueueCleanup[\\s\\S]*?export async function joinQueue/, cleanup + "export async function joinQueue");

const statusBlock = [
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
  "",
  "export async function leaveQueue(userId: string, queueId: string) {",
  "  await db.$transaction(async tx => {",
  "    const entry = await tx.matchmakingQueue.findFirst({ where: { id: queueId, userId } });",
  "    if (!entry) return;",
  "    if (entry.status === \"reserved\") { const claimed = await tx.matchmakingQueue.updateMany({ where: { id: queueId, userId, status: \"reserved\" }, data: { status: \"cancelled\" } }); if (claimed.count) await creditWallet(tx, userId, \"game\", entry.stake); }",
  "    else if (entry.status === \"waiting\") await tx.matchmakingQueue.updateMany({ where: { id: queueId, userId, status: \"waiting\" }, data: { status: \"cancelled\" } });",
  "  });",
  "}",
  ""
].join("\n");
s = s.replace(/export async function getQueueStatus[\\s\\S]*?async function createGameNotification/, statusBlock + "async function createGameNotification");

s = s.replace(
  "export async function createMatchForPlayers(player1Id: string, player2Id: string, gameType: MatchGameType, stake: number) {",
  "export async function createMatchForPlayers(player1Id: string, player2Id: string, gameType: MatchGameType, stake: number, stakesAlreadyDebited = false) {"
);
s = s.replace(
  /const match = await db\\.\\$transaction\\(async tx => \\{ for \\(const pid of \\[player1Id, player2Id\\]\\) \\{ await debitWallet\\(tx, pid, "game", stake\\); await writeLedgerEntry\\(tx, \\{ userId: pid, type: "game_bet"[\\s\\S]*?return tx\\.pvpMatch\\.create\\(/,
  "const match = await db.$transaction(async tx => { if (!stakesAlreadyDebited) { for (const pid of [player1Id, player2Id]) { await debitWallet(tx, pid, \"game\", stake); await writeLedgerEntry(tx, { userId: pid, type: \"game_bet\", fromWallet: \"game\", amount: stake, description: `${gameType} match entry`, referenceType: \"pvp_match\", metadata: { gameType, stake } }); } } return tx.pvpMatch.create("
);

fs.writeFileSync(matchmakingPath, s);
console.log("Game integrity normalization applied.");
