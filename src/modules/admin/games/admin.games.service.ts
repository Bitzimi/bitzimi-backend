import { db } from "../../../db";
import { getConfigValue, setConfig } from "../config/admin.config.service";
import { registerColorLobby } from "../../games/colorGame/colorGame.service";
import { registerSpinLobby }  from "../../games/spinBattle/spinBattle.service";

// ── Game type metadata ─────────────────────────────────────────────────────────

export const GAME_DEFINITIONS = [
  { gameType: "color_game",   name: "Color Prediction", category: "lobby",       defaultLobbies: ["A","B","C","D"] },
  { gameType: "spin_battle",  name: "Spin Battle",      category: "lobby",       defaultLobbies: ["A","B","C","D"] },
  { gameType: "dice_royale",  name: "Dice Royale",      category: "stake_multi", defaultLobbies: [] },
  { gameType: "dice_arena",   name: "Dice Arena",        category: "stake_multi", defaultLobbies: [] },
  { gameType: "dice_clash",   name: "Dice Clash",        category: "pvp",         defaultLobbies: [] },
  { gameType: "pvp_coinflip", name: "Coin Flip",         category: "pvp",         defaultLobbies: [] },
  { gameType: "reaction_tap", name: "Reaction Tap",      category: "pvp",         defaultLobbies: [] },
] as const;

export type GameType = typeof GAME_DEFINITIONS[number]["gameType"];

