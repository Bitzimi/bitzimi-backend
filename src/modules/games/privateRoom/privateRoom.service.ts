import { randomInt } from "crypto";
import { db } from "../../../db";
import { createMatchForPlayers, MatchGameType } from "../matchmaking/matchmaking.service";
import { getConfigValue } from "../../admin/config/admin.config.service";
import { activateReferral } from "../../referrals/referrals.service";

const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateCode() { let code = ""; for (let i = 0; i < 6; i++) code += CHARS[randomInt(CHARS.length)]; return code; }
async function generateUniqueCode() { for (let i = 0; i < 20; i++) { const code = generateCode(); if (!(await db.privateRoom.findUnique({ where: { code } }))) return code; } throw Object.assign(new Error("Failed to generate unique room code"), { statusCode: 500, code: "CODE_COLLISION" }); }
async function withProfiles(room: any) { return db.privateRoom.findUnique({ where: { id: room.id }, include: { host: { include: { profile: { select: { username: true, avatarUrl: true } } } }, guest: { include: { profile: { select: { username: true, avatarUrl: true } } } } } }); }

async function validateGame(gameType: string, stake: number) {
  const valid: MatchGameType[] = ["dice_clash", "pvp_coinflip", "reaction_tap"];
  if (!valid.includes(gameType as MatchGameType)) throw Object.assign(new Error("Invalid game type"), { statusCode: 400, code: "INVALID_GAME_TYPE" });
  const [enabled, maintenance, stakes] = await Promise.all([
    getConfigValue<boolean>(`game.${gameType}.enabled`, true),
    getConfigValue<boolean>(`game.${gameType}.maintenance`, false),
    getConfigValue<number[]>(`game.${gameType}.stakes`, []),
  ]);
  if (!enabled) throw Object.assign(new Error(`${gameType} is currently unavailable`), { statusCode: 503, code: "GAME_DISABLED" });
  if (maintenance) throw Object.assign(new Error(`${gameType} is under maintenance`), { statusCode: 503, code: "GAME_MAINTENANCE" });
  if (stakes.length && !stakes.includes(stake)) throw Object.assign(new Error(`Stake $${stake} is not available for this game`), { statusCode: 400, code: "INVALID_STAKE" });
}

export async function createRoom(hostId: string, gameType: string, stake: number) {
  await validateGame(gameType, stake);
  await db.privateRoom.updateMany({ where: { hostId, status: "waiting" }, data: { status: "cancelled" } });
  const room = await db.privateRoom.create({ data: { code: await generateUniqueCode(), gameType, stake, hostId, status: "waiting", expiresAt: new Date(Date.now() + ROOM_TTL_MS) } });
  return withProfiles(room);
}

export async function getRoom(code: string, requesterId: string) {
  const room = await db.privateRoom.findUnique({ where: { code }, include: { host: { include: { profile: { select: { username: true, avatarUrl: true } } } }, guest: { include: { profile: { select: { username: true, avatarUrl: true } } } } } });
  if (!room) throw Object.assign(new Error("Room not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (room.hostId !== requesterId && room.guestId !== requesterId && room.status !== "waiting") throw Object.assign(new Error("Access denied"), { statusCode: 403, code: "FORBIDDEN" });
  if (new Date() > room.expiresAt && ["waiting", "ready", "starting"].includes(room.status)) throw Object.assign(new Error("Room has expired"), { statusCode: 410, code: "EXPIRED" });
  return room;
}

export async function joinRoom(code: string, guestId: string) {
  const updated = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM private_rooms WHERE code = ${code} FOR UPDATE`;
    const room = await tx.privateRoom.findUnique({ where: { code } });
    if (!room) throw Object.assign(new Error("Room not found"), { statusCode: 404, code: "NOT_FOUND" });
    if (room.status !== "waiting") throw Object.assign(new Error("Room is no longer accepting players"), { statusCode: 409, code: "ROOM_NOT_WAITING" });
    if (room.hostId === guestId) throw Object.assign(new Error("Cannot join your own room"), { statusCode: 400, code: "SELF_JOIN" });
    if (new Date() > room.expiresAt) throw Object.assign(new Error("Room has expired"), { statusCode: 410, code: "EXPIRED" });
    return tx.privateRoom.update({ where: { id: room.id }, data: { guestId, status: "ready" } });
  });
  return withProfiles(updated);
}

async function claimRoomStart(code: string, userId: string) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM private_rooms WHERE code = ${code} FOR UPDATE`;
    const room = await tx.privateRoom.findUnique({ where: { code } });
    if (!room) throw Object.assign(new Error("Room not found"), { statusCode: 404, code: "NOT_FOUND" });
    if (room.status !== "ready") throw Object.assign(new Error("Room is not ready to start"), { statusCode: 409, code: "ROOM_NOT_READY" });
    if (room.hostId !== userId && room.guestId !== userId) throw Object.assign(new Error("Access denied"), { statusCode: 403, code: "FORBIDDEN" });
    if (!room.guestId) throw Object.assign(new Error("Waiting for opponent to join"), { statusCode: 409, code: "NO_GUEST" });
    const claimed = await tx.privateRoom.updateMany({ where: { id: room.id, status: "ready" }, data: { status: "starting" } });
    if (!claimed.count) throw Object.assign(new Error("Room is already starting"), { statusCode: 409, code: "START_IN_PROGRESS" });
    return room;
  });
}

