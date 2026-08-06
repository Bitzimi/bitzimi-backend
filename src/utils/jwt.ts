import jwt from "jsonwebtoken";
import { config } from "../config";

export type UserRole = "super_admin"|"finance_admin"|"support_admin"|"moderator_admin"|"user";
export interface AccessTokenPayload  { sub: string; email: string; role: UserRole; }
export interface RefreshTokenPayload { sub: string; tokenId: string; }
export interface TwoFactorChallengePayload { sub: string; purpose: "2fa_challenge"; }

export const signAccessToken  = (p: AccessTokenPayload)  => jwt.sign(p, config.jwt.accessSecret,  { expiresIn: config.jwt.accessExpiresIn });
// expiresIn is optional — defaults to config value but can be overridden (e.g. from platform.session_timeout_days)
export const signRefreshToken = (p: RefreshTokenPayload, expiresIn?: string) =>
  jwt.sign(p, config.jwt.refreshSecret, { expiresIn: (expiresIn ?? config.jwt.refreshExpiresIn) as any });
export const verifyAccessToken  = (t: string) => jwt.verify(t, config.jwt.accessSecret)  as AccessTokenPayload;
export const verifyRefreshToken = (t: string) => jwt.verify(t, config.jwt.refreshSecret) as RefreshTokenPayload;

// Short-lived 5-minute challenge token issued when 2FA is required at login
export const signTwoFactorChallengeToken = (userId: string) =>
  jwt.sign({ sub: userId, purpose: "2fa_challenge" } as TwoFactorChallengePayload, config.jwt.accessSecret, { expiresIn: "5m" });

export const verifyTwoFactorChallengeToken = (t: string): TwoFactorChallengePayload => {
  const payload = jwt.verify(t, config.jwt.accessSecret) as TwoFactorChallengePayload;
  if (payload.purpose !== "2fa_challenge") throw new Error("Invalid token purpose");
  return payload;
};