/** Resolve the current lobby IDs for a lobby-based game from config. */
async function getLobbyIds(gameType: string, defaultIds: readonly string[]): Promise<string[]> {
  return getConfigValue<string[]>(`game.${gameType}.lobby_ids`, [...defaultIds]);
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type RoomAccessLevel = "public" | "verified" | "vip" | "staff";

export interface LobbyConfig {
  lobbyId:     string;
  enabled:     boolean;
  minBet:      number;
  maxBet:      number;
  order:       number;
  accessLevel: RoomAccessLevel;
}

export interface RoomConfig {
  roomId:      string;
  name:        string;
  enabled:     boolean;
  maintenance: boolean;
  visible:     boolean;
  order:       number;
  capacity:    number | null;  // null = unlimited (reserved for future use)
}

export interface GameConfig {
  gameType:    string;
  name:        string;
  category:    string;
  enabled:     boolean;
  maintenance: boolean;
  feeRate:     number;
  roomMode:    boolean;        // when true, players select a room before joining (future activation)
  lobbies:     LobbyConfig[];
  stakes:      number[];
}

// ── Read all game configs ─────────────────────────────────────────────────────

export async function getGameConfigs(): Promise<GameConfig[]> {
  const configs: GameConfig[] = [];

  for (const def of GAME_DEFINITIONS) {
    const { gameType, name, category, defaultLobbies } = def;

    const [enabled, maintenance, feeRate, roomMode] = await Promise.all([
      getConfigValue<boolean>(`game.${gameType}.enabled`, true),
      getConfigValue<boolean>(`game.${gameType}.maintenance`, false),
      getConfigValue<number>(`game.${gameType}.fee_rate`, 0.10),
      getConfigValue<boolean>(`game.${gameType}.room_mode`, false),
    ]);

    const isLobbyGame = category === "lobby";
    const lobbyIds = isLobbyGame ? await getLobbyIds(gameType, defaultLobbies) : [];

    const lobbyConfigs: LobbyConfig[] = [];
    for (const lobbyId of lobbyIds) {
      const [lEnabled, minBet, maxBet, order, accessLevel] = await Promise.all([
        getConfigValue<boolean>(`game.${gameType}.lobby.${lobbyId}.enabled`, true),
        getConfigValue<number>(`game.${gameType}.lobby.${lobbyId}.min_bet`, 1),
        getConfigValue<number>(`game.${gameType}.lobby.${lobbyId}.max_bet`, 100),
        getConfigValue<number>(`game.${gameType}.lobby.${lobbyId}.order`, lobbyIds.indexOf(lobbyId) + 1),
        getConfigValue<RoomAccessLevel>(`game.${gameType}.lobby.${lobbyId}.access_level`, "public"),
      ]);
      lobbyConfigs.push({ lobbyId, enabled: lEnabled, minBet, maxBet, order, accessLevel });
    }
    lobbyConfigs.sort((a, b) => a.order - b.order);

    const stakes = !isLobbyGame && category !== "pvp"
      ? await getConfigValue<number[]>(`game.${gameType}.stakes`, [])
      : [];

    configs.push({ gameType, name, category, enabled, maintenance, feeRate, roomMode, lobbies: lobbyConfigs, stakes });
  }

  return configs;
}

// ── Update game-level config ───────────────────────────────────────────────────

export async function updateGameConfig(
  gameType: string,
  adminId:  string,
  opts: { enabled?: boolean; maintenance?: boolean; feeRate?: number; roomMode?: boolean },
): Promise<void> {
  const def = GAME_DEFINITIONS.find(d => d.gameType === gameType);
  if (!def) throw Object.assign(new Error(`Unknown game type: ${gameType}`), { statusCode: 400, code: "INVALID_GAME_TYPE" });

  if (opts.enabled !== undefined)
    await setConfig(`game.${gameType}.enabled`, opts.enabled, adminId);
  if (opts.maintenance !== undefined)
    await setConfig(`game.${gameType}.maintenance`, opts.maintenance, adminId);
  if (opts.feeRate !== undefined) {
    if (opts.feeRate < 0 || opts.feeRate > 0.50)
      throw Object.assign(new Error("Fee rate must be 0–50%"), { statusCode: 400, code: "INVALID_FEE_RATE" });
    await setConfig(`game.${gameType}.fee_rate`, opts.feeRate, adminId);
  }
  if (opts.roomMode !== undefined) {
    if (def.category === "pvp")
      throw Object.assign(new Error("PvP matchmaking games do not support room mode"), { statusCode: 400, code: "INVALID_GAME_TYPE" });
    await setConfig(`game.${gameType}.room_mode`, opts.roomMode, adminId);
  }
}

// ── Update lobby config ───────────────────────────────────────────────────────

export async function updateLobbyConfig(
  gameType: string,
  lobbyId:  string,
  adminId:  string,
  opts: { enabled?: boolean; minBet?: number; maxBet?: number; order?: number; accessLevel?: RoomAccessLevel },
): Promise<void> {
  const def = GAME_DEFINITIONS.find(d => d.gameType === gameType);
  if (!def || def.category !== "lobby")
    throw Object.assign(new Error(`Game ${gameType} does not have lobbies`), { statusCode: 400, code: "INVALID_GAME_TYPE" });

  const activeLobbies = await getLobbyIds(gameType, def.defaultLobbies);
  if (!activeLobbies.includes(lobbyId))
    throw Object.assign(new Error(`Unknown lobby: ${gameType}/${lobbyId}`), { statusCode: 400, code: "INVALID_LOBBY" });

  if (opts.enabled !== undefined)
    await setConfig(`game.${gameType}.lobby.${lobbyId}.enabled`, opts.enabled, adminId);
  if (opts.minBet !== undefined) {
    if (opts.minBet <= 0) throw Object.assign(new Error("minBet must be positive"), { statusCode: 400, code: "INVALID_BET_RANGE" });
    await setConfig(`game.${gameType}.lobby.${lobbyId}.min_bet`, opts.minBet, adminId);
  }
  if (opts.maxBet !== undefined) {
    if (opts.maxBet <= 0) throw Object.assign(new Error("maxBet must be positive"), { statusCode: 400, code: "INVALID_BET_RANGE" });
    await setConfig(`game.${gameType}.lobby.${lobbyId}.max_bet`, opts.maxBet, adminId);
  }
  if (opts.order !== undefined)
    await setConfig(`game.${gameType}.lobby.${lobbyId}.order`, opts.order, adminId);
  if (opts.accessLevel !== undefined) {
    const valid: RoomAccessLevel[] = ["public", "verified", "vip", "staff"];
    if (!valid.includes(opts.accessLevel))
      throw Object.assign(new Error(`Invalid access level: ${opts.accessLevel}`), { statusCode: 400, code: "INVALID_ACCESS_LEVEL" });
    await setConfig(`game.${gameType}.lobby.${lobbyId}.access_level`, opts.accessLevel, adminId);
  }
}

// ── Room access enforcement (shared across game services) ─────────────────────

export async function checkRoomAccess(userId: string, gameType: string, lobbyId: string): Promise<void> {
  const accessLevel = await getConfigValue<RoomAccessLevel>(`game.${gameType}.lobby.${lobbyId}.access_level`, "public");
  if (accessLevel === "public") return;

  const user = await db.user.findUnique({
    where:  { id: userId },
    select: { role: true, kyc: { select: { status: true } }, subscription: { select: { isActive: true, endsAt: true } } },
  });
  if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404, code: "USER_NOT_FOUND" });

  if (accessLevel === "staff") {
    if (!["admin", "support"].includes(user.role))
      throw Object.assign(new Error("This room is restricted to staff members only"), { statusCode: 403, code: "ROOM_ACCESS_DENIED" });
    return;
  }

  if (accessLevel === "vip") {
    const hasVip = user.subscription?.isActive === true &&
      (!user.subscription.endsAt || user.subscription.endsAt > new Date());
    if (!hasVip)
      throw Object.assign(new Error("This room requires an active VIP subscription"), { statusCode: 403, code: "ROOM_VIP_REQUIRED" });
    return;
  }

  if (accessLevel === "verified") {
    if (user.kyc?.status !== "verified")
      throw Object.assign(new Error("This room requires identity verification (KYC)"), { statusCode: 403, code: "ROOM_VERIFICATION_REQUIRED" });
    return;
  }
}

