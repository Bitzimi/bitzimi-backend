import { z } from "zod";

export const SubmitWithdrawalSchema = z.object({
  amount:      z.number().positive("Amount must be positive"),
  destination: z.string().min(1, "Destination is required"),
  method:      z.enum(["crypto", "bank"]),
  pinToken:    z.string().uuid("Invalid PIN verification token"),
});

export type SubmitWithdrawalBody = z.infer<typeof SubmitWithdrawalSchema>;
