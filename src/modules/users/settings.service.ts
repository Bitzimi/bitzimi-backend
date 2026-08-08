/**
 * Settings Service — backend-authoritative storage for all user preferences
 * and payment details.
 *
 * Covers:
 *   • Theme, Language, Currency preferences
 *   • USDT wallet address (BEP-20)
 *   • Bank account details (Nigeria)
 *   • Change password
 *   • Google 2FA (TOTP) — enable / disable / verify
 */
import { db } from "../../db";
import { hashPassword, verifyPassword } from "../../utils/hash";
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";

// ── Preferences (theme / language / currency) ─────────────────────────────────

export async function getPreferences(userId: string) {
  const profile = await db.userProfile.findUnique({ where: { userId } });
  if (!profile) throw Object.assign(new Error("Profile not found"), { statusCode: 404 });
  return {
    themePref:    profile.themePref,
    languagePref: profile.languagePref,
    currencyPref: profile.currencyPref,
  };
}

export async function updatePreferences(userId: string, input: {
  themePref?:    string;
  languagePref?: string;
  currencyPref?: string;
}) {
  await db.userProfile.update({
    where: { userId },
    data: {
      ...(input.themePref    && { themePref:    input.themePref }),
      ...(input.languagePref && { languagePref: input.languagePref }),
      ...(input.currencyPref && { currencyPref: input.currencyPref }),
    },
  });
}

// ── Change password ────────────────────────────────────────────────────────────

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) throw Object.assign(
    new Error("Current password is incorrect"),
    { statusCode: 401, code: "INCORRECT_PASSWORD" }
  );

  if (newPassword.length < 8) throw Object.assign(
    new Error("New password must be at least 8 characters"),
    { statusCode: 400, code: "PASSWORD_TOO_SHORT" }
  );

  const sameAsCurrent = await verifyPassword(newPassword, user.passwordHash);
  if (sameAsCurrent) throw Object.assign(
    new Error("New password must differ from current password"),
    { statusCode: 400, code: "PASSWORD_SAME" }
  );

  const newHash = await hashPassword(newPassword);
  await db.user.update({ where: { id: userId }, data: { passwordHash: newHash } });

  // Revoke all existing refresh tokens so all devices are logged out
  await db.authToken.updateMany({
    where: { userId, revokedAt: null },
    data:  { revokedAt: new Date() },
  });
}

// ── USDT Wallet ────────────────────────────────────────────────────────────────

export async function getPaymentDetails(userId: string) {
  const [profile, pin] = await Promise.all([
    db.userProfile.findUnique({ where: { userId } }),
    db.securityPin.findUnique({ where: { userId } }),
  ]);
  if (!profile) throw Object.assign(new Error("Profile not found"), { statusCode: 404 });
  return {
    usdtAddress:      profile.usdtAddress ?? null,
    bankAccountName:  profile.bankAccountName ?? null,
    bankAccountNumber:profile.bankAccountNumber ?? null,
    bankName:         profile.bankName ?? null,
    hasPIN:           !!pin,
  };
}

export async function updatePaymentDetails(userId: string, input: {
  usdtAddress?:       string;
  bankAccountName?:   string;
  bankAccountNumber?: string;
  bankName?:          string;
}) {
  const data: Record<string, string | null> = {};
  if (input.usdtAddress !== undefined)       data.usdtAddress       = input.usdtAddress || null;
  if (input.bankAccountName !== undefined)   data.bankAccountName   = input.bankAccountName || null;
  if (input.bankAccountNumber !== undefined) data.bankAccountNumber = input.bankAccountNumber || null;
  if (input.bankName !== undefined)          data.bankName          = input.bankName || null;

  if (Object.keys(data).length === 0) return;
  await db.userProfile.update({ where: { userId }, data });

  setImmediate(() =>
    db.auditLog.create({ data: {
      actorId: userId, action: "USER update_payment_details", targetType: "user", targetId: userId,
      metadata: JSON.stringify({ updatedFields: Object.keys(data) }), httpStatus: 200,
    }}).catch(() => {})
  );
}

// ── Google 2FA (TOTP) ─────────────────────────────────────────────────────────

const APP_NAME = "Bitzimi";

export async function get2FAStatus(userId: string) {
  const profile = await db.userProfile.findUnique({ where: { userId } });
  return {
    enabled: profile?.twoFactorEnabled ?? false,
  };
}

/** Generate a new TOTP secret and QR code URL (does NOT enable 2FA yet). */
export async function generate2FASecret(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });

  const secret = generateSecret();
  const username = user.profile?.username ?? user.email;
  const otpauth = generateURI({ issuer: APP_NAME, label: username, secret });
  const qrDataUrl = await QRCode.toDataURL(otpauth);

  // Store secret temporarily (not enabled until verified)
  await db.userProfile.update({
    where: { userId },
    data: { twoFactorSecret: secret, twoFactorEnabled: false },
  });

  return { secret, qrDataUrl, otpauth };
}

/** Verify the TOTP code and enable 2FA. */
export async function enable2FA(userId: string, token: string) {
  const profile = await db.userProfile.findUnique({ where: { userId } });
  if (!profile?.twoFactorSecret) throw Object.assign(
    new Error("No 2FA secret found. Call /setup first."),
    { statusCode: 400, code: "NO_2FA_SECRET" }
  );

  const result = verifySync({ token, secret: profile.twoFactorSecret });
  const valid = result.valid;
  if (!valid) throw Object.assign(
    new Error("Invalid authenticator code"),
    { statusCode: 401, code: "INVALID_2FA_CODE" }
  );

  await db.userProfile.update({ where: { userId }, data: { twoFactorEnabled: true } });

  setImmediate(() =>
    db.auditLog.create({ data: {
      actorId: userId, action: "USER enable_2fa", targetType: "user", targetId: userId,
      previousValue: "disabled", newValue: "enabled", httpStatus: 200,
    }}).catch(() => {})
  );
}

/** Disable 2FA (requires current PIN verification — done at route level). */
export async function disable2FA(userId: string) {
  await db.userProfile.update({ where: { userId }, data: { twoFactorEnabled: false, twoFactorSecret: null } });

  setImmediate(() =>
    db.auditLog.create({ data: {
      actorId: userId, action: "USER disable_2fa", targetType: "user", targetId: userId,
      previousValue: "enabled", newValue: "disabled", httpStatus: 200,
    }}).catch(() => {})
  );
}

/** Verify a TOTP token (used during login). */
export async function verify2FAToken(userId: string, token: string): Promise<boolean> {
  const profile = await db.userProfile.findUnique({ where: { userId } });
  if (!profile?.twoFactorEnabled || !profile.twoFactorSecret) return false;
  return verifySync({ token, secret: profile.twoFactorSecret }).valid;
}