// ── Create a new lobby ────────────────────────────────────────────────────────

export async function createLobby(
  gameType: string,
  lobbyId:  string,
  adminId:  string,
  opts: { minBet: number; maxBet: number; enabled?: boolean },
): Promise<LobbyConfig> {
  const def = GAME_DEFINITIONS.find(d => d.gameType === gameType);
  if (!def || def.category !== "lobby")
    throw Object.assign(new Error(`Game ${gameType} does not support lobbies`), { statusCode: 400, code: "INVALID_GAME_TYPE" });

  if (!/^[A-Z0-9]{1,8}$/.test(lobbyId))
    throw Object.assign(new Error("Lobby ID must be 1–8 uppercase alphanumeric characters"), { statusCode: 400, code: "INVALID_LOBBY_ID" });

  const existing = await getLobbyIds(gameType, def.defaultLobbies);
  if (existing.includes(lobbyId))
    throw Object.assign(new Error(`Lobby ${lobbyId} already exists for ${gameType}`), { statusCode: 409, code: "LOBBY_EXISTS" });

  if (opts.minBet <= 0 || opts.maxBet <= opts.minBet)
    throw Object.assign(new Error("maxBet must be greater than minBet, both positive"), { statusCode: 400, code: "INVALID_BET_RANGE" });

  const newOrder = existing.length + 1;
  const enabled  = opts.enabled ?? true;

  await Promise.all([
    setConfig(`game.${gameType}.lobby.${lobbyId}.enabled`, enabled,      adminId),
    setConfig(`game.${gameType}.lobby.${lobbyId}.min_bet`, opts.minBet,  adminId),
    setConfig(`game.${gameType}.lobby.${lobbyId}.max_bet`, opts.maxBet,  adminId),
    setConfig(`game.${gameType}.lobby.${lobbyId}.order`,   newOrder,     adminId),
  ]);
  await setConfig(`game.${gameType}.lobby_ids`, [...existing, lobbyId], adminId);

  if (gameType === "color_game") {
    await registerColorLobby(lobbyId, opts.minBet, opts.maxBet);
  } else if (gameType === "spin_battle") {
    await registerSpinLobby(lobbyId, opts.minBet, opts.maxBet);
  }

  return { lobbyId, enabled, minBet: opts.minBet, maxBet: opts.maxBet, order: newOrder, accessLevel: "public" as RoomAccessLevel };
}

// ── Update available stakes ───────────────────────────────────────────────────

export async function updateGameStakes(
  gameType: string,
  stakes:   number[],
  adminId:  string,
): Promise<void> {
  const def = GAME_DEFINITIONS.find(d => d.gameType === gameType);
  if (!def || def.defaultLobbies.length > 0)
    throw Object.assign(new Error(`Game ${gameType} does not use stake selection`), { statusCode: 400, code: "INVALID_GAME_TYPE" });
  if (!Array.isArray(stakes) || stakes.length === 0)
    throw Object.assign(new Error("Stakes must be a non-empty array"), { statusCode: 400, code: "INVALID_STAKES" });

  const sorted = [...new Set(stakes.map(s => Number(s)))].filter(s => s > 0).sort((a, b) => a - b);
  await setConfig(`game.${gameType}.stakes`, sorted, adminId);
}

