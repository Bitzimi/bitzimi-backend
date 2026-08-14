import { db } from "../../db";
import { hashPassword, verifyPassword, hashToken } from "../../utils/hash";
import { generateReferralCode, generateAffiliateCode, generateDeviceId } from "../../utils/id";
import { signAccessToken, signRefreshToken, verifyRefreshToken, signTwoFactorChallengeToken, verifyTwoFactorChallengeToken } from "../../utils/jwt";
import { config } from "../../config";
import { checkLockout, recordSuccess, recordFailure } from "./authAttempts";
import { randomBytes } from "crypto";
import { recordLoginHistory } from "../admin/security/admin.security.service";
import { sendPasswordResetEmail, sendEmailVerificationEmail } from "../email/email.service";
import { verify2FAToken } from "../users/settings.service";
import { getConfigValue } from "../admin/config/admin.config.service";

const ALL_WALLET_TYPES = ["main","game","task","referral","affiliate","task_vault","ambassador"];

// ── Unique code generators ────────────────────────────────────────────────────

async function uniqueReferralCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateReferralCode();          // BZR prefix
    if (!await db.user.findUnique({ where: { referralCode: code } })) return code;
  }
  throw new Error("Failed to generate unique referral code");
}

async function uniqueAffiliateCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateAffiliateCode();         // BZA prefix
    if (!await db.user.findUnique({ where: { affiliateCode: code } })) return code;
  }
  throw new Error("Failed to generate unique affiliate code");
}

// ── Registration ──────────────────────────────────────────────────────────────

export async function registerUser(input: {
  email:         string;
  password:      string;
  username:      string;
  fullName?:     string;
  referralCode?: string;   // BZR code — user came through ?ref= link
  affiliateCode?: string;  // BZA code — user came through ?aff= link
}) {
  const [registrationEnabled, passwordMinLength] = await Promise.all([
    getConfigValue<boolean>("platform.registration_enabled", true),
    getConfigValue<number>("platform.password_min_length", 8),
  ]);

  if (!registrationEnabled) {
    throw Object.assign(new Error("Registration is currently disabled"), {
      statusCode: 403, code: "REGISTRATION_DISABLED",
    });
  }

  if (input.password.length < passwordMinLength) {
    throw Object.assign(
      new Error(`Password must be at least ${passwordMinLength} characters`),
      { statusCode: 400, code: "PASSWORD_TOO_SHORT" },
    );
  }

  if (await db.user.findUnique({ where: { email: input.email } }))
    throw Object.assign(new Error("Email already in use"), { statusCode: 409, code: "EMAIL_TAKEN" });
  if (await db.userProfile.findUnique({ where: { username: input.username } }))
    throw Object.assign(new Error("Username already taken"), { statusCode: 409, code: "USERNAME_TAKEN" });

  // Resolve uplineId from whichever code type was provided.
  // Referral (?ref=BZR...) looks up by referralCode field.
  // Affiliate (?aff=BZA...) looks up by affiliateCode field.
  let uplineId: string | null = null;
  if (input.referralCode) {
    const ref = await db.user.findUnique({ where: { referralCode: input.referralCode } });
    if (ref) uplineId = ref.id;
  } else if (input.affiliateCode) {
    const aff = await db.user.findUnique({ where: { affiliateCode: input.affiliateCode } });
    if (aff) uplineId = aff.id;
  }

  const [passwordHash, newReferralCode, newAffiliateCode] = await Promise.all([
    hashPassword(input.password),
    uniqueReferralCode(),
    uniqueAffiliateCode(),
  ]);

  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email:         input.email,
        passwordHash,
        referralCode:  newReferralCode,   // BZR — for ?ref= links
        affiliateCode: newAffiliateCode,  // BZA — for ?aff= links
        uplineId:      uplineId ?? undefined,
      },
    });
    await tx.userProfile.create({ data: { userId: u.id, username: input.username, fullName: input.fullName ?? null } });
    await tx.wallet.createMany({ data: ALL_WALLET_TYPES.map(walletType => ({ userId: u.id, walletType })) });
    await tx.kycSubmission.create({ data: { userId: u.id } });
    await tx.withdrawalLimit.create({ data: { userId: u.id } });
    if (uplineId) {
      // Create the Referral record so commission/reward logic has a record to operate on.
      // The reward ($0.50) is NOT paid here — it is paid only when the referred user
      // purchases VIP for the FIRST TIME (see referrals.service.ts payReferralBonusOnFirstVIP).
      await tx.referral.create({
        data: { referrerId: uplineId, referredId: u.id, tier: 1 },
      });
    }
    return u;
  });

  // Send verification email asynchronously — don't block registration response
  sendVerificationEmail(user.email).catch(() => {});

  // Registration does NOT authenticate the user.
  // The user must verify their email before they can log in and receive tokens.
  return {
    registered: true,
    email: user.email,
    emailVerificationRequired: true,
  };
}

