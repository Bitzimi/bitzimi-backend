/**
 * Audit Log Middleware — records every admin mutation to the DB.
 *
 * Registered as an onResponse hook on all admin route plugins.
 * Phase 1: adds metadata (sanitised request body) and httpStatus fields.
 */
import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../db";

export async function auditLogHook(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  // Only log mutating requests from authenticated admin users
  if (!["POST","PATCH","PUT","DELETE"].includes(request.method)) return;
  if (!request.user?.sub) return;

  const params     = (request.params as Record<string, string>) ?? {};
  const action     = `${request.method} ${(request as any).routeOptions?.url ?? request.url}`;
  const httpStatus = reply.statusCode;

  // Infer targetType and targetId from route params (more reliable than URL matching)
  let targetType: string | null = null;
  let targetId:   string | null = null;

  if (params.userId)       { targetId = params.userId;       targetType = "user"; }
  if (params.id)           { targetId = params.id; }
  if (params.submissionId) { targetId = params.submissionId; }
  if (params.reviewId)     { targetId = params.reviewId; }
  if (params.key)          { targetId = params.key; }

  const url = request.url;
  if (!targetType) {
    if      (url.includes("/kyc"))           targetType = "kyc_submission";
    else if (url.includes("/proofs"))        targetType = "task_proof";
    else if (url.includes("/tasks"))         targetType = "task";
    else if (url.includes("/withdrawals"))   targetType = "withdrawal";
    else if (url.includes("/deposits"))      targetType = "deposit";
    else if (url.includes("/users"))         targetType = "user";
    else if (url.includes("/games"))         targetType = "game";
    else if (url.includes("/notifications")) targetType = "notification";
    else if (url.includes("/config"))        targetType = "system_config";
  }

  // Build metadata: sanitise request body (redact sensitive fields)
  let metadata: string | null = null;
  try {
    const body = (request as any).body;
    if (body && typeof body === "object") {
      const safe = { ...body };
      for (const k of ["password", "pin", "newPin", "confirmPin", "privateKey", "secret", "token"]) {
        delete safe[k];
      }
      if (Object.keys(safe).length > 0) {
        metadata = JSON.stringify({ body: safe });
      }
    }
  } catch { /* ignore */ }

  // Read previousValue/newValue if the route handler set them on the reply
  const previousValue: string | null = (reply as any).__auditPreviousValue ?? null;
  const newValue:      string | null = (reply as any).__auditNewValue      ?? null;

  // Fire-and-forget — never block the response
  setImmediate(() =>
    db.auditLog.create({
      data: {
        actorId:   request.user.sub,
        action,
        targetType,
        targetId,
        ipAddress: request.ip ?? null,
        userAgent: (request.headers["user-agent"] as string | undefined) ?? null,
        metadata,
        previousValue,
        newValue,
        httpStatus,
      },
    }).catch(err => console.error("[AuditLog]", err))
  );
}