// ── Room infrastructure ───────────────────────────────────────────────────────
//
// Rooms are configuration-only infrastructure stored in SystemConfig.
// They do NOT affect the current player flow — the game engine remains
// unaware of rooms until roomMode is enabled per-game in the future.
//
// Config key structure (lobby games):
//   game.{gameType}.lobby.{lobbyId}.room_ids          → string[]
//   game.{gameType}.lobby.{lobbyId}.room.{roomId}.name        → string
//   game.{gameType}.lobby.{lobbyId}.room.{roomId}.enabled     → boolean
//   game.{gameType}.lobby.{lobbyId}.room.{roomId}.maintenance → boolean
//   game.{gameType}.lobby.{lobbyId}.room.{roomId}.visible     → boolean
//   game.{gameType}.lobby.{lobbyId}.room.{roomId}.order       → number
//   game.{gameType}.lobby.{lobbyId}.room.{roomId}.capacity    → number|null
//
// Config key structure (stake games):
//   game.{gameType}.stake.{stake}.room_ids                    → string[]
//   game.{gameType}.stake.{stake}.room.{roomId}.*             → (same fields)

const ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]{1,16}$/;

function lobbyRoomScope(gameType: string, lobbyId: string): string {
  return `game.${gameType}.lobby.${lobbyId}`;
}

function stakeRoomScope(gameType: string, stake: number): string {
  return `game.${gameType}.stake.${stake}`;
}

async function getRoomIds(scope: string): Promise<string[]> {
  return getConfigValue<string[]>(`${scope}.room_ids`, []);
}

async function readRoomConfig(scope: string, roomId: string): Promise<RoomConfig> {
  const base = `${scope}.room.${roomId}`;
  const [name, enabled, maintenance, visible, order, capacity] = await Promise.all([
    getConfigValue<string>(`${base}.name`,        `Room ${roomId}`),
    getConfigValue<boolean>(`${base}.enabled`,    true),
    getConfigValue<boolean>(`${base}.maintenance`,false),
    getConfigValue<boolean>(`${base}.visible`,    true),
    getConfigValue<number>(`${base}.order`,        1),
    getConfigValue<number | null>(`${base}.capacity`, null),
  ]);
  return { roomId, name, enabled, maintenance, visible, order, capacity };
}

async function writeRoomConfig(
  scope:   string,
  roomId:  string,
  adminId: string,
  opts: { name?: string; enabled?: boolean; maintenance?: boolean; visible?: boolean; order?: number; capacity?: number | null },
): Promise<void> {
  const base = `${scope}.room.${roomId}`;
  const writes: Promise<any>[] = [];
  if (opts.name        !== undefined) writes.push(setConfig(`${base}.name`,        opts.name,        adminId));
  if (opts.enabled     !== undefined) writes.push(setConfig(`${base}.enabled`,     opts.enabled,     adminId));
  if (opts.maintenance !== undefined) writes.push(setConfig(`${base}.maintenance`, opts.maintenance, adminId));
  if (opts.visible     !== undefined) writes.push(setConfig(`${base}.visible`,     opts.visible,     adminId));
  if (opts.order       !== undefined) writes.push(setConfig(`${base}.order`,       opts.order,       adminId));
  if (opts.capacity    !== undefined) writes.push(setConfig(`${base}.capacity`,    opts.capacity,    adminId));
  await Promise.all(writes);
}

// ── Room CRUD: Lobby Games ─────────────────────────────────────────────────────

export async function getLobbyRooms(gameType: string, lobbyId: string): Promise<RoomConfig[]> {
  const def = GAME_DEFINITIONS.find(d => d.gameType === gameType);
  if (!def || def.category !== "lobby")
    throw Object.assign(new Error(`Game ${gameType} does not have lobbies`), { statusCode: 400, code: "INVALID_GAME_TYPE" });

  const activeLobbies = await getLobbyIds(gameType, def.defaultLobbies);
  if (!activeLobbies.includes(lobbyId))
    throw Object.assign(new Error(`Unknown lobby: ${gameType}/${lobbyId}`), { statusCode: 400, code: "INVALID_LOBBY" });

  const scope   = lobbyRoomScope(gameType, lobbyId);
  const roomIds = await getRoomIds(scope);
  const rooms   = await Promise.all(roomIds.map(id => readRoomConfig(scope, id)));
  return rooms.sort((a, b) => a.order - b.order);
}

