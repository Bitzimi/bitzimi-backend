import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import {
  getGameConfigs,
  updateGameConfig,
  updateLobbyConfig,
  createLobby,
  updateGameStakes,
  getGameMonitoring,
  getGameHistory,
  getGameAnalytics,
  getLobbyRooms,
  createLobbyRoom,
  updateLobbyRoom,
  deleteLobbyRoom,
  getStakeRooms,
  createStakeRoom,
  updateStakeRoom,
  deleteStakeRoom,
} from "./admin.games.service";

const PatchGameSchema = z.object({
  enabled:     z.boolean().optional(),
  maintenance: z.boolean().optional(),
  feeRate:     z.number().min(0).max(0.50).optional(),
  roomMode:    z.boolean().optional(),
});

const PatchLobbySchema = z.object({
  enabled:     z.boolean().optional(),
  minBet:      z.number().positive().optional(),
  maxBet:      z.number().positive().optional(),
  order:       z.number().int().positive().optional(),
  accessLevel: z.enum(["public", "verified", "vip", "staff"]).optional(),
});

const CreateLobbySchema = z.object({
  lobbyId: z.string().regex(/^[A-Z0-9]{1,8}$/, "Lobby ID must be 1–8 uppercase alphanumeric characters"),
  minBet:  z.number().positive(),
  maxBet:  z.number().positive(),
  enabled: z.boolean().optional(),
});

const PatchStakesSchema = z.object({
  stakes: z.array(z.number().positive()).min(1),
});

const HistoryQuerySchema = z.object({
  cursor:   z.string().optional(),
  limit:    z.coerce.number().min(1).max(50).default(20),
  gameType: z.string().optional(),
});

const CreateRoomSchema = z.object({
  roomId:   z.string().regex(/^[a-zA-Z0-9_-]{1,16}$/, "Room ID must be 1–16 alphanumeric, underscore, or dash characters").optional(),
  name:     z.string().min(1).max(60).optional(),
  enabled:  z.boolean().optional(),
  visible:  z.boolean().optional(),
  capacity: z.number().int().positive().nullable().optional(),
});

const UpdateRoomSchema = z.object({
  name:        z.string().min(1).max(60).optional(),
  enabled:     z.boolean().optional(),
  maintenance: z.boolean().optional(),
  visible:     z.boolean().optional(),
  order:       z.number().int().positive().optional(),
  capacity:    z.number().int().positive().nullable().optional(),
});

