import { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/authenticate";
import { UploadDocumentSchema, SubmitKycBody } from "./kyc.schemas";
import {
  uploadKycDocument, submitKyc, getKycStatus, SUPPORTED_COUNTRIES,
} from "./kyc.service";

export async function kycRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/kyc/countries — supported countries + accepted ID types
  // No auth required — useful for the registration page
  app.get("/countries", async (_req, reply) => {
    return reply.send({ data: SUPPORTED_COUNTRIES });
  });

  // GET /api/v1/kyc — current user's KYC status
  app.get("/", async (req, reply) => {
    const data = await getKycStatus(req.user.sub);
    return reply.send({ data });
  });

  // POST /api/v1/kyc/documents/front
  app.post("/documents/front", async (req, reply) => {
    const { dataUrl } = UploadDocumentSchema.parse(req.body);
    const data = await uploadKycDocument(req.user.sub, "front", dataUrl);
    return reply.status(201).send({ data });
  });

  // POST /api/v1/kyc/documents/back
  app.post("/documents/back", async (req, reply) => {
    const { dataUrl } = UploadDocumentSchema.parse(req.body);
    const data = await uploadKycDocument(req.user.sub, "back", dataUrl);
    return reply.status(201).send({ data });
  });

  // POST /api/v1/kyc/documents/selfie
  app.post("/documents/selfie", async (req, reply) => {
    const { dataUrl } = UploadDocumentSchema.parse(req.body);
    const data = await uploadKycDocument(req.user.sub, "selfie", dataUrl);
    return reply.status(201).send({ data });
  });

  // POST /api/v1/kyc/documents/poa  (proof of address)
  app.post("/documents/poa", async (req, reply) => {
    const { dataUrl } = UploadDocumentSchema.parse(req.body);
    const data = await uploadKycDocument(req.user.sub, "poa", dataUrl);
    return reply.status(201).send({ data });
  });

  // POST /api/v1/kyc — submit all document keys + personal info
  app.post("/", async (req, reply) => {
    const body = SubmitKycBody.parse(req.body);
    const data = await submitKyc(req.user.sub, body);
    return reply.status(202).send({   // 202 Accepted — verification is async
      data,
      message: "KYC submitted. Verification is in progress. Poll GET /api/v1/users/me for status updates.",
    });
  });
}
