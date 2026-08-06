/**
 * Admin System Configuration Service
 *
 * Provides CRUD for the SystemConfig key-value store.
 * Used for: feature toggles, maintenance mode, and configurable platform settings.
 *
 * Key naming convention:
 *   feature.<name>         — feature toggle (value: "true"/"false")
 *   maintenance.enabled    — global maintenance mode (value: "true"/"false")
 *   maintenance.message    — message shown during maintenance
 *   platform.<setting>     — platform-wide settings
 */
import { db } from "../../../db";

export interface ConfigEntry {
  key:         string;
  value:       any;           // parsed JSON value
  rawValue:    string;        // raw JSON string stored in DB
  description: string | null;
  updatedAt:   string;
  updatedBy:   string | null;
}

function serialise(row: any): ConfigEntry {
  let parsed: any;
  try { parsed = JSON.parse(row.value); } catch { parsed = row.value; }
  return {
    key:         row.key,
    value:       parsed,
    rawValue:    row.value,
    description: row.description ?? null,
    updatedAt:   row.updatedAt.toISOString(),
    updatedBy:   row.updatedBy ?? null,
  };
}

/** Return all config entries. */
export async function listConfig(): Promise<ConfigEntry[]> {
  const rows = await db.systemConfig.findMany({ orderBy: { key: "asc" } });
  return rows.map(serialise);
}

/** Return a single config entry by key, or null if not set. */
export async function getConfig(key: string): Promise<ConfigEntry | null> {
  const row = await db.systemConfig.findUnique({ where: { key } });
  return row ? serialise(row) : null;
}

/** Get a raw parsed value for a key, or a default if not set. */
export async function getConfigValue<T = any>(key: string, defaultValue: T): Promise<T> {
  const entry = await getConfig(key);
  if (!entry) return defaultValue;
  return entry.value as T;
}

/** Set (upsert) a config entry. Value is JSON-serialised before storage. */
export async function setConfig(
  key:         string,
  value:       any,
  updatedBy:   string,
  description?: string,
): Promise<ConfigEntry> {
  const rawValue = JSON.stringify(value);
  const row = await db.systemConfig.upsert({
    where:  { key },
    create: { key, value: rawValue, description: description ?? null, updatedBy },
    update: { value: rawValue, updatedBy, ...(description !== undefined && { description }) },
  });
  return serialise(row);
}

/** Delete a config entry. Returns true if it existed. */
export async function deleteConfig(key: string): Promise<boolean> {
  const row = await db.systemConfig.findUnique({ where: { key } });
  if (!row) return false;
  await db.systemConfig.delete({ where: { key } });
  return true;
}

// ── Convenience helpers used by the maintenance hook and feature checks ────────

/** True if maintenance mode is currently enabled. */
export async function isMaintenanceEnabled(): Promise<boolean> {
  return getConfigValue<boolean>("maintenance.enabled", false);
}

/**
 * Get the effective fee rate for a specific game.
 * Priority: game.{gameName}.fee_rate → game.platform_fee_rate → hardcoded 0.10
 *
 * This is the single correct way to retrieve game fee rates.
 * Using this helper ensures that admin changes to game.platform_fee_rate
 * take effect immediately across all games without redeploy.
 */
export async function getGameFeeRate(gameName: string): Promise<number> {
  const platformDefault = await getConfigValue<number>("game.platform_fee_rate", 0.10);
  return getConfigValue<number>(`game.${gameName}.fee_rate`, platformDefault);
}

/** True if a named feature is enabled (defaults to true if not configured). */
export async function isFeatureEnabled(featureName: string, defaultValue = true): Promise<boolean> {
  return getConfigValue<boolean>(`feature.${featureName}`, defaultValue);
}

export type FeatureAccessLevel = "all" | "vip" | "staff" | "admin" | "disabled";

/**
 * Get the access level for a named feature.
 * Reads feature.access.<featureName> from SystemConfig.
 * Defaults to "all" if not configured (safe open default).
 */
