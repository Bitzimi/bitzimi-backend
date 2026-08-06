import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { UpdateMeSchema, SetPinSchema, VerifyPinSchema } from "./users.schemas";
import { getMe, updateMe } from "./users.service";
import { setSecurityPin, verifySecurityPin } from "./pin.service";
import {
  getPreferences, updatePreferences,
  changePassword,
  getPaymentDetails, updatePaymentDetails,
  get2FAStatus, generate2FASecret, enable2FA, disable2FA,
} from "./settings.service";
import {
  getFullProfile, uploadAvatar, updateUsername, updatePhone, updateAddress,
} from "./profile.service";
import { deactivateAccount } from "./account.service";

// ── Validation schemas ─────────────────────────────────────────────────────────

const PreferencesSchema = z.object({
  themePref:    z.enum(["light","dark"]).optional(),
  languagePref: z.enum(["en","fr","es","pt","zh","hi","ru"]).optional(),
  currencyPref: z.enum(["USD","EUR","GBP","NGN","CNY","INR","ZAR","KES","RUB","TRY"]).optional(),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z.string().min(8).max(128),
});

const PaymentDetailsSchema = z.object({
  usdtAddress:       z.string().min(20).max(100).optional(),
  bankAccountName:   z.string().min(2).max(100).optional(),
  bankAccountNumber: z.string().regex(/^\d{6,20}$/).optional(),
  bankName:          z.string().min(2).max(100).optional(),
});

const Enable2FASchema  = z.object({ token: z.string().length(6).regex(/^\d{6}$/) });
const Verify2FASchema  = z.object({ token: z.string().length(6).regex(/^\d{6}$/) });

const AvatarSchema = z.object({
  dataUrl: z.string().min(10).startsWith("data:image/"),
});
const UpdateUsernameSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
});
const UpdatePhoneSchema = z.object({
  phoneNumber:   z.string().min(5).max(20),
  phoneVerified: z.boolean().default(false),
});
const UpdateAddressSchema = z.object({
  street:     z.string().min(1).max(200),
  city:       z.string().min(1).max(100),
  state:      z.string().max(100).optional(),
  country:    z.string().min(1).max(100),
  postalCode: z.string().max(20).optional(),
});

// ── Routes ─────────────────────────────────────────────────────────────────────