export async function loginUser(input: {
  email:     string;
  password:  string;
  ipAddress?: string;
  userAgent?: string;
}) {
  // Check lockout BEFORE hitting DB — fast-fail under brute-force attacks
  await checkLockout(input.email);

  const user = await db.user.findUnique({ where: { email: input.email } });
  if (!user) {
    await hashPassword("dummy"); // constant-time — prevents user enumeration via timing
    await recordFailure(input.email);
    setImmediate(() => recordLoginHistory({ email: input.email, success: false, ipAddress: input.ipAddress, userAgent: input.userAgent, failureReason: "INVALID_CREDENTIALS" }).catch(() => {}));
    throw Object.assign(new Error("Invalid email or password"), { statusCode: 401, code: "INVALID_CREDENTIALS" });
  }
  if (user.deletedAt) {
    setImmediate(() => recordLoginHistory({ userId: user.id, email: input.email, success: false, ipAddress: input.ipAddress, userAgent: input.userAgent, failureReason: "ACCOUNT_DELETED" }).catch(() => {}));
    throw Object.assign(new Error("Account has been deactivated"), { statusCode: 403, code: "ACCOUNT_DELETED" });
  }
  if (user.suspendedAt) {
    setImmediate(() => recordLoginHistory({ userId: user.id, email: input.email, success: false, ipAddress: input.ipAddress, userAgent: input.userAgent, failureReason: "ACCOUNT_SUSPENDED" }).catch(() => {}));
    throw Object.assign(new Error("Account suspended"), { statusCode: 403, code: "ACCOUNT_SUSPENDED" });
  }
  if (!await verifyPassword(input.password, user.passwordHash)) {
    await recordFailure(input.email);
    setImmediate(() => recordLoginHistory({ userId: user.id, email: input.email, success: false, ipAddress: input.ipAddress, userAgent: input.userAgent, failureReason: "INVALID_CREDENTIALS" }).catch(() => {}));
    throw Object.assign(new Error("Invalid email or password"), { statusCode: 401, code: "INVALID_CREDENTIALS" });
  }
  if (!user.emailVerified) {
    await recordSuccess(input.email); // not a brute force failure — just unverified
    setImmediate(() => recordLoginHistory({ userId: user.id, email: input.email, success: false, ipAddress: input.ipAddress, userAgent: input.userAgent, failureReason: "EMAIL_NOT_VERIFIED" }).catch(() => {}));
    throw Object.assign(new Error("Email address not verified"), { statusCode: 403, code: "EMAIL_NOT_VERIFIED" });
  }

  await recordSuccess(input.email); // clear attempt counter on successful login

  // Check 2FA — if enabled, issue a challenge token instead of full tokens
  const profile = await db.userProfile.findUnique({ where: { userId: user.id } });
  if (profile?.twoFactorEnabled && profile.twoFactorSecret) {
    const twoFactorToken = signTwoFactorChallengeToken(user.id);
    setImmediate(() => recordLoginHistory({ userId: user.id, email: user.email, success: false, ipAddress: input.ipAddress, userAgent: input.userAgent, failureReason: "2FA_REQUIRED" }).catch(() => {}));
    return { requiresTwoFactor: true as const, twoFactorToken };
  }

  const tokens = await issueTokenPair(user.id, user.email, user.role, input.ipAddress, input.userAgent);
  setImmediate(() => recordLoginHistory({ userId: user.id, email: user.email, success: true, ipAddress: input.ipAddress, userAgent: input.userAgent, sessionId: tokens.sessionId }).catch(() => {}));
  return tokens;
}

export async function loginWith2FA(input: {
  twoFactorToken: string;
  totpCode:       string;
  ipAddress?:     string;
  userAgent?:     string;
}) {
  let payload: { sub: string };
  try {
    payload = verifyTwoFactorChallengeToken(input.twoFactorToken);
  } catch {
    throw Object.assign(new Error("Invalid or expired 2FA challenge token"), { statusCode: 401, code: "TOKEN_INVALID" });
  }

  const userId = payload.sub;
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });

  const valid = await verify2FAToken(userId, input.totpCode);
  if (!valid) {
    setImmediate(() => recordLoginHistory({ userId, email: user.email, success: false, ipAddress: input.ipAddress, userAgent: input.userAgent, failureReason: "INVALID_2FA_CODE" }).catch(() => {}));
    throw Object.assign(new Error("Invalid authenticator code"), { statusCode: 401, code: "INVALID_2FA_CODE" });
  }

  const tokens = await issueTokenPair(userId, user.email, user.role, input.ipAddress, input.userAgent);
  setImmediate(() => recordLoginHistory({ userId, email: user.email, success: true, ipAddress: input.ipAddress, userAgent: input.userAgent, sessionId: tokens.sessionId }).catch(() => {}));
  return tokens;
}

