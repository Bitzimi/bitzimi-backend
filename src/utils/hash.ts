import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { config } from "../config";
export const hashPassword = (p: string) => bcrypt.hash(p, config.bcrypt.passwordRounds);
export const verifyPassword = (p: string, h: string) => bcrypt.compare(p, h);
export const hashPin = (p: string) => bcrypt.hash(p, config.bcrypt.pinRounds);
export const verifyPin = (p: string, h: string) => bcrypt.compare(p, h);
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