export async function usersRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/users/me — full authenticated user profile
  app.get("/me", async (req, reply) => {
    return reply.send({ data: await getMe(req.user.sub) });
  });

  // GET /api/v1/users/me/profile — extended profile (address, rate-limit info)
  app.get("/me/profile", async (req, reply) => {
    return reply.send({ data: await getFullProfile(req.user.sub) });
  });

  // PATCH /api/v1/users/me — profile fields (username, fullName)
  app.patch("/me", async (req, reply) => {
    const body = UpdateMeSchema.parse(req.body);
    return reply.send({ data: await updateMe(req.user.sub, body) });
  });

  // ── Security PIN ─────────────────────────────────────────────────────────────

  // POST /api/v1/users/me/security-pin  (set or update)
  app.post("/me/security-pin", async (req, reply) => {
    const { pin } = SetPinSchema.parse(req.body);
    await setSecurityPin(req.user.sub, pin);
    return reply.status(204).send();
  });

  // POST /api/v1/users/me/security-pin/verify  → one-time token for withdrawal
  app.post("/me/security-pin/verify", async (req, reply) => {
    const { pin } = VerifyPinSchema.parse(req.body);
    const data = await verifySecurityPin(req.user.sub, pin);
    return reply.send({ data });
  });

  // ── Preferences ──────────────────────────────────────────────────────────────

  // GET /api/v1/users/me/preferences
  app.get("/me/preferences", async (req, reply) => {
    return reply.send({ data: await getPreferences(req.user.sub) });
  });

  // PATCH /api/v1/users/me/preferences — theme / language / currency
  app.patch("/me/preferences", async (req, reply) => {
    const body = PreferencesSchema.parse(req.body);
    await updatePreferences(req.user.sub, body);
    return reply.status(204).send();
  });

  // ── Change Password ──────────────────────────────────────────────────────────

  // POST /api/v1/users/me/change-password
  app.post("/me/change-password", async (req, reply) => {
    const body = ChangePasswordSchema.parse(req.body);
    await changePassword(req.user.sub, body.currentPassword, body.newPassword);
    return reply.status(204).send();
  });

  // ── Payment Details (USDT + Bank) ────────────────────────────────────────────

  // GET /api/v1/users/me/payment
  app.get("/me/payment", async (req, reply) => {
    return reply.send({ data: await getPaymentDetails(req.user.sub) });
  });

  // PATCH /api/v1/users/me/payment — save USDT wallet and/or bank details
  app.patch("/me/payment", async (req, reply) => {
    const body = PaymentDetailsSchema.parse(req.body);
    await updatePaymentDetails(req.user.sub, body);
    return reply.status(204).send();
  });

  // ── Google 2FA ───────────────────────────────────────────────────────────────

  // GET /api/v1/users/me/2fa — current 2FA status
  app.get("/me/2fa", async (req, reply) => {
    return reply.send({ data: await get2FAStatus(req.user.sub) });
  });

  // POST /api/v1/users/me/2fa/setup — generate secret + QR (step 1)
  app.post("/me/2fa/setup", async (req, reply) => {
    return reply.send({ data: await generate2FASecret(req.user.sub) });
  });

  // POST /api/v1/users/me/2fa/enable — verify TOTP code and activate (step 2)
  app.post("/me/2fa/enable", async (req, reply) => {
    const { token } = Enable2FASchema.parse(req.body);
    await enable2FA(req.user.sub, token);
    return reply.status(204).send();
  });

  // POST /api/v1/users/me/2fa/disable — disable 2FA (requires PIN verification)
  app.post("/me/2fa/disable", async (req, reply) => {
    // PIN was verified at a higher level (PIN token passed in body)
    // For simplicity we also accept the current PIN directly here
    const { pin } = z.object({ pin: z.string().regex(/^\d{4}$/) }).parse(req.body);
    await verifySecurityPin(req.user.sub, pin); // throws if wrong
    await disable2FA(req.user.sub);
    return reply.status(204).send();
  });

  // POST /api/v1/users/me/2fa/verify — verify a TOTP token (login challenge)
  app.post("/me/2fa/verify", async (req, reply) => {
    const { token } = Verify2FASchema.parse(req.body);
    const { verify2FAToken } = await import("./settings.service");
    const valid = await verify2FAToken(req.user.sub, token);
    if (!valid) throw Object.assign(new Error("Invalid 2FA code"), { statusCode: 401, code: "INVALID_2FA" });
    return reply.status(204).send();
  });

  // ── Profile management ────────────────────────────────────────────────────────

  // POST /api/v1/users/me/avatar — upload avatar image (base64 data URL)
  app.post("/me/avatar", async (req, reply) => {
    const { dataUrl } = AvatarSchema.parse(req.body);
    return reply.send({ data: await uploadAvatar(req.user.sub, dataUrl) });
  });

  // PATCH /api/v1/users/me/username — update username (30-day rate limit)
  app.patch("/me/username", async (req, reply) => {
    const { username } = UpdateUsernameSchema.parse(req.body);
    await updateUsername(req.user.sub, username);
    return reply.status(204).send();
  });

  // PATCH /api/v1/users/me/phone — save phone number (after frontend OTP verification)
  app.patch("/me/phone", async (req, reply) => {
    const body = UpdatePhoneSchema.parse(req.body);
    await updatePhone(req.user.sub, body);
    return reply.status(204).send();
  });

  // PATCH /api/v1/users/me/address — save address (locked after KYC)
  app.patch("/me/address", async (req, reply) => {
    const body = UpdateAddressSchema.parse(req.body);
    await updateAddress(req.user.sub, body);
    return reply.status(204).send();
  });

  // POST /api/v1/users/me/deactivate — soft delete (requires password + 2FA if enabled)
  app.post("/me/deactivate", async (req, reply) => {
    const { password, totpToken } = z.object({
      password:   z.string().min(1),
      totpToken:  z.string().length(6).regex(/^\d{6}$/).optional(),
    }).parse(req.body);
    await deactivateAccount(req.user.sub, password, totpToken);
    return reply.status(204).send();
  });
}
