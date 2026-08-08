import { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/authenticate";
import { WalletTypeParam, TransferSchema } from "./wallets.schemas";
import { getWallets, getWallet, transferBetweenWallets, WalletType } from "./wallets.service";

export async function walletsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/wallets
  app.get("/", async (req, reply) =>
    reply.send({ data: await getWallets(req.user.sub) }));

  // GET /api/v1/wallets/:type
  app.get("/:type", async (req, reply) => {
    const { type } = WalletTypeParam.parse(req.params);
    return reply.send({ data: await getWallet(req.user.sub, type as WalletType) });
  });

  // POST /api/v1/wallets/transfer — atomic debit + credit in one DB transaction
  app.post("/transfer", async (req, reply) => {
    const { from, to, amount } = TransferSchema.parse(req.body);
    await transferBetweenWallets(req.user.sub, from as WalletType, to as WalletType, amount);
    const updated = await getWallets(req.user.sub);
    return reply.status(200).send({ data: updated });
  });
}
