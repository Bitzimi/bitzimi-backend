import { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/authenticate";
import { ListTransactionsQuery } from "./transactions.schemas";
import { listTransactions, getTransaction } from "./transactions.service";

export async function transactionsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/transactions
  app.get("/", async (req, reply) => {
    const query = ListTransactionsQuery.parse(req.query);
    const data  = await listTransactions(req.user.sub, query);
    return reply.send({ data });
  });

  // GET /api/v1/transactions/:id
  app.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const data   = await getTransaction(req.user.sub, id);
    return reply.send({ data });
  });
}
