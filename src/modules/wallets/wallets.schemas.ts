import { z } from "zod";
export const WalletTypeValues = ["main","game","task","referral","affiliate","task_vault","ambassador"] as const;
export const WalletTypeParam  = z.object({ type: z.enum(WalletTypeValues) });
export const TransferSchema   = z.object({
  from:   z.enum(WalletTypeValues),
  to:     z.enum(WalletTypeValues),
  amount: z.number().positive(),
});
