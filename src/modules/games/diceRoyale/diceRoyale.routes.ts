import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { getRoyaleRound, joinRoyaleRound, leaveRoyaleRound } from "./diceRoyale.service";

export async function diceRoyaleRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/games/dice-royale/rounds?stake=X — view current open round
  app.get("/rounds", async (req, reply) => {
    const q = z.object({ stake: z.coerce.number().positive() }).parse(req.query);
    return reply.send({ data: await getRoyaleRound(q.stake) });
  });

  // GET /api/v1/games/dice-royale/rounds/:roundId — poll round state
  app.get("/rounds/:roundId", async (req, reply) => {
    const { roundId } = req.params as { roundId: string };
    // Find the round by ID across all stake levels
    const { db } = await import("../../../db");
    const dbRound = await db.diceRound.findUnique({ where: { id: roundId } });
    if (!dbRound) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Round not found" } });
    const data = await getRoyaleRound(dbRound.stake);
    return reply.send({ data });
  });

  // POST /api/v1/games/dice-royale/rounds/:roundId/join — manual join (no auto-join)
  app.post("/rounds/:roundId/join", async (req, reply) => {
    // Accept stake in body — roundId in path is informational
    const body = z.object({ stake: z.number().positive() }).parse(req.body);
    return reply.status(201).send({ data: await joinRoyaleRound(req.user.sub, body.stake) });
  });

  // DELETE /api/v1/games/dice-royale/rounds/:roundId/leave — leave before countdown
  app.delete("/rounds/:roundId/leave", async (req, reply) => {
    const { roundId } = req.params as { roundId: string };
    await leaveRoyaleRound(req.user.sub, roundId);
    return reply.status(204).send();
  });
}
