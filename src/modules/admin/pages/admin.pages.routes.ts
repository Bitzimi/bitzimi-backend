import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import {
  adminListPages,
  adminGetPage,
  adminCreatePage,
  adminUpdatePage,
  adminPublishPage,
  adminUnpublishPage,
  adminDeletePage,
  seedDefaultPages,
} from "./admin.pages.service";

export async function adminPagesRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/admin/pages
  app.get("/", { onRequest: [requirePermission("admin.pages.view")] }, async (req, reply) => {
    const query = z.object({
      status: z.enum(["draft", "published"]).optional(),
      search: z.string().optional(),
    }).parse(req.query);
    const data = await adminListPages(query);
    return reply.send({ data });
  });

  // GET /api/v1/admin/pages/:id
  app.get("/:id", { onRequest: [requirePermission("admin.pages.view")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = await adminGetPage(id);
    return reply.send({ data });
  });

  // POST /api/v1/admin/pages
  app.post("/", { onRequest: [requirePermission("admin.pages.edit")] }, async (req, reply) => {
    const body = z.object({
      slug:      z.string().min(1).max(100),
      title:     z.string().min(1).max(300),
      body:      z.string().min(1),
      sortOrder: z.number().int().optional(),
    }).parse(req.body);
    const data = await adminCreatePage(body, req.user.sub);
    return reply.status(201).send({ data });
  });

  // PUT /api/v1/admin/pages/:id
  app.put("/:id", { onRequest: [requirePermission("admin.pages.edit")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      title:     z.string().min(1).max(300).optional(),
      body:      z.string().min(1).optional(),
      slug:      z.string().max(100).optional(),
      sortOrder: z.number().int().optional(),
    }).parse(req.body);
    const data = await adminUpdatePage(id, body, req.user.sub);
    return reply.send({ data });
  });

  // POST /api/v1/admin/pages/:id/publish
  app.post("/:id/publish", { onRequest: [requirePermission("admin.pages.edit")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = await adminPublishPage(id, req.user.sub);
    return reply.send({ data });
  });

  // POST /api/v1/admin/pages/:id/unpublish
  app.post("/:id/unpublish", { onRequest: [requirePermission("admin.pages.edit")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = await adminUnpublishPage(id, req.user.sub);
    return reply.send({ data });
  });

  // DELETE /api/v1/admin/pages/:id
  app.delete("/:id", { onRequest: [requirePermission("admin.pages.edit")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = await adminDeletePage(id);
    return reply.send({ data });
  });

  // POST /api/v1/admin/pages/seed — initialise system pages
  app.post("/seed", { onRequest: [requirePermission("admin.pages.edit")] }, async (req, reply) => {
    await seedDefaultPages(req.user.sub);
    const data = await adminListPages({});
    return reply.send({ data });
  });
}
