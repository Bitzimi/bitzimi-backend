import { FastifyRequest, FastifyReply } from "fastify";
import { verifyAccessToken, AccessTokenPayload } from "../utils/jwt";
declare module "fastify" { interface FastifyRequest { user: AccessTokenPayload; } }
export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) {
    reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Missing authorization header" } });
    return; // explicit return — Fastify stops lifecycle after reply.send() in hooks
  }
  try {
    req.user = verifyAccessToken(h.slice(7));
  } catch {
    reply.status(401).send({ error: { code: "TOKEN_INVALID", message: "Invalid or expired access token" } });
    return; // explicit return — prevents any code after catch from running
  }
}
