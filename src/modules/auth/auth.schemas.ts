import { z } from "zod";

export const RegisterSchema = z.object({
  email:         z.string().email(),
  password:      z.string().min(8).max(128),
  username:      z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
  // referralCode:  BZR-prefix — user came through a ?ref= link
  // affiliateCode: BZA-prefix — user came through a ?aff= link
  // Both are optional; only one should be provided per registration.
  referralCode:  z.string().optional(),
  affiliateCode: z.string().optional(),
});

export const LoginSchema          = z.object({ email: z.string().email(), password: z.string().min(1) });
export const RefreshSchema        = z.object({ refreshToken: z.string().min(1) });
export const ForgotPasswordSchema    = z.object({ email: z.string().email() });
export const ResetPasswordSchema     = z.object({ token: z.string().min(1), newPassword: z.string().min(8).max(128) });
export const VerifyEmailSchema       = z.object({ token: z.string().min(1) });
export const SendVerificationSchema  = z.object({ email: z.string().email() });

export type RegisterBody       = z.infer<typeof RegisterSchema>;
export type LoginBody          = z.infer<typeof LoginSchema>;
export type ForgotPasswordBody = z.infer<typeof ForgotPasswordSchema>;
export type ResetPasswordBody  = z.infer<typeof ResetPasswordSchema>;
