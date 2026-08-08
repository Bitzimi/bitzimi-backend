/**
 * Converts any Prisma Decimal, number, null, or undefined to a plain JS number.
 * Returns 0 for null/undefined; returns the value as-is for numbers;
 * uses parseFloat(String(d)) for Prisma Decimal objects.
 * Falls back to 0 on NaN (malformed input).
 */
export function dec(d: unknown): number {
  if (d === null || d === undefined) return 0;
  if (typeof d === "number") return d;
  return parseFloat(String(d)) || 0;
}
