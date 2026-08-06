import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import {
  adminListContent,
  adminGetContent,
  adminCreateContent,
  adminUpdateContent,
  adminPublishContent,
  adminUnpublishContent,
  adminDeleteContent,
  type ContentCategory,
  type ContentStatus,
} from "./admin.content.service";

const CATEGORY = z.enum(["faq", "help", "blog", "announcement"]);
const STATUS   = z.enum(["draft", "published"]);

export async function adminContentRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/admin/content
  app.get("/", { onRequest: [requirePermission("admin.content.view")] }, async (req, reply) => {
    const query = z.object({
      category: CATEGORY.optional(),
      status:   STATUS.optional(),
      search:   z.string().optional(),
      cursor:   z.string().optional(),
      limit:    z.string().transform(Number).optional(),
    }).parse(req.query);
    const data = await adminListContent(query as any);
    return reply.send({ data });
  });

  // GET /api/v1/admin/content/:id
  app.get("/:id", { onRequest: [requirePermission("admin.content.view")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = await adminGetContent(id);
    return reply.send({ data });
  });

  // POST /api/v1/admin/content
  app.post("/", { onRequest: [requirePermission("admin.content.edit")] }, async (req, reply) => {
    const body = z.object({
      category: CATEGORY,
      title:    z.string().min(1).max(300),
      body:     z.string().min(1),
      excerpt:  z.string().max(500).optional(),
      slug:     z.string().max(100).optional(),
    }).parse(req.body);
    const adminId = req.user.sub;
    const data = await adminCreateContent(body, adminId);
    return reply.status(201).send({ data });
  });

  // PUT /api/v1/admin/content/:id
  app.put("/:id", { onRequest: [requirePermission("admin.content.edit")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      title:   z.string().min(1).max(300).optional(),
      body:    z.string().min(1).optional(),
      excerpt: z.string().max(500).nullable().optional(),
      slug:    z.string().max(100).optional(),
    }).parse(req.body);
    const adminId = req.user.sub;
    const data = await adminUpdateContent(id, body, adminId);
    return reply.send({ data });
  });

  // POST /api/v1/admin/content/:id/publish
  app.post("/:id/publish", { onRequest: [requirePermission("admin.content.edit")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = await adminPublishContent(id, req.user.sub);
    return reply.send({ data });
  });

  // POST /api/v1/admin/content/:id/unpublish
  app.post("/:id/unpublish", { onRequest: [requirePermission("admin.content.edit")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = await adminUnpublishContent(id, req.user.sub);
    return reply.send({ data });
  });

  // DELETE /api/v1/admin/content/:id
  app.delete("/:id", { onRequest: [requirePermission("admin.content.edit")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = await adminDeleteContent(id);
    return reply.send({ data });
  });
}