export async function refreshTokens(rawToken: string) {
  let payload: any;
  try { payload = verifyRefreshToken(rawToken); }
  catch { throw Object.assign(new Error("Invalid or expired refresh token"), { statusCode: 401, code: "TOKEN_INVALID" }); }

  const stored = await db.authToken.findFirst({
    where: { id: payload.tokenId, tokenHash: hashToken(rawToken), revokedAt: null },
    include: { user: true },
  });
  if (!stored || new Date() > stored.expiresAt)
    throw Object.assign(new Error("Token not found or expired"), { statusCode: 401, code: "TOKEN_INVALID" });
  if (stored.user.suspendedAt)
    throw Object.assign(new Error("Account suspended"), { statusCode: 403, code: "ACCOUNT_SUSPENDED" });
  if (stored.user.deletedAt)
    throw Object.assign(new Error("Account has been deactivated"), { statusCode: 403, code: "ACCOUNT_DELETED" });

  await db.authToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  return issueTokenPair(stored.user.id, stored.user.email, stored.user.role);
}

export async function logoutUser(rawToken: string) {
  try {
    const p = verifyRefreshToken(rawToken);
    await db.authToken.updateMany({ where: { id: p.tokenId, revokedAt: null }, data: { revokedAt: new Date() } });
  } catch { /* already invalid */ }
}

async function issueTokenPair(userId: string, email: string, role: string, ipAddress?: string, userAgent?: string) {
  const sessionDays = await getConfigValue<number>("platform.session_timeout_days", 7);
  const sessionSecs = sessionDays * 24 * 60 * 60;
  const expiresIn   = `${sessionDays}d`;
  const expiresAt   = new Date(Date.now() + sessionSecs * 1000);

  const tokenRecord = await db.authToken.create({
    data: {
      userId,
      tokenHash:  "pending",
      deviceId:   generateDeviceId(),
      expiresAt,
      ipAddress:  ipAddress  ?? null,
      userAgent:  userAgent  ?? null,
      lastSeenAt: new Date(),
    },
  });
  const refreshToken = signRefreshToken({ sub: userId, tokenId: tokenRecord.id }, expiresIn);
  await db.authToken.update({ where: { id: tokenRecord.id }, data: { tokenHash: hashToken(refreshToken) } });
  const accessToken = signAccessToken({ sub: userId, email, role: role as any });
  return { accessToken, refreshToken, expiresIn: 900, sessionId: tokenRecord.id };
}

// ── Forgot / Reset Password ───────────────────────────────────────────────────

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function forgotPassword(email: string) {
  const user = await db.user.findUnique({ where: { email } });
  // Always respond 204 — don't reveal whether email exists
  if (!user) return;

  // Invalidate any existing unused tokens for this user
  await db.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data:  { usedAt: new Date() },
  });

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  await db.passwordResetToken.create({
    data: {
      userId:    user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });

  await sendPasswordResetEmail(email, rawToken);
}

export async function resetPassword(rawToken: string, newPassword: string) {
  const tokenHash = hashToken(rawToken);
  const record = await db.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!record || record.usedAt || new Date() > record.expiresAt) {
    throw Object.assign(new Error("Invalid or expired reset token"), { statusCode: 400, code: "TOKEN_INVALID" });
  }

  const user = await db.user.findUnique({ where: { id: record.userId } });
  if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });

  const newHash = await hashPassword(newPassword);

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash: newHash } });
    await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    // Revoke all existing sessions
    await tx.authToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  });
}

// ── Email Verification ────────────────────────────────────────────────────────

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function sendVerificationEmail(email: string) {
  const user = await db.user.findUnique({ where: { email } });
  // Always return silently — don't leak whether email is registered
  if (!user || user.emailVerified) return;

  // Invalidate any existing unused tokens for this user
  await db.emailVerificationToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data:  { usedAt: new Date() },
  });

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  await db.emailVerificationToken.create({
    data: {
      userId:    user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
    },
  });

  await sendEmailVerificationEmail(email, rawToken);
}

export async function verifyEmail(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const record = await db.emailVerificationToken.findUnique({ where: { tokenHash } });

  if (!record || record.usedAt || new Date() > record.expiresAt) {
    throw Object.assign(new Error("Invalid or expired verification link"), { statusCode: 400, code: "TOKEN_INVALID" });
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: record.userId }, data: { emailVerified: true } });
    await tx.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  });
}
