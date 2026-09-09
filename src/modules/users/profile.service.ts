/**
 * Profile Service — backend-authoritative user profile management.
 *
 * Covers:
 *   • Avatar upload (base64 data URL → durable profile storage)
 *   • Username update with 30-day rate limiting
 *   • Phone number update (after frontend OTP verification)
 *   • Address management (locked after KYC verification)
 *   • Full profile read (aggregating all sources)
 */
import { db } from "../../db";

const USERNAME_EDIT_COOLDOWN_DAYS = 30;
const MAX_AVATAR_BYTES = 700 * 1024;

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

export async function uploadAvatar(userId: string, dataUrl: string) {
  if (!dataUrl.startsWith("data:image/")) {
    throw Object.assign(new Error("Invalid image format"), { statusCode: 400, code: "INVALID_IMAGE" });
  }

  const comma = dataUrl.indexOf(",");
  const encoded = comma >= 0 ? dataUrl.slice(comma + 1) : "";
  const bytes = Buffer.byteLength(encoded, "base64");
  if (!bytes || bytes > MAX_AVATAR_BYTES) {
    throw Object.assign(new Error("Avatar image is too large. Please use an image under 700 KB."), { statusCode: 413, code: "AVATAR_TOO_LARGE" });
  }

  // Keep the canonical avatar in the user profile itself. This avoids the old
  // local-filesystem storage-key problem where the UI replaced a working image
  // with a UUID/path such as /uploads/<id> that other users could not resolve.
  await db.userProfile.update({
    where: { userId },
    data: { avatarUrl: dataUrl },
  });

  return { avatarUrl: dataUrl };
}

export async function updateUsername(userId: string, newUsername: string) {
  const profile = await db.userProfile.findUnique({ where: { userId } });
  if (!profile) throw Object.assign(new Error("Profile not found"), { statusCode: 404 });

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

  const taken = await db.userProfile.findFirst({ where: { username: newUsername, userId: { not: userId } } });
  if (taken) throw Object.assign(new Error("Username already taken"), { statusCode: 409, code: "USERNAME_TAKEN" });

  await db.userProfile.update({
    where: { userId },
    data: { username: newUsername, lastUsernameEdit: new Date() },
  });
}

export async function updatePhone(userId: string, input: { phoneNumber:string; phoneVerified:boolean }) {
  await db.userProfile.update({
    where: { userId },
    data: { phoneNumber: input.phoneNumber, phoneVerified: input.phoneVerified },
  });
}

export async function updateAddress(userId: string, input: { street:string; city:string; state?:string; country:string; postalCode?:string }) {
  const profile = await db.userProfile.findUnique({ where: { userId } });
  if (!profile) throw Object.assign(new Error("Profile not found"), { statusCode: 404 });
  if (profile.addressLockedByVerification) {
    throw Object.assign(new Error("Address is locked after identity verification and cannot be changed."), { statusCode: 403, code: "ADDRESS_LOCKED" });
  }
  await db.userProfile.update({
    where: { userId },
    data: {
      addressStreet: input.street,
      addressCity: input.city,
      addressState: input.state ?? null,
      addressCountry: input.country,
      addressPostalCode: input.postalCode ?? null,
    },
  });
}

export async function lockAddressAfterVerification(userId: string) {
  await db.userProfile.update({ where: { userId }, data: { addressLockedByVerification: true } });
}
