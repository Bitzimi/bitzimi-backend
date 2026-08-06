import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import {
  adminListText,
  adminListTextPages,
  adminSetText,
  adminResetText,
} from "./admin.text.service";

export async function adminTextRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/admin/text/pages — list distinct page groups
  app.get("/pages", { onRequest: [requirePermission("admin.text.view")] }, async (_req, reply) => {
    const data = await adminListTextPages();
    return reply.send({ data });
  });

  // GET /api/v1/admin/text
  app.get("/", { onRequest: [requirePermission("admin.text.view")] }, async (req, reply) => {
    const query = z.object({
      page:   z.string().optional(),
      search: z.string().optional(),
    }).parse(req.query);
    const data = await adminListText(query);
    return reply.send({ data });
  });

  // PUT /api/v1/admin/text/:key — update a text entry
  app.put("/:key", { onRequest: [requirePermission("admin.text.edit")] }, async (req, reply) => {
    const key  = (req.params as any).key as string;
    const body = z.object({ value: z.string() }).parse(req.body);
    const data = await adminSetText(key, body.value, req.user.sub);
    return reply.send({ data });
  });

  // POST /api/v1/admin/text/:key/reset — reset to default
  app.post("/:key/reset", { onRequest: [requirePermission("admin.text.edit")] }, async (req, reply) => {
    const key  = (req.params as any).key as string;
    const data = await adminResetText(key, req.user.sub);
    return reply.send({ data });
  });
}
