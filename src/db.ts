import { PrismaClient } from "@prisma/client";
import { config } from "./config";
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalForPrisma.prisma ?? new PrismaClient({
  log: config.env === "development" ? ["warn", "error"] : ["error"],
});
if (config.env !== "production") globalForPrisma.prisma = db;
