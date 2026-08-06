/**
 * Profile Service — backend-authoritative user profile management.
 *
 * Covers:
 *   • Avatar upload (base64 → object storage → avatarUrl)
 *   • Username update with 30-day rate limiting
 *   • Phone number update (after frontend OTP verification)
 *   • Address management (locked after KYC verification)
 *   • Full profile read (aggregating all sources)
 */
import { db } from "../../db";
import { storeDocument } from "../kyc/storage";

const USERNAME_EDIT_COOLDOWN_DAYS = 30;

// ── Full profile read ─────────────────────────────────────────────────────────

export async function getFullProfile(userId: string) {
  const profile = await db.userProfile.findUnique({ where: { userId } });
  if (!profile) throw Object.assign(new Error("Profile not found"), { statusCode: 404 });

  const now = Date.now();
  const canEditUsername = !profile.lastUsernameEdit
    || (now - profile.lastUsernameEdit.getTime()) > USERNAME_EDIT_COOLDOWN_DAYS * 86400000;

  const nextUsernameEditAt = profile.lastUsernameEdit
    ? new Date(profile.lastUsernameEdit.getTime() + USERNAME_EDIT_COOLDOWN_DAYS * 86400000).toISOString()
    : null;

  return {
    username:      profile.username,
    fullName:      profile.fullName ?? null,
    avatarUrl:     profile.avatarUrl ?? null,
    phoneNumber:   profile.phoneNumber ?? null,
    phoneVerified: profile.phoneVerified,
    address: {
      street:     profile.addressStreet     ?? null,
      city:       profile.addressCity       ?? null,
      state:      profile.addressState      ?? null,
      country:    profile.addressCountry    ?? null,
      postalCode: profile.addressPostalCode ?? null,
    },
    addressLockedByVerification: profile.addressLockedByVerification,
    canEditUsername,
    nextUsernameEditAt,
    lastUsernameEdit: profile.lastUsernameEdit?.toISOString() ?? null,
  };
}

// ── Avatar upload ─────────────────────────────────────────────────────────────

export async function uploadAvatar(userId: string, dataUrl: string) {
  if (!dataUrl.startsWith("data:image/")) {
    throw Object.assign(new Error("Invalid image format"), { statusCode: 400, code: "INVALID_IMAGE" });
  }

  const stored = await storeDocument(dataUrl, `avatars/${userId}`);
  await db.userProfile.update({
    where: { userId },
    data: { avatarUrl: stored.url },
  });

  return { avatarUrl: stored.url };
}

// ── Username update (30-day rate limit) ──────────────────────────────────────

export async function updateUsername(userId: string, newUsername: string) {
  const profile = await db.userProfile.findUnique({ where: { userId } });
  if (!profile) throw Object.assign(new Error("Profile not found"), { statusCode: 404 });

  // Enforce 30-day cooldown
  if (profile.lastUsernameEdit) {
    const daysSince = (Date.now() - profile.lastUsernameEdit.getTime()) / 86400000;
    if (daysSince < USERNAME_EDIT_COOLDOWN_DAYS) {
      const nextEdit = new Date(profile.lastUsernameEdit.getTime() + USERNAME_EDIT_COOLDOWN_DAYS * 86400000);
      throw Object.assign(
        new Error(`Username can only be changed once every ${USERNAME_EDIT_COOLDOWN_DAYS} days. Next edit: ${nextEdit.toISOString()}`),
        { statusCode: 429, code: "USERNAME_EDIT_COOLDOWN", nextEditAt: nextEdit.toISOString() }
      );
    }
  }

  // Check uniqueness
  const taken = await db.userProfile.findFirst({ where: { username: newUsername, userId: { not: userId } } });
  if (taken) throw Object.assign(new Error("Username already taken"), { statusCode: 409, code: "USERNAME_TAKEN" });

  await db.userProfile.update({
    where: { userId },
    data: { username: newUsername, lastUsernameEdit: new Date() },
  });
}

// ── Phone update (called after frontend OTP verification passes) ──────────────

export async function updatePhone(userId: string, input: {
  phoneNumber:   string;
  phoneVerified: boolean;
}) {
  await db.userProfile.update({
    where: { userId },
    data: {
      phoneNumber:   input.phoneNumber,
      phoneVerified: input.phoneVerified,
    },
  });
}

// ── Address update (locked after KYC verification) ────────────────────────────

export async function updateAddress(userId: string, input: {
  street:     string;
  city:       string;
  state?:     string;
  country:    string;
  postalCode?: string;
}) {
  const profile = await db.userProfile.findUnique({ where: { userId } });
  if (!profile) throw Object.assign(new Error("Profile not found"), { statusCode: 404 });

  if (profile.addressLockedByVerification) {
    throw Object.assign(
      new Error("Address is locked after identity verification and cannot be changed."),
      { statusCode: 403, code: "ADDRESS_LOCKED" }
    );
  }

  await db.userProfile.update({
    where: { userId },
    data: {
      addressStreet:    input.street,
      addressCity:      input.city,
      addressState:     input.state    ?? null,
      addressCountry:   input.country,
      addressPostalCode:input.postalCode ?? null,
    },
  });
}

/** Called by admin KYC approval — locks the address permanently. */
export async function lockAddressAfterVerification(userId: string) {
  await db.userProfile.update({
    where: { userId },
    data: { addressLockedByVerification: true },
  });
}
