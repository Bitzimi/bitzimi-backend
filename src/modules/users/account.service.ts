/**
 * Account deactivation service.
 *
 * Soft delete — sets deletedAt timestamp and revokes all sessions.
 * Preserves: transactions, wallets, audit log, referral history, game bets.
 * Future logins are blocked (loginUser checks deletedAt).
 */
import { db } from "../../db";
import { verifyPassword } from "../../utils/hash";
import { verifySync } from "otplib";

export async function deactivateAccount(
  userId: string,
  password: string,
  totpToken?: string,
) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });
  if (user.deletedAt) throw Object.assign(new Error("Account already deactivated"), { statusCode: 409 });

  // Password verification is always required
  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    throw Object.assign(new Error("Incorrect password"), { statusCode: 401, code: "INCORRECT_PASSWORD" });
  }

  // If 2FA is enabled, TOTP token is required
  if (user.profile?.twoFactorEnabled) {
    if (!totpToken) {
      throw Object.assign(new Error("2FA code required"), { statusCode: 400, code: "2FA_REQUIRED" });
    }
    const secret = user.profile.twoFactorSecret;
    if (!secret || !verifySync({ token: totpToken, secret }).valid) {
      throw Object.assign(new Error("Invalid 2FA code"), { statusCode: 401, code: "INVALID_2FA_CODE" });
    }
  }

  await db.$transaction(async (tx) => {
    // Mark account deleted (soft delete)
    await tx.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
    // Revoke all active refresh tokens — terminates all sessions immediately
    await tx.authToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    // Invalidate any pending password reset or verification tokens
    await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
    await tx.emailVerificationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
  });
}