export async function createLobbyRoom(
  gameType: string,
  lobbyId:  string,
  adminId:  string,
  opts: { roomId?: string; name?: string; enabled?: boolean; visible?: boolean; capacity?: number | null },
): Promise<RoomConfig> {
  const def = GAME_DEFINITIONS.find(d => d.gameType === gameType);
  if (!def || def.category !== "lobby")
    throw Object.assign(new Error(`Game ${gameType} does not have lobbies`), { statusCode: 400, code: "INVALID_GAME_TYPE" });

  const activeLobbies = await getLobbyIds(gameType, def.defaultLobbies);
  if (!activeLobbies.includes(lobbyId))
    throw Object.assign(new Error(`Unknown lobby: ${gameType}/${lobbyId}`), { statusCode: 400, code: "INVALID_LOBBY" });

  const scope   = lobbyRoomScope(gameType, lobbyId);
  const roomIds = await getRoomIds(scope);
  const newId   = opts.roomId ?? String(roomIds.length + 1);

  if (!ROOM_ID_PATTERN.test(newId))
    throw Object.assign(new Error("Room ID must be 1–16 alphanumeric, underscore, or dash characters"), { statusCode: 400, code: "INVALID_ROOM_ID" });
  if (roomIds.includes(newId))
    throw Object.assign(new Error(`Room ${newId} already exists in ${gameType}/${lobbyId}`), { statusCode: 409, code: "ROOM_EXISTS" });

  const newOrder = roomIds.length + 1;
  const config: RoomConfig = {
    roomId:      newId,
    name:        opts.name        ?? `Room ${newId}`,
    enabled:     opts.enabled     ?? true,
    maintenance: false,
    visible:     opts.visible     ?? true,
    order:       newOrder,
    capacity:    opts.capacity    ?? null,
  };

  await writeRoomConfig(scope, newId, adminId, config);
  await setConfig(`${scope}.room_ids`, [...roomIds, newId], adminId);

  return config;
}

export async function updateLobbyRoom(
  gameType: string,
  lobbyId:  string,
  roomId:   string,
  adminId:  string,
  opts: { name?: string; enabled?: boolean; maintenance?: boolean; visible?: boolean; order?: number; capacity?: number | null },
): Promise<RoomConfig> {
  const def = GAME_DEFINITIONS.find(d => d.gameType === gameType);
  if (!def || def.category !== "lobby")
    throw Object.assign(new Error(`Game ${gameType} does not have lobbies`), { statusCode: 400, code: "INVALID_GAME_TYPE" });

  const scope   = lobbyRoomScope(gameType, lobbyId);
  const roomIds = await getRoomIds(scope);
  if (!roomIds.includes(roomId))
    throw Object.assign(new Error(`Room ${roomId} not found in ${gameType}/${lobbyId}`), { statusCode: 404, code: "ROOM_NOT_FOUND" });

  await writeRoomConfig(scope, roomId, adminId, opts);
  return readRoomConfig(scope, roomId);
}

export async function deleteLobbyRoom(
  gameType: string,
  lobbyId:  string,
  roomId:   string,
  adminId:  string,
): Promise<void> {
  const def = GAME_DEFINITIONS.find(d => d.gameType === gameType);
  if (!def || def.category !== "lobby")
    throw Object.assign(new Error(`Game ${gameType} does not have lobbies`), { statusCode: 400, code: "INVALID_GAME_TYPE" });

  const scope   = lobbyRoomScope(gameType, lobbyId);
  const roomIds = await getRoomIds(scope);
  if (!roomIds.includes(roomId))
    throw Object.assign(new Error(`Room ${roomId} not found in ${gameType}/${lobbyId}`), { statusCode: 404, code: "ROOM_NOT_FOUND" });

  await setConfig(`${scope}.room_ids`, roomIds.filter(id => id !== roomId), adminId);
  // Note: individual room config keys are left in SystemConfig (orphaned but harmless)
}

// ── Room CRUD: Stake Games ─────────────────────────────────────────────────────

function validateStakeGame(gameType: string): void {
  const def = GAME_DEFINITIONS.find(d => d.gameType === gameType);
  if (!def || def.category !== "stake_multi")
    throw Object.assign(new Error(`Game ${gameType} is not a stake-selection multiplayer game`), { statusCode: 400, code: "INVALID_GAME_TYPE" });
}

export async function getStakeRooms(gameType: string, stake: number): Promise<RoomConfig[]> {
  validateStakeGame(gameType);
  const scope   = stakeRoomScope(gameType, stake);
  const roomIds = await getRoomIds(scope);
  const rooms   = await Promise.all(roomIds.map(id => readRoomConfig(scope, id)));
  return rooms.sort((a, b) => a.order - b.order);
}