export async function startMatch(code: string, userId: string) {
  const room = await claimRoomStart(code, userId);
  try {
    const match = await createMatchForPlayers(room.hostId, room.guestId!, room.gameType as MatchGameType, room.stake);
    const updated = await db.privateRoom.updateMany({ where: { id: room.id, status: "starting" }, data: { status: "active", currentMatchId: match.id } });
    if (!updated.count) throw new Error("Room start state was lost");
    setImmediate(() => { activateReferral(room.hostId).catch(() => {}); activateReferral(room.guestId!).catch(() => {}); });
    return { matchId: match.id, room: await withProfiles({ id: room.id }) };
  } catch (err) {
    await db.privateRoom.updateMany({ where: { id: room.id, status: "starting" }, data: { status: "ready" } }).catch(() => {});
    throw err;
  }
}

export async function signalRematch(code: string, userId: string) {
  const ready = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM private_rooms WHERE code = ${code} FOR UPDATE`;
    const room = await tx.privateRoom.findUnique({ where: { code } });
    if (!room) throw Object.assign(new Error("Room not found"), { statusCode: 404, code: "NOT_FOUND" });
    if (room.hostId !== userId && room.guestId !== userId) throw Object.assign(new Error("Access denied"), { statusCode: 403, code: "FORBIDDEN" });
    if (!["active", "rematch"].includes(room.status)) throw Object.assign(new Error("Cannot request rematch at this stage"), { statusCode: 409, code: "INVALID_STATE" });
    const data = room.hostId === userId ? { status: "rematch", rematchHostReady: true } : { status: "rematch", rematchGuestReady: true };
    return tx.privateRoom.update({ where: { id: room.id }, data });
  });
  if (!(ready.rematchHostReady && ready.rematchGuestReady)) return { status: "waiting" as const, matchId: null, room: await withProfiles(ready) };

  const claimed = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM private_rooms WHERE id = ${ready.id} FOR UPDATE`;
    const room = await tx.privateRoom.findUnique({ where: { id: ready.id } });
    if (!room || room.status !== "rematch" || !room.guestId || !room.rematchHostReady || !room.rematchGuestReady) throw Object.assign(new Error("Rematch is no longer ready"), { statusCode: 409, code: "REMATCH_NOT_READY" });
    await tx.privateRoom.update({ where: { id: room.id }, data: { status: "starting" } });
    return room;
  });
  try {
    const match = await createMatchForPlayers(claimed.hostId, claimed.guestId!, claimed.gameType as MatchGameType, claimed.stake);
    await db.privateRoom.updateMany({ where: { id: claimed.id, status: "starting" }, data: { status: "active", currentMatchId: match.id, rematchHostReady: false, rematchGuestReady: false } });
    return { status: "started" as const, matchId: match.id, room: await withProfiles(claimed) };
  } catch (err) {
    await db.privateRoom.updateMany({ where: { id: claimed.id, status: "starting" }, data: { status: "rematch" } }).catch(() => {});
    throw err;
  }
}

export async function declineRematch(code: string, userId: string) {
  const room = await db.privateRoom.findUnique({ where: { code } });
  if (!room) throw Object.assign(new Error("Room not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (room.hostId !== userId && room.guestId !== userId) throw Object.assign(new Error("Access denied"), { statusCode: 403, code: "FORBIDDEN" });
  const updated = await db.privateRoom.update({ where: { id: room.id }, data: { status: "ready", rematchHostReady: false, rematchGuestReady: false } });
  return withProfiles(updated);
}

export async function getMyActiveRoom(userId: string) {
  return db.privateRoom.findFirst({ where: { OR: [{ hostId: userId }, { guestId: userId }], status: { in: ["waiting", "ready", "starting", "active", "rematch"] }, expiresAt: { gt: new Date() } }, include: { host: { include: { profile: { select: { username: true, avatarUrl: true } } } }, guest: { include: { profile: { select: { username: true, avatarUrl: true } } } } }, orderBy: { createdAt: "desc" } });
}

export async function cancelRoom(code: string, userId: string) {
  const room = await db.privateRoom.findUnique({ where: { code } });
  if (!room) throw Object.assign(new Error("Room not found"), { statusCode: 404, code: "NOT_FOUND" });
  if (room.hostId !== userId) throw Object.assign(new Error("Only the host can cancel the room"), { statusCode: 403, code: "FORBIDDEN" });
  await db.privateRoom.updateMany({ where: { id: room.id, status: { in: ["waiting", "ready", "rematch"] } }, data: { status: "cancelled" } });
}

export async function cleanupExpiredRooms() {
  await db.privateRoom.updateMany({ where: { status: { in: ["waiting", "ready", "rematch"] }, expiresAt: { lt: new Date() } }, data: { status: "cancelled" } }).catch(() => {});
}
