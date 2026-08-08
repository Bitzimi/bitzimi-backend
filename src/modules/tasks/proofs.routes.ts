import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { submitProof, getMyProof } from "./proofs.service";

export async function proofsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/tasks/:id/proofs/me — poll for verification status
  app.get("/:id/proofs/me", async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = await getMyProof(req.user.sub, id);
    return reply.send({ data });
  });

  // POST /api/v1/tasks/:id/proofs — submit proof screenshots
  app.post("/:id/proofs", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      screenshotDataUrls: z.array(z.string().min(1)).min(1).max(3),
      proofNote:          z.string().max(500).optional(),
      proofLink:          z.string().url().optional(),
    }).parse(req.body);
    const data = await submitProof(req.user.sub, id, body);
    return reply.status(202).send({   // 202: AI verification is async
      data,
      message: "Proof submitted. Poll GET /api/v1/tasks/:id/proofs/me for verification result.",
    });
  });
}
