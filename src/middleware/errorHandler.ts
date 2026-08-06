import { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ZodError) {
    return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Validation failed", details: error.errors } });
  }
  if (error.statusCode && error.statusCode < 500) {
    return reply.status(error.statusCode).send({ error: { code: error.code ?? "REQUEST_ERROR", message: error.message } });
  }
  request.log.error({ err: error }, "Unhandled error");
  reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } });
}
