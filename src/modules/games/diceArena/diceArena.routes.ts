import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { getArenaRound, joinArenaRound } from "./diceArena.service";

export async function diceArenaRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  app.get("/rounds", async (req, reply) => {
    const q = z.object({ stake: z.coerce.number().positive() }).parse(req.query);
    return reply.send({ data: await getArenaRound(q.stake) });
  });

  app.get("/rounds/:roundId", async (req, reply) => {
    const { roundId } = req.params as { roundId: string };
    const { db } = await import("../../../db");
    const dbRound = await db.diceRound.findUnique({ where: { id: roundId } });
    if (!dbRound) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Round not found" } });
    return reply.send({ data: await getArenaRound(dbRound.stake) });
  });

  app.post("/rounds/:roundId/join", async (req, reply) => {
    const body = z.object({ stake: z.number().positive() }).parse(req.body);
    return reply.status(201).send({ data: await joinArenaRound(req.user.sub, body.stake) });
  });
}