export async function getFeatureAccessLevel(featureName: string): Promise<FeatureAccessLevel> {
  return getConfigValue<FeatureAccessLevel>(`feature.access.${featureName}`, "all");
}

/**
 * Determine if a user can access a feature given their role and VIP status.
 * admin roles (non-"user") always bypass access restrictions.
 */
export function canAccessFeature(
  level: FeatureAccessLevel,
  role: string,
  isVip: boolean,
): boolean {
  if (level === "disabled") return false;
  if (level === "all")      return true;
  const isAdmin = role !== "user";
  if (isAdmin)              return true;   // all admin roles bypass access gates
  if (level === "vip")      return isVip;
  if (level === "staff")    return false;  // staff = admin roles only; regular users blocked
  if (level === "admin")    return false;  // admin = super_admin only (handled above for admin roles)
  return true;
}

// ── Default config seeding (called on server start if entries are missing) ────

const DEFAULT_CONFIGS: Array<{ key: string; value: any; description: string }> = [
  { key: "maintenance.enabled",       value: false,  description: "Global maintenance mode — blocks all non-admin API requests with 503" },
  { key: "maintenance.message",       value: "Platform is under maintenance. Please try again shortly.", description: "Message returned during maintenance" },
  { key: "feature.bank_deposits",     value: false,  description: "Enable NGN bank deposit flow for Nigerian users" },
  { key: "feature.bank_withdrawals",  value: false,  description: "Enable NGN bank withdrawal flow for Nigerian users" },
  { key: "feature.crypto_deposits",   value: true,   description: "Enable USDT BEP-20 crypto deposit flow" },
  { key: "feature.crypto_withdrawals",value: true,   description: "Enable USDT BEP-20 crypto withdrawal flow" },
  { key: "feature.kyc_required_vip",  value: true,   description: "Require KYC verification before VIP upgrade" },
  { key: "feature.task_marketplace",  value: true,   description: "Enable the task marketplace for users" },
  { key: "feature.affiliate_program", value: true,   description: "Enable the affiliate / referral program" },
  // ── Feature access levels (who can access a feature) ─────────────────────────
  // Values: "all" | "vip" | "staff" | "admin" | "disabled"
  //   "all"      — any authenticated user
  //   "vip"      — VIP subscribers + all admin roles (Early Access)
  //   "staff"    — any admin role (support, finance, moderator, super)
  //   "admin"    — super_admin only
  //   "disabled" — feature is turned off for everyone
  { key: "feature.access.football_prediction", value: "vip",  description: "Football AI Prediction access level: all | vip | staff | admin | disabled" },
  { key: "platform.vip_price_usd",    value: 4,      description: "Monthly VIP subscription price in USD" },
  { key: "platform.min_withdrawal",   value: 7,      description: "Minimum withdrawal amount in USD (gross, before fee)" },
  // ── Withdrawal fees (override env vars BANK_WITHDRAWAL_FEE_NGN / CRYPTO_WITHDRAWAL_FEE_USD) ──
  // Bank fee is stored in NGN and converted to USD at runtime via the live Currency Management rate.
  // Crypto fee is stored in USD. Both are flat fees, not percentages.
  // Changes take effect immediately (no cache) — no server restart required.
  { key: "withdrawal.fee_bank_ngn",   value: 1500,   description: "Fixed NGN fee deducted from bank withdrawals (converted to USD at live rate)" },
  { key: "withdrawal.fee_crypto_usd", value: 1,      description: "Fixed USD fee deducted from crypto withdrawals" },
  // ── Withdrawal tier limits by KYC/VIP status ─────────────────────────────────────────────
  // free = no KYC, no VIP; verified = KYC approved; vip = active VIP subscription.
  // Changes take effect immediately. All amounts in USD.
  { key: "withdrawal.limits.free.daily",       value: 100,    description: "Free-tier daily withdrawal cap (USD)" },
  { key: "withdrawal.limits.free.monthly",     value: 1000,   description: "Free-tier monthly withdrawal cap (USD)" },
  { key: "withdrawal.limits.verified.daily",   value: 1000,   description: "KYC-verified daily withdrawal cap (USD)" },
  { key: "withdrawal.limits.verified.monthly", value: 10000,  description: "KYC-verified monthly withdrawal cap (USD)" },
  { key: "withdrawal.limits.vip.daily",        value: 10000,  description: "VIP daily withdrawal cap (USD)" },
  { key: "withdrawal.limits.vip.monthly",      value: 100000, description: "VIP monthly withdrawal cap (USD)" },
  // ── Deposit minimums (override env vars CRYPTO_MIN_DEPOSIT / BANK_MIN_DEPOSIT_NGN) ──────
  { key: "deposit.crypto_minimum_usd", value: 5,    description: "Minimum USDT crypto deposit amount (USD)" },
  { key: "deposit.bank_minimum_ngn",   value: 5000, description: "Minimum NGN bank deposit amount (NGN, converted to USD at live rate for display)" },
  // ── Global game platform fee (informational — per-game keys game.{name}.fee_rate take precedence) ──
  { key: "game.platform_fee_rate", value: 0.10, description: "Default platform fee rate for all games (0–0.50). Each game also has its own game.{name}.fee_rate key that overrides this." },
  // ── Referral & Affiliate reward configuration ─────────────────────────────────
  // Runtime services (referrals.service.ts, commissions.ts, vip.service.ts) read these
  // values at runtime with a 60-second in-memory cache. Changes take effect within 1 minute.
  { key: "referral.bonus_usd",                        value: 0.50,             description: "One-time referral reward paid to referrer on first VIP purchase of the referred user (USD)" },
  { key: "affiliate.commission_rates.vip_subscription",value: [0.28, 0.07, 0.04], description: "3-tier affiliate commission rates for VIP subscription event [tier1, tier2, tier3]" },
  { key: "affiliate.commission_rates.task_completion", value: [0.10, 0.03, 0.02], description: "3-tier affiliate commission rates for task completion event [tier1, tier2, tier3]" },
  { key: "affiliate.commission_rates.game_fee",        value: [0.20, 0.05, 0.03], description: "3-tier affiliate commission rates for 1v1 game fee event [tier1, tier2, tier3]" },
  { key: "affiliate.commission_rates.game_fee_multi",  value: [0.10, 0.03, 0.02], description: "3-tier affiliate commission rates for multi-player game fee event [tier1, tier2, tier3]" },
  { key: "affiliate.min_members_to_apply",             value: 1000,            description: "Minimum social media members/followers required to apply for the affiliate program" },
  { key: "vip.streak_rewards_usd",                     value: [0.05, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50], description: "VIP daily streak rewards per day 1-7 (USD)" },
  { key: "vip.streak_reset_hours",                     value: 48,              description: "Hours of inactivity before VIP streak resets to 0" },
  // ── Game enable / maintenance / fee ──────────────────────────────────────────
  { key: "game.color_game.enabled",     value: true,  description: "Enable Color Prediction game" },
  { key: "game.color_game.maintenance", value: false, description: "Color Prediction maintenance mode" },
  { key: "game.color_game.fee_rate",    value: 0.10,  description: "Color Prediction platform fee (0–0.50)" },
  { key: "game.spin_battle.enabled",    value: true,  description: "Enable Spin Battle game" },
  { key: "game.spin_battle.maintenance",value: false, description: "Spin Battle maintenance mode" },
  { key: "game.spin_battle.fee_rate",   value: 0.10,  description: "Spin Battle platform fee (0–0.50)" },
  { key: "game.dice_royale.enabled",    value: true,  description: "Enable Dice Royale game" },
  { key: "game.dice_royale.maintenance",value: false, description: "Dice Royale maintenance mode" },
  { key: "game.dice_royale.fee_rate",   value: 0.10,  description: "Dice Royale platform fee (0–0.50)" },
  { key: "game.dice_arena.enabled",     value: true,  description: "Enable Dice Arena game" },
  { key: "game.dice_arena.maintenance", value: false, description: "Dice Arena maintenance mode" },
  { key: "game.dice_arena.fee_rate",    value: 0.10,  description: "Dice Arena platform fee (0–0.50)" },
  { key: "game.dice_clash.enabled",     value: true,  description: "Enable Dice Clash game" },
  { key: "game.dice_clash.maintenance", value: false, description: "Dice Clash maintenance mode" },
  { key: "game.dice_clash.fee_rate",    value: 0.10,  description: "Dice Clash platform fee (0–0.50)" },
  { key: "game.pvp_coinflip.enabled",    value: true,  description: "Enable Coin Flip game" },
  { key: "game.pvp_coinflip.maintenance",value: false, description: "Coin Flip maintenance mode" },
  { key: "game.pvp_coinflip.fee_rate",   value: 0.10,  description: "Coin Flip platform fee (0–0.50)" },
  { key: "game.reaction_tap.enabled",    value: true,  description: "Enable Reaction Tap game" },
  { key: "game.reaction_tap.maintenance",value: false, description: "Reaction Tap maintenance mode" },
  { key: "game.reaction_tap.fee_rate",   value: 0.10,  description: "Reaction Tap platform fee (0–0.50)" },
  // ── Color Prediction lobby config ─────────────────────────────────────────────
  { key: "game.color_game.lobby.A.enabled", value: true, description: "Color lobby A enabled" },
  { key: "game.color_game.lobby.A.min_bet", value: 1,    description: "Color lobby A min bet (USD)" },
  { key: "game.color_game.lobby.A.max_bet", value: 20,   description: "Color lobby A max bet (USD)" },
  { key: "game.color_game.lobby.A.order",   value: 1,    description: "Color lobby A display order" },
  { key: "game.color_game.lobby.B.enabled", value: true, description: "Color lobby B enabled" },
  { key: "game.color_game.lobby.B.min_bet", value: 21,   description: "Color lobby B min bet (USD)" },
  { key: "game.color_game.lobby.B.max_bet", value: 100,  description: "Color lobby B max bet (USD)" },
  { key: "game.color_game.lobby.B.order",   value: 2,    description: "Color lobby B display order" },
  { key: "game.color_game.lobby.C.enabled", value: true, description: "Color lobby C enabled" },
  { key: "game.color_game.lobby.C.min_bet", value: 101,  description: "Color lobby C min bet (USD)" },
  { key: "game.color_game.lobby.C.max_bet", value: 1000, description: "Color lobby C max bet (USD)" },
  { key: "game.color_game.lobby.C.order",   value: 3,    description: "Color lobby C display order" },
  { key: "game.color_game.lobby.D.enabled", value: true, description: "Color lobby D enabled" },
  { key: "game.color_game.lobby.D.min_bet", value: 1001, description: "Color lobby D min bet (USD)" },
  { key: "game.color_game.lobby.D.max_bet", value: 5000, description: "Color lobby D max bet (USD)" },
  { key: "game.color_game.lobby.D.order",   value: 4,    description: "Color lobby D display order" },
  // ── Spin Battle lobby config ──────────────────────────────────────────────────
  { key: "game.spin_battle.lobby.A.enabled", value: true, description: "Spin lobby A enabled" },
  { key: "game.spin_battle.lobby.A.min_bet", value: 1,    description: "Spin lobby A min bet (USD)" },
  { key: "game.spin_battle.lobby.A.max_bet", value: 20,   description: "Spin lobby A max bet (USD)" },
  { key: "game.spin_battle.lobby.A.order",   value: 1,    description: "Spin lobby A display order" },
  { key: "game.spin_battle.lobby.B.enabled", value: true, description: "Spin lobby B enabled" },
  { key: "game.spin_battle.lobby.B.min_bet", value: 21,   description: "Spin lobby B min bet (USD)" },
  { key: "game.spin_battle.lobby.B.max_bet", value: 50,   description: "Spin lobby B max bet (USD)" },
  { key: "game.spin_battle.lobby.B.order",   value: 2,    description: "Spin lobby B display order" },
  { key: "game.spin_battle.lobby.C.enabled", value: true, description: "Spin lobby C enabled" },
  { key: "game.spin_battle.lobby.C.min_bet", value: 51,   description: "Spin lobby C min bet (USD)" },
  { key: "game.spin_battle.lobby.C.max_bet", value: 120,  description: "Spin lobby C max bet (USD)" },
  { key: "game.spin_battle.lobby.C.order",   value: 3,    description: "Spin lobby C display order" },
  { key: "game.spin_battle.lobby.D.enabled", value: true, description: "Spin lobby D enabled" },
  { key: "game.spin_battle.lobby.D.min_bet", value: 121,  description: "Spin lobby D min bet (USD)" },
  { key: "game.spin_battle.lobby.D.max_bet", value: 500,  description: "Spin lobby D max bet (USD)" },
  { key: "game.spin_battle.lobby.D.order",   value: 4,    description: "Spin lobby D display order" },
  // ── Lobby ID lists (dynamic — admin can add new lobbies) ─────────────────────
  { key: "game.color_game.lobby_ids",  value: ["A","B","C","D"], description: "Color Prediction active lobby IDs" },
  { key: "game.spin_battle.lobby_ids", value: ["A","B","C","D"], description: "Spin Battle active lobby IDs" },
  // ── Room mode flags (default false — future activation; doesn't affect current player flow) ─
  { key: "game.color_game.room_mode",  value: false, description: "Color Prediction room-selection mode (future feature)" },
  { key: "game.spin_battle.room_mode", value: false, description: "Spin Battle room-selection mode (future feature)" },
  { key: "game.dice_royale.room_mode", value: false, description: "Dice Royale room-selection mode (future feature)" },
  { key: "game.dice_arena.room_mode",  value: false, description: "Dice Arena room-selection mode (future feature)" },
  // ── Stake-selection game available stakes ─────────────────────────────────────
  { key: "game.dice_royale.stakes",  value: [1, 5, 10, 20, 50, 100],          description: "Dice Royale available stake values (USD)" },
  { key: "game.dice_arena.stakes",   value: [1, 5, 10, 20, 50, 100],          description: "Dice Arena available stake values (USD)" },
  { key: "game.dice_clash.stakes",   value: [1, 5, 10, 20, 50, 100, 200, 500], description: "Dice Clash available stake values (USD)" },
  { key: "game.pvp_coinflip.stakes", value: [1, 5, 10, 20, 50, 100, 200, 500], description: "Coin Flip available stake values (USD)" },
  { key: "game.reaction_tap.stakes", value: [1, 5, 10, 20, 50, 100, 200, 500], description: "Reaction Tap available stake values (USD)" },
  // ── Phase 20 — Ambassador Program feature flags ────────────────────────────
  { key: "feature.ambassador_program",      value: false, description: "Enable the Ambassador Program — disabled until Phase 20.3 launch" },
  { key: "feature.monthly_challenge",       value: false, description: "Enable the Monthly Referral Challenge — disabled until Phase 20.3 launch" },
  { key: "feature.football_daily_points",   value: false, description: "Enable Football AI daily points earning and conversion — disabled until Phase 20.3 launch" },
  // ── Phase 20 — Ambassador commission rates ────────────────────────────────
  // Applied when the beneficiary has programLevel = "ambassador"
  // Higher than standard affiliate rates — reward for building the platform's reach
  { key: "ambassador.commission_rates.vip_subscription", value: [0.40, 0.10, 0.06], description: "3-tier ambassador commission rates for VIP subscription event [tier1, tier2, tier3]" },
  { key: "ambassador.commission_rates.task_completion",  value: [0.10, 0.03, 0.02], description: "3-tier ambassador commission rates for task completion event [tier1, tier2, tier3]" },
  { key: "ambassador.commission_rates.game_fee",         value: [0.40, 0.10, 0.06], description: "3-tier ambassador commission rates for 1v1 game fee event [tier1, tier2, tier3]" },
  { key: "ambassador.commission_rates.game_fee_multi",   value: [0.20, 0.06, 0.04], description: "3-tier ambassador commission rates for multi-player game fee event [tier1, tier2, tier3]" },
  // ── Phase 20 — Football daily points conversion rate ─────────────────────
  { key: "football.points_per_day",         value: 25,   description: "Points awarded per Football Hub daily claim" },
  { key: "football.points_per_conversion",  value: 1000, description: "Points required per conversion batch" },
  { key: "football.usd_per_conversion",     value: 2.00, description: "USD credited to game wallet per conversion batch" },
  // ── Phase 21 — Featured Promotion & Platform Announcement System ──────────
  { key: "feature.featured_promotions",        value: false, description: "Master switch — show Featured Promotion cards on wallet, marketplace, referral, affiliate, ambassador pages" },
  { key: "feature.platform_announcements",     value: false, description: "Enable Super Admin to create platform-wide announcement promotions" },
  { key: "feature.featured_marketplace_tasks", value: false, description: "Enable users to pay for featured placement of their approved marketplace tasks" },
  // ── Phase 22 — Auction Marketplace ──────────────────────────────────────
  { key: "feature.auction_marketplace", value: false, description: "Master switch — show Auction Marketplace in game lobby and hub" },
  { key: "feature.auction_live",        value: false, description: "Show live auctions to users (requires auction_marketplace)" },
  { key: "feature.auction_bidding",     value: false, description: "Allow users to place bids on live auctions" },
  { key: "feature.auction_claim",       value: false, description: "Allow winners to claim their auction rewards" },
  // ── Phase 24.2 — Platform Identity ────────────────────────────────────────
  { key: "platform.name",               value: "BitZimi",                description: "Platform display name shown throughout the UI" },
  { key: "platform.tagline",            value: "Play. Earn. Grow.",      description: "Short marketing tagline shown on the landing page" },
  { key: "platform.base_url",           value: "https://bitzimi.com",    description: "Canonical base URL used for referral and affiliate links" },
  { key: "platform.support_email",      value: "support@bitzimi.com",    description: "Support email shown on the landing page and in system emails" },
  { key: "platform.logo_url",           value: "",                       description: "Full URL to platform logo image (SVG or PNG). Leave blank to use bundled logo." },
  { key: "platform.favicon_url",        value: "",                       description: "Full URL to favicon. Applied dynamically to the browser tab." },
  { key: "platform.copyright_year",     value: "2026",                   description: "Year displayed in the footer copyright notice" },
  { key: "platform.company_name",       value: "BitZimi Ltd",            description: "Legal entity name used in Terms & Privacy documents" },
  { key: "platform.social.twitter",     value: "",                       description: "Twitter/X profile URL" },
  { key: "platform.social.telegram",    value: "",                       description: "Telegram group/channel URL" },
  { key: "platform.social.instagram",   value: "",                       description: "Instagram profile URL" },
  // ── Phase 24.2 — Auth / Registration ──────────────────────────────────────
  { key: "platform.registration_enabled",   value: true, description: "When false, new user registrations are blocked" },
  { key: "platform.session_timeout_days",   value: 7,    description: "JWT session lifetime in days" },
  { key: "platform.password_min_length",    value: 8,    description: "Minimum password character length enforced at registration" },
  { key: "platform.default_language",       value: "en", description: "Default language code used for new users" },
  { key: "platform.default_currency",       value: "USD",description: "Default display currency for new users" },
  // ── Phase 24.2 — Additional Platform / Auth / Legal ──────────────────────
  { key: "platform.email_verification_required", value: true,   description: "Require email verification before users can log in" },
  { key: "platform.require_2fa_for_withdrawal",  value: false,  description: "Require 2FA to process withdrawals" },
  { key: "platform.contact_email",               value: "",     description: "General contact email shown in footer/about" },
  { key: "platform.contact_phone",               value: "",     description: "Contact phone number shown on the site" },
  { key: "platform.terms_url",                   value: "",     description: "URL to Terms & Conditions page (blank = use static page)" },
  { key: "platform.privacy_url",                 value: "",     description: "URL to Privacy Policy page" },
  { key: "platform.cookie_policy_url",           value: "",     description: "URL to Cookie Policy page" },
  { key: "platform.about_url",                   value: "",     description: "URL to About Us page" },
  { key: "platform.social.facebook",             value: "",     description: "Facebook page URL" },
  { key: "platform.social.youtube",              value: "",     description: "YouTube channel URL" },
  { key: "platform.social.whatsapp",             value: "",     description: "WhatsApp group/contact link" },
  // ── Phase 24.2 — Feature access levels ────────────────────────────────────
  { key: "feature.access.auction_marketplace", value: "all",  description: "Auction Marketplace access: all | vip | staff | admin | disabled" },
  { key: "feature.access.ambassador_program",  value: "all",  description: "Ambassador Program access: all | vip | staff | admin | disabled" },
  { key: "feature.access.monthly_challenge",   value: "all",  description: "Monthly Challenge access: all | vip | staff | admin | disabled" },
  // ── Phase 24.2 — System ───────────────────────────────────────────────────
  { key: "system.max_upload_size_mb",   value: 5,    description: "Maximum file upload size in megabytes" },
  { key: "system.log_retention_days",   value: 90,   description: "Number of days to retain audit and system logs" },
  { key: "system.debug_mode",           value: false, description: "Enable verbose debug logging (never enable in production)" },
  // ── Task reward split by user tier ───────────────────────────────────────────
  // Fraction of rewardPerSlot credited to the worker on proof approval.
  // Changes take effect on the next proof submission (not retroactive).
  { key: "task.reward_split.free",     value: 0.35, description: "Fraction of task rewardPerSlot paid to free-tier workers (0–1)" },
  { key: "task.reward_split.verified", value: 0.45, description: "Fraction of task rewardPerSlot paid to KYC-verified workers (0–1)" },
  { key: "task.reward_split.vip",      value: 0.65, description: "Fraction of task rewardPerSlot paid to VIP workers (0–1)" },
  // ── Dice Arena prize distribution ─────────────────────────────────────────────
  // 1st + 2nd splits must sum to ≤ 1.0. Backend validates and falls back to 0.60/0.40 if invalid.
  { key: "game.dice_arena.payout_split_1st", value: 0.60, description: "Fraction of Dice Arena prize pool awarded to 1st place (must sum ≤ 1 with 2nd-place split)" },
  { key: "game.dice_arena.payout_split_2nd", value: 0.40, description: "Fraction of Dice Arena prize pool awarded to 2nd place (must sum ≤ 1 with 1st-place split)" },
  // ── Ambassador activity score weights ─────────────────────────────────────────
  // Composite score = sum(dimension × weight). Weights are independent; no forced normalisation.
  // Changes take effect on next activity event for each ambassador.
  { key: "ambassador.activity_weights.game",     value: 0.25, description: "Weight of game activity in ambassador composite score (0–1)" },
  { key: "ambassador.activity_weights.deposit",  value: 0.20, description: "Weight of deposit activity in ambassador composite score (0–1)" },
  { key: "ambassador.activity_weights.vip",      value: 0.20, description: "Weight of VIP subscription activity in ambassador composite score (0–1)" },
  { key: "ambassador.activity_weights.task",     value: 0.15, description: "Weight of task completion activity in ambassador composite score (0–1)" },
  { key: "ambassador.activity_weights.football", value: 0.05, description: "Weight of Football Hub activity in ambassador composite score (0–1)" },
  { key: "ambassador.activity_weights.other",    value: 0.15, description: "Weight of other platform activity in ambassador composite score (0–1)" },
];

/** Seed default config values. Safe to call on every server start — skips existing keys. */
export async function seedDefaultConfig(): Promise<void> {
  for (const entry of DEFAULT_CONFIGS) {
    await db.systemConfig.upsert({
      where:  { key: entry.key },
      create: { key: entry.key, value: JSON.stringify(entry.value), description: entry.description },
      update: {},  // do NOT overwrite existing values
    });
  }
}
