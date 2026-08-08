import { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/authenticate";
import { SubmitWithdrawalSchema } from "./withdrawals.schemas";
import {
  submitWithdrawal, listWithdrawals,
  getWithdrawal, getWithdrawalLimits,
} from "./withdrawals.service";

export async function withdrawalsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/withdrawals/limits — must be registered BEFORE /:id
  app.get("/limits", async (req, reply) => {
    const data = await getWithdrawalLimits(req.user.sub);
    return reply.send({ data });
  });

  // POST /api/v1/withdrawals
  app.post("/", async (req, reply) => {
    const body = SubmitWithdrawalSchema.parse(req.body);
    const data = await submitWithdrawal(req.user.sub, body);
    return reply.status(201).send({ data });
  });

  // GET /api/v1/withdrawals
  app.get("/", async (req, reply) => {
    const data = await listWithdrawals(req.user.sub);
    return reply.send({ data });
  });

  // GET /api/v1/withdrawals/:id
  app.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const data   = await getWithdrawal(req.user.sub, id);
    return reply.send({ data });
  });
}
