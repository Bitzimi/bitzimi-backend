import { FastifyInstance } from "fastify";
import { authenticate as requireAuth } from "../../../middleware/authenticate";
import {
  createRoom,
  getRoom,
  joinRoom,
  startMatch,
  signalRematch,
  declineRematch,
  getMyActiveRoom,
  cancelRoom,
} from "./privateRoom.service";

export async function privateRoomRoutes(app: FastifyInstance) {
  // POST /api/v1/games/private-rooms — create a new private room
  app.post("/private-rooms", { preHandler: requireAuth }, async (req, reply) => {
    const { gameType, stake } = req.body as { gameType?: string; stake?: number };
    if (!gameType || typeof stake !== "number") {
      return reply.status(400).send({ error: { message: "gameType and stake are required", code: "VALIDATION" } });
    }
    try {
      const room = await createRoom(req.user.sub, gameType, stake);
      return reply.status(201).send({ data: room });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: { message: err.message, code: err.code ?? "INTERNAL" } });
    }
  });

  // GET /api/v1/games/private-rooms/my/active — get caller's active room (if any)
  // NOTE: this route must be registered BEFORE /:code to avoid "my" being matched as a code
  app.get("/private-rooms/my/active", { preHandler: requireAuth }, async (req, reply) => {
    try {
      const room = await getMyActiveRoom(req.user.sub);
      return reply.send({ data: room });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: { message: err.message, code: err.code ?? "INTERNAL" } });
    }
  });

  // GET /api/v1/games/private-rooms/:code — get room state
  app.get("/private-rooms/:code", { preHandler: requireAuth }, async (req, reply) => {
    const { code } = req.params as { code: string };
    try {
      const room = await getRoom(code.toUpperCase(), req.user.sub);
      return reply.send({ data: room });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: { message: err.message, code: err.code ?? "INTERNAL" } });
    }
  });

  // POST /api/v1/games/private-rooms/:code/join — guest joins a room
  app.post("/private-rooms/:code/join", { preHandler: requireAuth }, async (req, reply) => {
    const { code } = req.params as { code: string };
    try {
      const room = await joinRoom(code.toUpperCase(), req.user.sub);
      return reply.send({ data: room });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: { message: err.message, code: err.code ?? "INTERNAL" } });
    }
  });

  // POST /api/v1/games/private-rooms/:code/start — start the match
  app.post("/private-rooms/:code/start", { preHandler: requireAuth }, async (req, reply) => {
    const { code } = req.params as { code: string };
    try {
      const result = await startMatch(code.toUpperCase(), req.user.sub);
      return reply.send({ data: result });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: { message: err.message, code: err.code ?? "INTERNAL" } });
    }
  });

  // POST /api/v1/games/private-rooms/:code/rematch — signal rematch readiness
  app.post("/private-rooms/:code/rematch", { preHandler: requireAuth }, async (req, reply) => {
    const { code } = req.params as { code: string };
    try {
      const result = await signalRematch(code.toUpperCase(), req.user.sub);
      return reply.send({ data: result });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: { message: err.message, code: err.code ?? "INTERNAL" } });
    }
  });

  // DELETE /api/v1/games/private-rooms/:code/rematch — decline rematch
  app.delete("/private-rooms/:code/rematch", { preHandler: requireAuth }, async (req, reply) => {
    const { code } = req.params as { code: string };
    try {
      const room = await declineRematch(code.toUpperCase(), req.user.sub);
      return reply.send({ data: room });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: { message: err.message, code: err.code ?? "INTERNAL" } });
    }
  });

  // DELETE /api/v1/games/private-rooms/:code — cancel room (host only)
  app.delete("/private-rooms/:code", { preHandler: requireAuth }, async (req, reply) => {
    const { code } = req.params as { code: string };
    try {
      await cancelRoom(code.toUpperCase(), req.user.sub);
      return reply.send({ data: { cancelled: true } });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: { message: err.message, code: err.code ?? "INTERNAL" } });
    }
  });
}