export async function createStakeRoom(
  gameType: string,
  stake:    number,
  adminId:  string,
  opts: { roomId?: string; name?: string; enabled?: boolean; visible?: boolean; capacity?: number | null },
): Promise<RoomConfig> {
  validateStakeGame(gameType);
  if (stake <= 0) throw Object.assign(new Error("Stake must be positive"), { statusCode: 400, code: "INVALID_STAKE" });

  const configuredStakes = await getConfigValue<number[]>(`game.${gameType}.stakes`, []);
  if (!configuredStakes.includes(stake))
    throw Object.assign(new Error(`Stake $${stake} is not configured for ${gameType}`), { statusCode: 400, code: "INVALID_STAKE" });

  const scope   = stakeRoomScope(gameType, stake);
  const roomIds = await getRoomIds(scope);
  const newId   = opts.roomId ?? String(roomIds.length + 1);

  if (!ROOM_ID_PATTERN.test(newId))
    throw Object.assign(new Error("Room ID must be 1–16 alphanumeric, underscore, or dash characters"), { statusCode: 400, code: "INVALID_ROOM_ID" });
  if (roomIds.includes(newId))
    throw Object.assign(new Error(`Room ${newId} already exists for ${gameType} $${stake}`), { statusCode: 409, code: "ROOM_EXISTS" });

  const newOrder = roomIds.length + 1;
  const config: RoomConfig = {
    roomId:      newId,
    name:        opts.name     ?? `Room ${newId}`,
    enabled:     opts.enabled  ?? true,
    maintenance: false,
    visible:     opts.visible  ?? true,
    order:       newOrder,
    capacity:    opts.capacity ?? null,
  };

  await writeRoomConfig(scope, newId, adminId, config);
  await setConfig(`${scope}.room_ids`, [...roomIds, newId], adminId);

  return config;
}

export async function updateStakeRoom(
  gameType: string,
  stake:    number,
  roomId:   string,
  adminId:  string,
  opts: { name?: string; enabled?: boolean; maintenance?: boolean; visible?: boolean; order?: number; capacity?: number | null },
): Promise<RoomConfig> {
  validateStakeGame(gameType);
  const scope   = stakeRoomScope(gameType, stake);
  const roomIds = await getRoomIds(scope);
  if (!roomIds.includes(roomId))
    throw Object.assign(new Error(`Room ${roomId} not found for ${gameType} $${stake}`), { statusCode: 404, code: "ROOM_NOT_FOUND" });

  await writeRoomConfig(scope, roomId, adminId, opts);
  return readRoomConfig(scope, roomId);
}

export async function deleteStakeRoom(
  gameType: string,
  stake:    number,
  roomId:   string,
  adminId:  string,
): Promise<void> {
  validateStakeGame(gameType);
  const scope   = stakeRoomScope(gameType, stake);
  const roomIds = await getRoomIds(scope);
  if (!roomIds.includes(roomId))
    throw Object.assign(new Error(`Room ${roomId} not found for ${gameType} $${stake}`), { statusCode: 404, code: "ROOM_NOT_FOUND" });

  await setConfig(`${scope}.room_ids`, roomIds.filter(id => id !== roomId), adminId);
}

// ── Seed default rooms (called from index.ts after seedDefaultConfig) ──────────
//
// Seeds a default "Room 1" for every lobby in lobby-based games.
// Stakes games start with no rooms seeded — admin creates them explicitly.
// Safe to call on every startup: upsert with empty update for existing entries.

export async function seedDefaultRooms(): Promise<void> {
  const lobbyGames: Array<{ gameType: string; defaultLobbies: readonly string[] }> = [
    { gameType: "color_game",  defaultLobbies: ["A","B","C","D"] },
    { gameType: "spin_battle", defaultLobbies: ["A","B","C","D"] },
  ];

  for (const { gameType, defaultLobbies } of lobbyGames) {
    const activeLobbies = await getConfigValue<string[]>(`game.${gameType}.lobby_ids`, [...defaultLobbies]);
    for (const lobbyId of activeLobbies) {
      const scope   = lobbyRoomScope(gameType, lobbyId);
      const roomIds = await getRoomIds(scope);
      if (roomIds.length === 0) {
        // Seed room_ids list
        await db.systemConfig.upsert({
          where:  { key: `${scope}.room_ids` },
          create: { key: `${scope}.room_ids`, value: JSON.stringify(["1"]), description: `${gameType} lobby ${lobbyId} room IDs` },
          update: {},
        });
        // Seed Room 1 config
        const entries = [
          { key: `${scope}.room.1.name`,        value: JSON.stringify("Room 1"),  description: `${gameType} lobby ${lobbyId} room 1 name` },
          { key: `${scope}.room.1.enabled`,     value: JSON.stringify(true),      description: `${gameType} lobby ${lobbyId} room 1 enabled` },
          { key: `${scope}.room.1.maintenance`, value: JSON.stringify(false),     description: `${gameType} lobby ${lobbyId} room 1 maintenance` },
          { key: `${scope}.room.1.visible`,     value: JSON.stringify(true),      description: `${gameType} lobby ${lobbyId} room 1 visible` },
          { key: `${scope}.room.1.order`,       value: JSON.stringify(1),         description: `${gameType} lobby ${lobbyId} room 1 display order` },
          { key: `${scope}.room.1.capacity`,    value: JSON.stringify(null),      description: `${gameType} lobby ${lobbyId} room 1 capacity (null = unlimited)` },
        ];
        for (const e of entries) {
          await db.systemConfig.upsert({ where: { key: e.key }, create: e, update: {} });
        }
      }
    }
  }
}