export async function adminGamesRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // ── Game list ──────────────────────────────────────────────────────────────

  // GET /api/v1/admin/games — all game configs + current enabled/maintenance/fee state
  app.get("/", { onRequest: [requirePermission("admin.games.view")] }, async (_req, reply) => {
    const configs = await getGameConfigs();
    return reply.send({ data: configs });
  });

  // ── Monitoring / history / analytics ──────────────────────────────────────

  // GET /api/v1/admin/games/monitoring — live active-round snapshot
  app.get("/monitoring", { onRequest: [requirePermission("admin.games.view")] }, async (_req, reply) => {
    const data = await getGameMonitoring();
    return reply.send({ data });
  });

  // GET /api/v1/admin/games/history — paginated settled-bet history
  app.get("/history", { onRequest: [requirePermission("admin.games.view")] }, async (req, reply) => {
    const { cursor, limit, gameType } = HistoryQuerySchema.parse(req.query);
    const data = await getGameHistory({ cursor, limit, gameType });
    return reply.send({ data });
  });

  // GET /api/v1/admin/games/analytics — platform revenue analytics (30d)
  app.get("/analytics", { onRequest: [requirePermission("admin.games.view")] }, async (_req, reply) => {
    const data = await getGameAnalytics();
    return reply.send({ data });
  });

  // ── Game-level config ──────────────────────────────────────────────────────

  // PATCH /api/v1/admin/games/:gameType — update enabled / maintenance / feeRate / roomMode
  app.patch("/:gameType", { onRequest: [requirePermission("admin.games.manage")] }, async (req, reply) => {
    const { gameType } = req.params as { gameType: string };
    const body = PatchGameSchema.parse(req.body);
    await updateGameConfig(gameType, req.user.sub, {
      enabled:     body.enabled,
      maintenance: body.maintenance,
      feeRate:     body.feeRate,
      roomMode:    body.roomMode,
    });
    const configs = await getGameConfigs();
    const updated = configs.find(c => c.gameType === gameType);
    return reply.send({ data: updated });
  });

  // ── Lobby management ───────────────────────────────────────────────────────

  // GET /api/v1/admin/games/:gameType/lobbies
  app.get("/:gameType/lobbies", { onRequest: [requirePermission("admin.games.view")] }, async (req, reply) => {
    const { gameType } = req.params as { gameType: string };
    const configs = await getGameConfigs();
    const game = configs.find(c => c.gameType === gameType);
    if (!game) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Game not found" } });
    return reply.send({ data: game.lobbies });
  });

  // POST /api/v1/admin/games/:gameType/lobbies
  app.post("/:gameType/lobbies", { onRequest: [requirePermission("admin.games.manage")] }, async (req, reply) => {
    const { gameType } = req.params as { gameType: string };
    const body = CreateLobbySchema.parse(req.body);
    const lobby = await createLobby(gameType, body.lobbyId, req.user.sub, body);
    return reply.status(201).send({ data: lobby });
  });

  // PATCH /api/v1/admin/games/:gameType/lobbies/:lobbyId
  app.patch("/:gameType/lobbies/:lobbyId", { onRequest: [requirePermission("admin.games.manage")] }, async (req, reply) => {
    const { gameType, lobbyId } = req.params as { gameType: string; lobbyId: string };
    const body = PatchLobbySchema.parse(req.body);
    await updateLobbyConfig(gameType, lobbyId, req.user.sub, body);
    const configs = await getGameConfigs();
    const game = configs.find(c => c.gameType === gameType);
    const lobby = game?.lobbies.find(l => l.lobbyId === lobbyId);
    return reply.send({ data: lobby });
  });

  // ── Lobby room management ──────────────────────────────────────────────────

  // GET /api/v1/admin/games/:gameType/lobbies/:lobbyId/rooms
  app.get("/:gameType/lobbies/:lobbyId/rooms", { onRequest: [requirePermission("admin.games.view")] }, async (req, reply) => {
    const { gameType, lobbyId } = req.params as { gameType: string; lobbyId: string };
    const rooms = await getLobbyRooms(gameType, lobbyId);
    return reply.send({ data: rooms });
  });

  // POST /api/v1/admin/games/:gameType/lobbies/:lobbyId/rooms
  app.post("/:gameType/lobbies/:lobbyId/rooms", { onRequest: [requirePermission("admin.games.manage")] }, async (req, reply) => {
    const { gameType, lobbyId } = req.params as { gameType: string; lobbyId: string };
    const body = CreateRoomSchema.parse(req.body);
    const room = await createLobbyRoom(gameType, lobbyId, req.user.sub, body);
    return reply.status(201).send({ data: room });
  });

  // PATCH /api/v1/admin/games/:gameType/lobbies/:lobbyId/rooms/:roomId
  app.patch("/:gameType/lobbies/:lobbyId/rooms/:roomId", { onRequest: [requirePermission("admin.games.manage")] }, async (req, reply) => {
    const { gameType, lobbyId, roomId } = req.params as { gameType: string; lobbyId: string; roomId: string };
    const body = UpdateRoomSchema.parse(req.body);
    const room = await updateLobbyRoom(gameType, lobbyId, roomId, req.user.sub, body);
    return reply.send({ data: room });
  });

  // DELETE /api/v1/admin/games/:gameType/lobbies/:lobbyId/rooms/:roomId
  app.delete("/:gameType/lobbies/:lobbyId/rooms/:roomId", { onRequest: [requirePermission("admin.games.manage")] }, async (req, reply) => {
    const { gameType, lobbyId, roomId } = req.params as { gameType: string; lobbyId: string; roomId: string };
    await deleteLobbyRoom(gameType, lobbyId, roomId, req.user.sub);
    return reply.status(204).send();
  });

  // ── Stake management ───────────────────────────────────────────────────────

  // GET /api/v1/admin/games/:gameType/stakes
  app.get("/:gameType/stakes", { onRequest: [requirePermission("admin.games.view")] }, async (req, reply) => {
    const { gameType } = req.params as { gameType: string };
    const configs = await getGameConfigs();
    const game = configs.find(c => c.gameType === gameType);
    if (!game) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Game not found" } });
    return reply.send({ data: game.stakes });
  });

  // PATCH /api/v1/admin/games/:gameType/stakes
  app.patch("/:gameType/stakes", { onRequest: [requirePermission("admin.games.manage")] }, async (req, reply) => {
    const { gameType } = req.params as { gameType: string };
    const { stakes } = PatchStakesSchema.parse(req.body);
    await updateGameStakes(gameType, stakes, req.user.sub);
    const configs = await getGameConfigs();
    const game = configs.find(c => c.gameType === gameType);
    return reply.send({ data: game?.stakes ?? [] });
  });

  // ── Stake room management ──────────────────────────────────────────────────

  // GET /api/v1/admin/games/:gameType/stakes/:stake/rooms
  app.get("/:gameType/stakes/:stake/rooms", { onRequest: [requirePermission("admin.games.view")] }, async (req, reply) => {
    const { gameType, stake } = req.params as { gameType: string; stake: string };
    const rooms = await getStakeRooms(gameType, Number(stake));
    return reply.send({ data: rooms });
  });

  // POST /api/v1/admin/games/:gameType/stakes/:stake/rooms
  app.post("/:gameType/stakes/:stake/rooms", { onRequest: [requirePermission("admin.games.manage")] }, async (req, reply) => {
    const { gameType, stake } = req.params as { gameType: string; stake: string };
    const body = CreateRoomSchema.parse(req.body);
    const room = await createStakeRoom(gameType, Number(stake), req.user.sub, body);
    return reply.status(201).send({ data: room });
  });

  // PATCH /api/v1/admin/games/:gameType/stakes/:stake/rooms/:roomId
  app.patch("/:gameType/stakes/:stake/rooms/:roomId", { onRequest: [requirePermission("admin.games.manage")] }, async (req, reply) => {
    const { gameType, stake, roomId } = req.params as { gameType: string; stake: string; roomId: string };
    const body = UpdateRoomSchema.parse(req.body);
    const room = await updateStakeRoom(gameType, Number(stake), roomId, req.user.sub, body);
    return reply.send({ data: room });
  });

  // DELETE /api/v1/admin/games/:gameType/stakes/:stake/rooms/:roomId
  app.delete("/:gameType/stakes/:stake/rooms/:roomId", { onRequest: [requirePermission("admin.games.manage")] }, async (req, reply) => {
    const { gameType, stake, roomId } = req.params as { gameType: string; stake: string; roomId: string };
    await deleteStakeRoom(gameType, Number(stake), roomId, req.user.sub);
    return reply.status(204).send();
  });
}
