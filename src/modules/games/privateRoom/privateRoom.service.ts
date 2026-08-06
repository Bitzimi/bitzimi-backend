/**
 * Private Room — shared by Coin Flip, Dice Clash, Reaction Tap.
 *
 * Room lifecycle: waiting → ready → active → rematch → active → ... → completed|cancelled
 *
 * Reuses createMatchForPlayers() from matchmaking.service.ts — no logic duplication.
 */
import { db } from "../../../db";
import { createMatchForPlayers, MatchGameType } from "../matchmaking/matchmaking.service";
import { getConfigValue } from "../../admin/config/admin.config.service";
import { activateReferral } from "../../referrals/referrals.service";

const ROOM_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Code generation ────────────────────────────────────────────────────────────
function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1 to avoid confusion
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function generateUniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode();
    const exists = await db.privateRoom.findUnique({ where: { code } });
    if (!exists) return code;
  }
  throw Object.assign(new Error("Failed to generate unique room code"), { statusCode: 500, code: "CODE_COLLISION" });
}

// ── Shared room serialiser (safe for API responses) ───────────────────────────
async function withProfiles(room: any) {
  return db.privateRoom.findUnique({
    where: { id: room.id },
    include: {
      host:  { include: { profile: { select: { username: true, avatarUrl: true } } } },
      guest: { include: { profile: { select: { username: true, avatarUrl: true } } } },
    },
  });
}

// ── Create a new private room ──────────────────────────────────────────────────
export async function createRoom(hostId: string, gameType: string, stake: number) {
  const validTypes: MatchGameType[] = ["dice_clash", "pvp_coinflip", "reaction_tap"];
  if (!validTypes.includes(gameType as MatchGameType)) {
    throw Object.assign(new Error("Invalid game type"), { statusCode: 400, code: "INVALID_GAME_TYPE" });
  }

  const [gameEnabled, gameMaintenance, configuredStakes] = await Promise.all([
    getConfigValue<boolean>(`game.${gameType}.enabled`, true),
    getConfigValue<boolean>(`game.${gameType}.maintenance`, false),
    getConfigValue<number[]>(`game.${gameType}.stakes`, []),
  ]);
  if (!gameEnabled)    throw Object.assign(new Error(`${gameType} is currently unavailable`), { statusCode: 503, code: "GAME_DISABLED" });
  if (gameMaintenance) throw Object.assign(new Error(`${gameType} is under maintenance`),    { statusCode: 503, code: "GAME_MAINTENANCE" });
  if (configuredStakes.length > 0 && !configuredStakes.includes(stake))
    throw Object.assign(new Error(`Stake $${stake} is not available for this game`), { statusCode: 400, code: "INVALID_STAKE" });

  // Cancel any prior waiting rooms by this host (at most one active room per host)
  await db.privateRoom.updateMany({
    where: { hostId, status: "waiting" },
    data:  { status: "cancelled" },
  });

  const code = await generateUniqueCode();
  const room = await db.privateRoom.create({
    data: {
      code, gameType, stake, hostId,
      status: "waiting",
      expiresAt: new Date(Date.now() + ROOM_TTL_MS),
    },
  });
  return withProfiles(room);
}

// ── Get room by code ──────────────────────────────────────────────────────────
export async function getRoom(code: string, requesterId: string) {
  const room = await db.privateRoom.findUnique({
    where: { code },
    include: {
      host:  { include: { profile: { select: { username: true, avatarUrl: true } } } },
      guest: { include: { profile: { select: { username: true, avatarUrl: true } } } },
    },
  });
  if (!room) throw Object.assign(new Error("Room not found"), { statusCode: 404, code: "NOT_FOUND" });

  const isParticipant = room.hostId === requesterId || room.guestId === requesterId;
  // Allow anyone to read a waiting room (they need to validate it before joining)
  if (!isParticipant && room.status !== "waiting") {
    throw Object.assign(new Error("Access denied"), { statusCode: 403, code: "FORBIDDEN" });
  }
  if (new Date() > room.expiresAt && room.status === "waiting") {
    throw Object.assign(new Error("Room has expired"), { statusCode: 410, code: "EXPIRED" });
  }
  return room;
}

// ── Join a room as guest ───────────────────────────────────────────────────────
export async function joinRoom(code: string, guestId: string) {
  const room = await db.privateRoom.findUnique({ where: { code } });
  if (!room)                       throw Object.assign(new Error("Room not found"),                   { statusCode: 404, code: "NOT_FOUND" });
  if (room.status !== "waiting")   throw Object.assign(new Error("Room is no longer accepting players"), { statusCode: 409, code: "ROOM_NOT_WAITING" });
  if (room.hostId === guestId)     throw Object.assign(new Error("Cannot join your own room"),        { statusCode: 400, code: "SELF_JOIN" });
  if (new Date() > room.expiresAt) throw Object.assign(new Error("Room has expired"),                 { statusCode: 410, code: "EXPIRED" });

  const updated = await db.privateRoom.update({
    where: { code },
    data:  { guestId, status: "ready" },
  });
  return withProfiles(updated);
}

