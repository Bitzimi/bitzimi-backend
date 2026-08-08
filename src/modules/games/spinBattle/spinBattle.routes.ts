import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { getSpinLobbyStates, getSpinLobbyState, joinSpinLobby } from "./spinBattle.service";

export async function spinBattleRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/games/spin/lobbies — all lobbies (lobby selection screen)
  app.get("/lobbies", async (_req, reply) => {
    return reply.send({ data: await getSpinLobbyStates() });
  });

  // GET /api/v1/games/spin/lobbies/:lobby — single lobby state (polled by game page)
  // Returns enriched state: player list with usernames, myBet, recentWinners, winnerPayout.
  app.get("/lobbies/:lobby", async (req, reply) => {
    const { lobby } = req.params as { lobby: string };
    return reply.send({ data: await getSpinLobbyState(lobby.toUpperCase(), req.user.sub) });
  });

  // POST /api/v1/games/spin/lobbies/:lobby/join — join with chosen bet amount
  // Body: { amount: number } — must be within the lobby's minBet–maxBet range
  app.post("/lobbies/:lobby/join", async (req, reply) => {
    const { lobby }  = req.params as { lobby: string };
    const { amount } = z.object({ amount: z.number().positive() }).parse(req.body);
    return reply.status(201).send({ data: await joinSpinLobby(req.user.sub, lobby.toUpperCase(), amount) });
  });
}
