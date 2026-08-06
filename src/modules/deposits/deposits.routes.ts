import { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/authenticate";
import { CreateDepositSchema } from "./deposits.schemas";
import { createDeposit, listDeposits, getDeposit, cancelDeposit, getCryptoDepositInfo } from "./deposits.service";
import { db } from "../../db";

export async function depositsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/deposits/crypto-info
  // Returns wallet address + network metadata for the current user.
  // Never exposes RPC endpoint, private keys, or blockchain configuration.
  app.get("/crypto-info", async (req, reply) => {
    const active = await db.deposit.findFirst({
      where: {
        userId: req.user.sub,
        paymentMethod: "crypto",
        status: { in: ["pending", "confirming"] },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
    const data = await getCryptoDepositInfo(
      active ? parseFloat(String(active.memoAmount)) : undefined,
      active ? active.expiresAt.toISOString() : undefined,
    );
    return reply.send({ data });
  });

  // POST /api/v1/deposits
  app.post("/", async (req, reply) => {
    const body = CreateDepositSchema.parse(req.body);
    const data = await createDeposit(req.user.sub, body);
    return reply.status(201).send({ data });
  });

  // GET /api/v1/deposits
  app.get("/", async (req, reply) => {
    const data = await listDeposits(req.user.sub);
    return reply.send({ data });
  });

  // GET /api/v1/deposits/:id
  app.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const data   = await getDeposit(req.user.sub, id);
    return reply.send({ data });
  });

  // DELETE /api/v1/deposits/:id  (cancel pending)
  app.delete("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await cancelDeposit(req.user.sub, id);
    return reply.status(204).send();
  });
}