// ── Start the match (either player triggers after room is "ready") ─────────────
export async function startMatch(code: string, userId: string) {
  const room = await db.privateRoom.findUnique({ where: { code } });
  if (!room) throw Object.assign(new Error("Room not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (room.status !== "ready") throw Object.assign(new Error("Room is not ready to start"), { statusCode: 409, code: "ROOM_NOT_READY" });
  if (room.hostId !== userId && room.guestId !== userId)
    throw Object.assign(new Error("Access denied"), { statusCode: 403, code: "FORBIDDEN" });
  if (!room.guestId) throw Object.assign(new Error("Waiting for opponent to join"), { statusCode: 409, code: "NO_GUEST" });

  const match = await createMatchForPlayers(room.hostId, room.guestId, room.gameType as MatchGameType, room.stake);

  const updated = await db.privateRoom.update({
    where: { code },
    data:  { status: "active", currentMatchId: match.id },
  });

  setImmediate(() => activateReferral(room.hostId).catch(() => {}));
  setImmediate(() => activateReferral(room.guestId!).catch(() => {}));

  return { matchId: match.id, room: await withProfiles(updated) };
}

// ── Signal rematch readiness ───────────────────────────────────────────────────
export async function signalRematch(code: string, userId: string) {
  const room = await db.privateRoom.findUnique({ where: { code } });
  if (!room) throw Object.assign(new Error("Room not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (room.hostId !== userId && room.guestId !== userId)
    throw Object.assign(new Error("Access denied"), { statusCode: 403, code: "FORBIDDEN" });
  if (!["active", "rematch"].includes(room.status))
    throw Object.assign(new Error("Cannot request rematch at this stage"), { statusCode: 409, code: "INVALID_STATE" });

  const isHost = room.hostId === userId;
  const updateData = isHost
    ? { status: "rematch", rematchHostReady: true }
    : { status: "rematch", rematchGuestReady: true };

  const updated = await db.privateRoom.update({ where: { code }, data: updateData });

  // Both ready → start a new match immediately
  if (updated.rematchHostReady && updated.rematchGuestReady) {
    const match = await createMatchForPlayers(room.hostId, room.guestId!, room.gameType as MatchGameType, room.stake);
    const final = await db.privateRoom.update({
      where: { code },
      data: {
        status: "active",
        currentMatchId: match.id,
        rematchHostReady: false,
        rematchGuestReady: false,
      },
    });
    return { status: "started" as const, matchId: match.id, room: await withProfiles(final) };
  }

  return { status: "waiting" as const, matchId: null, room: await withProfiles(updated) };
}

// ── Decline rematch — resets flags, stays in room ─────────────────────────────
export async function declineRematch(code: string, userId: string) {
  const room = await db.privateRoom.findUnique({ where: { code } });
  if (!room) throw Object.assign(new Error("Room not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (room.hostId !== userId && room.guestId !== userId)
    throw Object.assign(new Error("Access denied"), { statusCode: 403, code: "FORBIDDEN" });

  // Back to "ready" (guest still in room) so they can still rematch later or leave
  const updated = await db.privateRoom.update({
    where: { code },
    data:  { status: "ready", rematchHostReady: false, rematchGuestReady: false },
  });
  return withProfiles(updated);
}

// ── Get the caller's active room (if any) ─────────────────────────────────────
export async function getMyActiveRoom(userId: string) {
  return db.privateRoom.findFirst({
    where: {
      OR: [{ hostId: userId }, { guestId: userId }],
      status: { in: ["waiting", "ready", "active", "rematch"] },
      expiresAt: { gt: new Date() },
    },
    include: {
      host:  { include: { profile: { select: { username: true, avatarUrl: true } } } },
      guest: { include: { profile: { select: { username: true, avatarUrl: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
}

// ── Cancel room (host only) ───────────────────────────────────────────────────
export async function cancelRoom(code: string, userId: string) {
  const room = await db.privateRoom.findUnique({ where: { code } });
  if (!room) throw Object.assign(new Error("Room not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (room.hostId !== userId)
    throw Object.assign(new Error("Only the host can cancel the room"), { statusCode: 403, code: "FORBIDDEN" });

  await db.privateRoom.update({ where: { code }, data: { status: "cancelled" } });
}

// ── Cleanup expired rooms (called by scheduler) ───────────────────────────────
export async function cleanupExpiredRooms() {
  await db.privateRoom.updateMany({
    where: { status: { in: ["waiting", "ready"] }, expiresAt: { lt: new Date() } },
    data:  { status: "cancelled" },
  }).catch(() => {});
}
