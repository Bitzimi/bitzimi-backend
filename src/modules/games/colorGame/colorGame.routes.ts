import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { getAllLobbyStates, getLobbyState, placeBet } from "./colorGame.service";
import { leaveLobbyPresence, touchLobbyPresence } from "./colorGame.presence";


export async function colorGameRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  app.get("/lobbies", async (_req, reply) => {
    return reply.send({ data: await getAllLobbyStates() });
  });

  app.get("/lobbies/:lobby", async (req, reply) => {
    const { lobby } = req.params as { lobby: string };
    const data = await getLobbyState(lobby.toUpperCase(), req.user.sub);
    return reply.send({ data });
  });

  app.post("/lobbies/:lobby/presence", async (req, reply) => {
    const { lobby } = req.params as { lobby: string };
    const count = await touchLobbyPresence(req.user.sub, lobby);
    return reply.send({ data: { lobbyId: lobby.toUpperCase(), playerCount: count } });
  });

  app.delete("/lobbies/:lobby/presence", async (req, reply) => {
    const { lobby } = req.params as { lobby: string };
    await leaveLobbyPresence(req.user.sub, lobby);
    return reply.status(204).send();
  });

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
