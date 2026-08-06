import { randomBytes } from "crypto";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomSuffix(len: number): string {
  const b = randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += CHARS[b[i] % CHARS.length];
  return s;
}

/** BZR-prefixed referral code — used in Referral Program links: ?ref=BRZXXXXXX */
export function generateReferralCode(): string {
  return "BZR" + randomSuffix(6);
}

/** BZA-prefixed affiliate code — used in Affiliate Program links: ?aff=BZAXXXXXX */
export function generateAffiliateCode(): string {
  return "BZA" + randomSuffix(6);
}

export const generateDeviceId = () => randomBytes(16).toString("hex");
