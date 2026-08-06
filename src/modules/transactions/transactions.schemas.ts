import { z } from "zod";

export const ListTransactionsQuery = z.object({
  cursor:  z.string().optional(),
  limit:   z.coerce.number().int().min(1).max(100).default(50),
  type:    z.string().optional(),
});

export type ListTransactionsQuery = z.infer<typeof ListTransactionsQuery>;
