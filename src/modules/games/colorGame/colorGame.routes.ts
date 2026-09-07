import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { getAllLobbyStates, getLobbyState, placeBet } from "./colorGame.service";
import { leaveLobbyPresence, touchLobbyPresence } from "./colorGame.presence";

export async function colorGameRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/games/color/lobbies — all lobby states (for lobby selection UI)
  app.get("/lobbies", async (_req, reply) => {
    return reply.send({ data: await getAllLobbyStates() });
  });

  // GET /api/v1/games/color/lobbies/:lobby — single lobby state
  app.get("/lobbies/:lobby", async (req, reply) => {
    const { lobby } = req.params as { lobby: string };
    return reply.send({ data: await getLobbyState(lobby.toUpperCase(), req.user.sub) });
  });

  // POST /api/v1/games/color/lobbies/:lobby/presence — enter/heartbeat.
  // The backend counts only users whose heartbeat is newer than the server TTL.
  app.post("/lobbies/:lobby/presence", async (req, reply) => {
    const { lobby } = req.params as { lobby: string };
    const count = await touchLobbyPresence(req.user.sub, lobby);
    return reply.send({ data: { lobbyId: lobby.toUpperCase(), playerCount: count } });
  });

  // DELETE /api/v1/games/color/lobbies/:lobby/presence — explicit leave.
  app.delete("/lobbies/:lobby/presence", async (req, reply) => {
    const { lobby } = req.params as { lobby: string };
    await leaveLobbyPresence(req.user.sub, lobby);
    return reply.status(204).send();
  });

  // POST /api/v1/games/color/bets — place a bet in an active lobby round
  app.post("/bets", async (req, reply) => {
    const body = z.object({
      lobbyId: z.enum(["A", "B", "C", "D"]),
      team: z.enum(["red", "blue"]),
      amount: z.number().positive(),
    }).parse(req.body);
    const data = await placeBet(req.user.sub, body.lobbyId, body.team, body.amount);
    return reply.status(201).send({ data });
  });
}
