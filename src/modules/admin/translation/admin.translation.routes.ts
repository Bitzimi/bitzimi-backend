import { FastifyInstance } from "fastify";
import { authenticate } from "../../../middleware/authenticate";
import { requirePermission } from "../admin.middleware";
import {
  listTranslationKeys, upsertTranslationKey, deleteTranslationKey,
  getTranslationSummary, getMissingTranslations, getTranslationsForLanguage,
  bulkImportTranslations, upsertTranslation, autoTranslateLanguage,
  getPendingTranslations, setTranslationApproval, approveAllAutoTranslated,
  getTranslationHistory,
} from "./admin.translation.service";

export async function adminTranslationRoutes(app: FastifyInstance): Promise<void> {
  const viewGuard  = [authenticate, requirePermission("admin.config.view")];
  const editGuard  = [authenticate, requirePermission("admin.config.edit")];

  // GET /summary — completion stats for all languages
  app.get("/summary", { preHandler: viewGuard }, async (_req, reply) => {
    return reply.send({ data: await getTranslationSummary() });
  });

  // GET /keys — all translation keys
  app.get("/keys", { preHandler: viewGuard }, async (_req, reply) => {
    return reply.send({ data: await listTranslationKeys() });
  });

  // POST /keys — create or update a translation key
  app.post("/keys", { preHandler: editGuard }, async (req, reply) => {
    const body = req.body as any;
    if (!body?.key || !body?.defaultValue) {
      return reply.status(400).send({ error: { message: "key and defaultValue are required" } });
    }
    await upsertTranslationKey(body.key, body.defaultValue, body.namespace, body.description);
    return reply.status(201).send({ data: { key: body.key } });
  });

  // DELETE /keys/:key
  app.delete("/keys/:key", { preHandler: editGuard }, async (req, reply) => {
    const { key } = req.params as { key: string };
    try {
      await deleteTranslationKey(key);
      return reply.status(204).send();
    } catch (e: any) {
      return reply.status(404).send({ error: { message: e.message } });
    }
  });

  // GET /:lang/missing — keys not yet translated for a language
  app.get("/:lang/missing", { preHandler: viewGuard }, async (req, reply) => {
    const { lang } = req.params as { lang: string };
    return reply.send({ data: await getMissingTranslations(lang) });
  });

  // GET /:lang/export — full bundle for download / API consumption
  app.get("/:lang/export", { preHandler: viewGuard }, async (req, reply) => {
    const { lang } = req.params as { lang: string };
    return reply.send({ data: await getTranslationsForLanguage(lang) });
  });

  // POST /:lang/import — bulk import { key: value } JSON
  app.post("/:lang/import", { preHandler: editGuard }, async (req, reply) => {
    const { lang } = req.params as { lang: string };
    const body = req.body as any;
    if (!body?.bundle || typeof body.bundle !== "object") {
      return reply.status(400).send({ error: { message: "body.bundle must be a { key: value } object" } });
    }
    const count = await bulkImportTranslations(lang, body.bundle, false);
    return reply.send({ data: { imported: count } });
  });

  // POST /:lang/auto — AI auto-translate
  app.post("/:lang/auto", { preHandler: editGuard }, async (req, reply) => {
    const { lang } = req.params as { lang: string };
    const body = req.body as any;
    const targetLanguage = body?.targetLanguage ?? lang;
    const missingOnly = body?.missingOnly !== false;
    try {
      const result = await autoTranslateLanguage(lang, targetLanguage, missingOnly);
      return reply.send({ data: result });
    } catch (e: any) {
      return reply.status(500).send({ error: { message: e.message } });
    }
  });

  // PUT /:lang/:key — update a single translation value
  app.put("/:lang/:key", { preHandler: editGuard }, async (req, reply) => {
    const { lang, key } = req.params as { lang: string; key: string };
    const body = req.body as any;
    if (typeof body?.value !== "string") {
      return reply.status(400).send({ error: { message: "body.value (string) is required" } });
    }
    await upsertTranslation(lang, key, body.value, false);
    return reply.send({ data: { lang, key, value: body.value } });
  });

  // GET /:lang/pending — auto-translated but not yet approved
  app.get("/:lang/pending", { preHandler: viewGuard }, async (req, reply) => {
    const { lang } = req.params as { lang: string };
    return reply.send({ data: await getPendingTranslations(lang) });
  });

  // PATCH /:lang/:key/approve — approve or reject a single translation
  app.patch("/:lang/:key/approve", { preHandler: editGuard }, async (req, reply) => {
    const { lang, key } = req.params as { lang: string; key: string };
    const body = req.body as any;
    const approved = body?.approved !== false; // default true
    try {
      await setTranslationApproval(lang, key, approved);
      return reply.send({ data: { lang, key, approved } });
    } catch (e: any) {
      return reply.status(404).send({ error: { message: e.message } });
    }
  });

  // POST /:lang/approve-all — approve all auto-translated for a language
  app.post("/:lang/approve-all", { preHandler: editGuard }, async (req, reply) => {
    const { lang } = req.params as { lang: string };
    const count = await approveAllAutoTranslated(lang);
    return reply.send({ data: { approved: count } });
  });

  // GET /:lang/:key/history — version history for a single key
  app.get("/:lang/:key/history", { preHandler: viewGuard }, async (req, reply) => {
    const { lang, key } = req.params as { lang: string; key: string };
    return reply.send({ data: await getTranslationHistory(lang, key) });
  });
}
