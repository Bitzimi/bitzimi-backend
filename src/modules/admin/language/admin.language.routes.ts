import { FastifyInstance } from "fastify";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import {
  listAllLanguages, getLanguage, createLanguage, updateLanguage, deleteLanguage,
} from "./admin.language.service";

export async function adminLanguageRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/admin/language — list all languages (admin)
  app.get("/", { preHandler: [authenticate, requirePermission("admin.config.view")] }, async (_req, reply) => {
    return reply.send({ data: await listAllLanguages() });
  });

  // GET /api/v1/admin/language/:code
  app.get("/:code", { preHandler: [authenticate, requirePermission("admin.config.view")] }, async (req, reply) => {
    const { code } = req.params as { code: string };
    const lang = await getLanguage(code);
    if (!lang) return reply.status(404).send({ error: { message: "Language not found" } });
    return reply.send({ data: lang });
  });

  // POST /api/v1/admin/language — create
  app.post("/", { preHandler: [authenticate, requirePermission("admin.config.edit")] }, async (req, reply) => {
    const body = req.body as any;
    if (!body?.code || !body?.name) {
      return reply.status(400).send({ error: { message: "code and name are required" } });
    }
    try {
      const lang = await createLanguage(body);
      return reply.status(201).send({ data: lang });
    } catch (e: any) {
      return reply.status(400).send({ error: { message: e.message } });
    }
  });

  // PATCH /api/v1/admin/language/:code — update
  app.patch("/:code", { preHandler: [authenticate, requirePermission("admin.config.edit")] }, async (req, reply) => {
    const { code } = req.params as { code: string };
    try {
      const lang = await updateLanguage(code, req.body as any);
      return reply.send({ data: lang });
    } catch (e: any) {
      const status = e.message.includes("not found") ? 404 : 400;
      return reply.status(status).send({ error: { message: e.message } });
    }
  });

  // DELETE /api/v1/admin/language/:code
  app.delete("/:code", { preHandler: [authenticate, requirePermission("admin.config.edit")] }, async (req, reply) => {
    const { code } = req.params as { code: string };
    try {
      await deleteLanguage(code);
      return reply.status(204).send();
    } catch (e: any) {
      return reply.status(400).send({ error: { message: e.message } });
    }
  });
}
