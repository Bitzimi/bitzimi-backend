import { FastifyInstance } from "fastify";
import { z } from "zod";
import { RegisterSchema, LoginSchema, RefreshSchema, ForgotPasswordSchema, ResetPasswordSchema, VerifyEmailSchema, SendVerificationSchema } from "./auth.schemas";
import { registerUser, loginUser, loginWith2FA, refreshTokens, logoutUser, forgotPassword, resetPassword, sendVerificationEmail, verifyEmail } from "./auth.service";

export async function authRoutes(app: FastifyInstance) {
  app.post("/register",          async (req, reply) => reply.status(201).send({ data: await registerUser(RegisterSchema.parse(req.body)) }));
  app.post("/login",             async (req, reply) => reply.send({ data: await loginUser({ ...LoginSchema.parse(req.body), ipAddress: req.ip, userAgent: req.headers["user-agent"] ?? undefined }) }));
  app.post("/refresh",           async (req, reply) => reply.send({ data: await refreshTokens(RefreshSchema.parse(req.body).refreshToken) }));
  app.post("/logout",            async (req, reply) => { await logoutUser(z.object({ refreshToken: z.string() }).parse(req.body).refreshToken); return reply.status(204).send(); });
  app.post("/forgot-password",   async (req, reply) => { await forgotPassword(ForgotPasswordSchema.parse(req.body).email); return reply.status(204).send(); });
  app.post("/reset-password",    async (req, reply) => { const b = ResetPasswordSchema.parse(req.body); await resetPassword(b.token, b.newPassword); return reply.status(204).send(); });
  app.post("/verify-email",      async (req, reply) => { await verifyEmail(VerifyEmailSchema.parse(req.body).token); return reply.status(204).send(); });
  app.post("/send-verification", async (req, reply) => { await sendVerificationEmail(SendVerificationSchema.parse(req.body).email); return reply.status(204).send(); });

  // POST /api/v1/auth/2fa-challenge — complete login when 2FA is required
  app.post("/2fa-challenge", async (req, reply) => {
    const body = z.object({
      twoFactorToken: z.string(),
      totpCode:       z.string().length(6).regex(/^\d{6}$/),
    }).parse(req.body);
    const tokens = await loginWith2FA({
      twoFactorToken: body.twoFactorToken,
      totpCode:       body.totpCode,
      ipAddress:      req.ip,
      userAgent:      req.headers["user-agent"] ?? undefined,
    });
    return reply.send({ data: tokens });
  });
}
