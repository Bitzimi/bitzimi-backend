/**
 * Currency Management Service — Phase 23.4
 *
 * Display-only currency system. All balances, transactions and business logic
 * remain in USD. Currencies only affect how USD values are formatted for users.
 *
 * Architecture:
 *  - rateSource = "manual"    → admin sets rate directly via Admin Panel
 *  - rateSource = "automatic" → backend fetches rate from external provider
 *
 * Adding a new automatic provider: implement the RateProvider interface and
 * register it in RATE_PROVIDERS below. No other code changes required.
 */
import { db } from "../../../db";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CurrencyEntry {
  code:       string;
  name:       string;
  symbol:     string;
  rate:       number;
  rateSource: "manual" | "automatic";
  enabled:    boolean;
  sortOrder:  number;
  country:    string | null;
  flag:       string | null;
  isDefault:  boolean;
  updatedAt:  string;
  updatedBy:  string | null;
}

export interface CreateCurrencyInput {
  code:        string;
  name:        string;
  symbol:      string;
  rate:        number;
  rateSource?: "manual" | "automatic";
  sortOrder?:  number;
  country?:    string;
  flag?:       string;
}

export interface UpdateCurrencyInput {
  name?:       string;
  symbol?:     string;
  rate?:       number;
  rateSource?: "manual" | "automatic";
  enabled?:    boolean;
  sortOrder?:  number;
  country?:    string | null;
  flag?:       string | null;
  isDefault?:  boolean;
}

// ── Pluggable rate provider interface ─────────────────────────────────────────

interface RateProvider {
  name: string;
  fetchRates(codes: string[]): Promise<Record<string, number>>;
}

const openExchangeRatesProvider: RateProvider = {
  name: "open.er-api.com",
  async fetchRates(codes: string[]): Promise<Record<string, number>> {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!res.ok) throw new Error(`Rate provider returned ${res.status}`);
    const json = await res.json() as { result: string; rates: Record<string, number> };
    if (json.result !== "success") throw new Error("Rate provider error");
    const rates: Record<string, number> = {};
    for (const code of codes) {
      if (json.rates[code] !== undefined) rates[code] = json.rates[code];
    }
    return rates;
  },
};

const RATE_PROVIDERS: RateProvider[] = [openExchangeRatesProvider];

// ── Helpers ────────────────────────────────────────────────────────────────────

function serialise(row: any): CurrencyEntry {
  return {
    code:       row.code,
    name:       row.name,
    symbol:     row.symbol,
    rate:       row.rate,
    rateSource: (row.rateSource ?? "manual") as "manual" | "automatic",
    enabled:    row.enabled,
    sortOrder:  row.sortOrder ?? 0,
    country:    row.country ?? null,
    flag:       row.flag ?? null,
    isDefault:  row.isDefault ?? false,
    updatedAt:  row.updatedAt.toISOString(),
    updatedBy:  row.updatedBy ?? null,
  };
}

const ORDER_BY = [{ sortOrder: "asc" as const }, { code: "asc" as const }];

// ── NGN rate lookup (used by deposits/withdrawals for business logic) ──────────

/**
 * Returns how many NGN equal 1 USD, using the admin-managed Currency table.
 * Falls back to 1650 only if the NGN currency record is missing entirely.
 */
export async function getNGNToUSDRate(): Promise<number> {
  const ngn = await db.currency.findUnique({ where: { code: "NGN" } });
  return ngn?.rate ?? 1650;
}

// ── Seed ───────────────────────────────────────────────────────────────────────

export async function seedDefaultCurrencies(): Promise<void> {
  const count = await db.currency.count();
  if (count > 0) return;

  const defaults = [
    { code: "USD", name: "US Dollar",         symbol: "$",   rate: 1,    sortOrder: 0,  country: "United States", flag: "\u{1F1FA}\u{1F1F8}", isDefault: true  },
    { code: "EUR", name: "Euro",               symbol: "€",   rate: 0.92, sortOrder: 1,  country: "Europe",        flag: "\u{1F1EA}\u{1F1FA}", isDefault: false },
    { code: "GBP", name: "British Pound",      symbol: "£",   rate: 0.79, sortOrder: 2,  country: "United Kingdom",flag: "\u{1F1EC}\u{1F1E7}", isDefault: false },
    { code: "NGN", name: "Nigerian Naira",     symbol: "₦",  rate: 1650, sortOrder: 3,  country: "Nigeria",       flag: "\u{1F1F3}\u{1F1EC}", isDefault: false },
    { code: "CNY", name: "Chinese Yuan",       symbol: "¥",   rate: 7.25, sortOrder: 4,  country: "China",         flag: "\u{1F1E8}\u{1F1F3}", isDefault: false },
    { code: "INR", name: "Indian Rupee",       symbol: "₹",  rate: 83,   sortOrder: 5,  country: "India",         flag: "\u{1F1EE}\u{1F1F3}", isDefault: false },
    { code: "ZAR", name: "South African Rand", symbol: "R",   rate: 18.5, sortOrder: 6,  country: "South Africa",  flag: "\u{1F1FF}\u{1F1E6}", isDefault: false },
    { code: "KES", name: "Kenyan Shilling",    symbol: "KSh", rate: 130,  sortOrder: 7,  country: "Kenya",         flag: "\u{1F1F0}\u{1F1EA}", isDefault: false },
    { code: "RUB", name: "Russian Ruble",      symbol: "₽",  rate: 90,   sortOrder: 8,  country: "Russia",        flag: "\u{1F1F7}\u{1F1FA}", isDefault: false },
    { code: "TRY", name: "Turkish Lira",       symbol: "₺",  rate: 32,   sortOrder: 9,  country: "Turkey",        flag: "\u{1F1F9}\u{1F1F7}", isDefault: false },
  ];

  await db.currency.createMany({ data: defaults });
}

