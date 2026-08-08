import { z } from "zod";

export const UpdateMeSchema = z.object({
  username:     z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/).optional(),
  fullName:     z.string().max(128).optional(),
  languagePref: z.enum(["en","fr","es","pt","zh","hi","ru"]).optional(),
  currencyPref: z.enum(["USD","EUR","GBP","NGN","CNY","INR","ZAR","KES","RUB","TRY"]).optional(),
});

export const SetPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
});

export const VerifyPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
});
