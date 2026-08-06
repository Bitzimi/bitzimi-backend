import { z } from "zod";

// walletAddress is no longer accepted from clients — it comes from CRYPTO_DEPOSIT_ADDRESS env var
export const CreateDepositSchema = z.object({
  amount: z.number().positive("Amount must be positive"),
  method: z.enum(["crypto", "bank"]),
});

export type CreateDepositBody = z.infer<typeof CreateDepositSchema>;