// ── Queries ────────────────────────────────────────────────────────────────────

export async function listAllCurrencies(): Promise<CurrencyEntry[]> {
  const rows = await db.currency.findMany({ orderBy: ORDER_BY });
  return rows.map(serialise);
}

export async function listEnabledCurrencies(): Promise<CurrencyEntry[]> {
  const rows = await db.currency.findMany({ where: { enabled: true }, orderBy: ORDER_BY });
  return rows.map(serialise);
}

export async function getDefaultCurrency(): Promise<CurrencyEntry | null> {
  const row = await db.currency.findFirst({ where: { isDefault: true, enabled: true }, orderBy: ORDER_BY });
  if (row) return serialise(row);
  const fallback = await db.currency.findFirst({ where: { enabled: true }, orderBy: ORDER_BY });
  return fallback ? serialise(fallback) : null;
}

// ── Mutations ──────────────────────────────────────────────────────────────────

export async function createCurrency(data: CreateCurrencyInput, actorId: string): Promise<CurrencyEntry> {
  const upper = data.code.toUpperCase();
  const existing = await db.currency.findUnique({ where: { code: upper } });
  if (existing) throw Object.assign(new Error(`Currency ${upper} already exists`), { statusCode: 409, code: "DUPLICATE_CODE" });

  const row = await db.currency.create({
    data: {
      code:       upper,
      name:       data.name,
      symbol:     data.symbol,
      rate:       data.rate,
      rateSource: data.rateSource ?? "manual",
      enabled:    true,
      sortOrder:  data.sortOrder ?? 999,
      country:    data.country ?? null,
      flag:       data.flag ?? null,
      isDefault:  false,
      updatedBy:  actorId,
    },
  });
  return serialise(row);
}

export async function updateCurrency(code: string, data: UpdateCurrencyInput, actorId: string): Promise<CurrencyEntry> {
  const upper = code.toUpperCase();
  const existing = await db.currency.findUnique({ where: { code: upper } });
  if (!existing) throw Object.assign(new Error(`Currency ${code} not found`), { statusCode: 404, code: "NOT_FOUND" });

  if (data.isDefault === true) {
    await db.currency.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  }

  const updateData: Record<string, any> = { updatedBy: actorId };
  if (data.name       !== undefined) updateData.name       = data.name;
  if (data.symbol     !== undefined) updateData.symbol     = data.symbol;
  if (data.rate       !== undefined) updateData.rate       = data.rate;
  if (data.rateSource !== undefined) updateData.rateSource = data.rateSource;
  if (data.enabled    !== undefined) updateData.enabled    = data.enabled;
  if (data.sortOrder  !== undefined) updateData.sortOrder  = data.sortOrder;
  if (data.country    !== undefined) updateData.country    = data.country;
  if (data.flag       !== undefined) updateData.flag       = data.flag;
  if (data.isDefault  !== undefined) updateData.isDefault  = data.isDefault;

  const row = await db.currency.update({ where: { code: upper }, data: updateData });
  return serialise(row);
}

export async function deleteCurrency(code: string): Promise<void> {
  const upper = code.toUpperCase();
  if (upper === "USD") throw Object.assign(new Error("USD cannot be deleted — it is the base currency"), { statusCode: 400, code: "CANNOT_DELETE_BASE" });
  const existing = await db.currency.findUnique({ where: { code: upper } });
  if (!existing) throw Object.assign(new Error(`Currency ${code} not found`), { statusCode: 404, code: "NOT_FOUND" });
  await db.currency.delete({ where: { code: upper } });
}

// ── Automatic rate sync ────────────────────────────────────────────────────────

export interface SyncResult {
  synced:  string[];
  skipped: string[];
  errors:  string[];
}

export async function syncAutomaticRates(actorId: string): Promise<SyncResult> {
  const autoCurrencies = await db.currency.findMany({ where: { rateSource: "automatic" } });

  if (autoCurrencies.length === 0) {
    return { synced: [], skipped: [], errors: ["No currencies configured with automatic rate source"] };
  }

  const codes = autoCurrencies.map(c => c.code);
  const synced:  string[] = [];
  const errors:  string[] = [];
  let fetchedRates: Record<string, number> = {};
  let lastError = "";

  for (const provider of RATE_PROVIDERS) {
    try {
      fetchedRates = await provider.fetchRates(codes);
      lastError = "";
      break;
    } catch (err: any) {
      lastError = `${provider.name}: ${err.message}`;
    }
  }

  if (lastError) return { synced: [], skipped: codes, errors: [lastError] };

  for (const currency of autoCurrencies) {
    const rate = fetchedRates[currency.code];
    if (!rate || rate <= 0) { errors.push(`${currency.code}: not returned by provider`); continue; }
    try {
      await db.currency.update({ where: { code: currency.code }, data: { rate, updatedBy: actorId } });
      synced.push(currency.code);
    } catch (err: any) {
      errors.push(`${currency.code}: ${err.message}`);
    }
  }

  return { synced, skipped: [], errors };
}