// ── Live monitoring ───────────────────────────────────────────────────────────

function safeParseIds(raw: string): string[] {
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

export async function getGameMonitoring() {
  const [colorRounds, spinRounds, diceRoyaleRounds, diceArenaRounds, pvpMatches, queueEntries, rounds24h] =
    await Promise.all([
      db.gameRound.findMany({
        where: { gameType: "color_game", status: { in: ["waiting", "spinning", "result"] } },
        select: { id: true, lobbyId: true, status: true, _count: { select: { bets: true } } },
      }),
      db.gameRound.findMany({
        where: { gameType: "spin_battle", status: { in: ["waiting", "countdown", "locked", "spinning", "result"] } },
        select: { id: true, lobbyId: true, status: true, _count: { select: { bets: true } } },
      }),
      db.diceRound.findMany({
        where: { gameType: "dice_royale", status: { in: ["open", "countdown", "locked", "rolling", "result"] } },
        select: { id: true, stake: true, status: true, playerIds: true },
      }),
      db.diceRound.findMany({
        where: { gameType: "dice_arena", status: { in: ["open", "countdown", "locked", "rolling", "result"] } },
        select: { id: true, stake: true, status: true, playerIds: true },
      }),
      db.pvpMatch.findMany({
        where: { status: "active" },
        select: { id: true, gameType: true, stake: true },
      }),
      db.matchmakingQueue.findMany({
        where: { status: "waiting", expiresAt: { gt: new Date() } },
        select: { gameType: true, stake: true },
      }),
      db.gameRound.count({
        where: { status: { in: ["completed","cancelled","cancelled_insufficient_opposition"] }, settledAt: { gte: new Date(Date.now() - 86_400_000) } },
      }),
    ]);

  const pvpByType = pvpMatches.reduce<Record<string, number>>((acc, m) => {
    acc[m.gameType] = (acc[m.gameType] ?? 0) + 1;
    return acc;
  }, {});

  const queueByType = queueEntries.reduce<Record<string, number>>((acc, q) => {
    acc[q.gameType] = (acc[q.gameType] ?? 0) + 1;
    return acc;
  }, {});

  return {
    colorGame: {
      activeRounds:  colorRounds.length,
      activePlayers: colorRounds.reduce((s, r) => s + (r._count?.bets ?? 0), 0),
      rounds: colorRounds.map(r => ({ id: r.id, lobbyId: r.lobbyId, status: r.status, playerCount: r._count?.bets ?? 0 })),
    },
    spinBattle: {
      activeRounds:  spinRounds.length,
      activePlayers: spinRounds.reduce((s, r) => s + (r._count?.bets ?? 0), 0),
      rounds: spinRounds.map(r => ({ id: r.id, lobbyId: r.lobbyId, status: r.status, playerCount: r._count?.bets ?? 0 })),
    },
    diceRoyale: {
      activeRounds:  diceRoyaleRounds.length,
      activePlayers: diceRoyaleRounds.reduce((s, r) => s + safeParseIds(r.playerIds).length, 0),
      rounds: diceRoyaleRounds.map(r => ({ id: r.id, stake: r.stake, status: r.status, playerCount: safeParseIds(r.playerIds).length })),
    },
    diceArena: {
      activeRounds:  diceArenaRounds.length,
      activePlayers: diceArenaRounds.reduce((s, r) => s + safeParseIds(r.playerIds).length, 0),
      rounds: diceArenaRounds.map(r => ({ id: r.id, stake: r.stake, status: r.status, playerCount: safeParseIds(r.playerIds).length })),
    },
    pvp: { activeMatches: pvpMatches.length, byGameType: pvpByType },
    queue: { totalWaiting: queueEntries.length, byGameType: queueByType },
    roundsSettled24h: rounds24h,
    totalActivePlayers:
      colorRounds.reduce((s, r) => s + (r._count?.bets ?? 0), 0) +
      spinRounds.reduce((s, r) => s + (r._count?.bets ?? 0), 0) +
      diceRoyaleRounds.reduce((s, r) => s + safeParseIds(r.playerIds).length, 0) +
      diceArenaRounds.reduce((s, r) => s + safeParseIds(r.playerIds).length, 0) +
      pvpMatches.length * 2,
  };
}

// ── Match history ─────────────────────────────────────────────────────────────

export async function getGameHistory(opts: { cursor?: string; limit?: number; gameType?: string }) {
  const { cursor, limit = 20, gameType } = opts;
  const take = Math.min(Math.max(Number(limit) || 20, 1), 50) + 1;

  const where: any = { settled: true };
  if (gameType) where.round = { gameType };
  if (cursor) {
    const anchor = await db.gameBet.findUnique({ where: { id: cursor } });
    if (anchor) where.placedAt = { lt: anchor.placedAt };
  }

  const bets = await db.gameBet.findMany({
    where,
    orderBy: { placedAt: "desc" },
    take,
    include: {
      round: { select: { gameType: true, lobbyId: true } },
      user:  { select: { email: true, profile: { select: { username: true } } } },
    },
  });

  const hasMore = bets.length >= take;
  const items   = hasMore ? bets.slice(0, take - 1) : bets;

  return {
    items: items.map(b => ({
      id:       b.id,
      roundId:  b.roundId,
      gameType: b.round?.gameType ?? "unknown",
      lobbyId:  b.round?.lobbyId ?? null,
      userId:   b.userId,
      username: b.user?.profile?.username ?? b.user?.email ?? "",
      amount:   b.amount,
      outcome:  b.outcome,
      payout:   b.payout,
      fee:      b.platformFee,
      betData:  safeParseJson(b.betData),
      placedAt: b.placedAt.toISOString(),
      settledAt:b.settledAt?.toISOString() ?? null,
    })),
    nextCursor: hasMore ? items[items.length - 1].id : null,
    hasMore,
  };
}

function safeParseJson(s: string | null): any {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

// ── Game analytics ─────────────────────────────────────────────────────────────

export async function getGameAnalytics() {
  const since = new Date(Date.now() - 30 * 86_400_000);

  const [allTimeStats, recent24hRounds, recent24hPvp] = await Promise.all([
    db.gameStat.groupBy({
      by:   ["gameType"],
      _sum: { totalWagered: true, totalWon: true, totalGames: true, wins: true },
    }),
    db.gameRound.groupBy({
      by:    ["gameType"],
      where: { settledAt: { gte: since } },
      _count: { id: true },
    }),
    db.pvpMatch.groupBy({
      by:    ["gameType"],
      where: { status: "settled", settledAt: { gte: since } },
      _count: { id: true },
    }),
  ]);

  const byGameType: Record<string, { totalGames: number; wins: number; totalWagered: number; totalPaid: number; platformRevenue: number; rounds30d: number }> = {};

  for (const row of allTimeStats) {
    const wagered = row._sum.totalWagered ?? 0;
    const paid    = row._sum.totalWon     ?? 0;
    byGameType[row.gameType] = { totalGames: row._sum.totalGames ?? 0, wins: row._sum.wins ?? 0, totalWagered: wagered, totalPaid: paid, platformRevenue: wagered - paid, rounds30d: 0 };
  }
  for (const row of recent24hRounds) {
    if (!byGameType[row.gameType]) byGameType[row.gameType] = { totalGames: 0, wins: 0, totalWagered: 0, totalPaid: 0, platformRevenue: 0, rounds30d: 0 };
    byGameType[row.gameType].rounds30d += row._count.id;
  }
  for (const row of recent24hPvp) {
    if (!byGameType[row.gameType]) byGameType[row.gameType] = { totalGames: 0, wins: 0, totalWagered: 0, totalPaid: 0, platformRevenue: 0, rounds30d: 0 };
    byGameType[row.gameType].rounds30d += row._count.id;
  }

  const totals = Object.values(byGameType).reduce(
    (acc, g) => ({ totalGames: acc.totalGames + g.totalGames, totalWagered: acc.totalWagered + g.totalWagered, totalPaid: acc.totalPaid + g.totalPaid, platformRevenue: acc.platformRevenue + g.platformRevenue }),
    { totalGames: 0, totalWagered: 0, totalPaid: 0, platformRevenue: 0 },
  );

  return { period: "30d", since: since.toISOString(), byGameType, totals };
}
