/**
 * Admin Platform Text Service — manage all user-facing copy across the platform.
 *
 * Text is stored in SystemConfig with keys like "text.{page}.{field}".
 * Values are plain strings (NOT JSON-encoded objects).
 *
 * The frontend reads text via GET /api/v1/platform/text (public endpoint).
 * Admins edit text via PUT /api/v1/admin/text/:key.
 * A reset restores the key to its seeded default.
 */
import { db } from "../../../db";
import { setConfig } from "../config/admin.config.service";

export interface PlatformTextEntry {
  key:         string;
  page:        string;
  field:       string;
  value:       string;
  defaultValue: string;
  description: string | null;
  updatedAt:   string;
  updatedBy:   string | null;
  isCustomised: boolean; // true if value differs from defaultValue
}

// ── Default text registry ──────────────────────────────────────────────────────
// All editable platform text. Format: [key, defaultValue, description]

export const TEXT_DEFAULTS: Array<[string, string, string]> = [
  // Landing page
  ["text.landing.hero_title",       "Win Real Money Playing Games",              "Landing page main headline"],
  ["text.landing.hero_subtitle",    "Join thousands of players. Earn real cash from games, tasks, and referrals.", "Landing page subheadline"],
  ["text.landing.cta_primary",      "Get Started Free",                          "Landing page primary CTA button"],
  ["text.landing.cta_secondary",    "Learn More",                                "Landing page secondary CTA button"],
  ["text.landing.feature_games",    "Skill-Based Games",                         "Landing feature card title — games"],
  ["text.landing.feature_tasks",    "Earn from Tasks",                           "Landing feature card title — tasks"],
  ["text.landing.feature_referral", "Refer & Earn",                              "Landing feature card title — referrals"],
  ["text.landing.feature_vip",      "VIP Rewards",                               "Landing feature card title — VIP"],
  // Auth
  ["text.auth.login_title",         "Welcome Back",                              "Login page title"],
  ["text.auth.login_subtitle",      "Sign in to your Bitzimi account",           "Login page subtitle"],
  ["text.auth.login_cta",           "Sign In",                                   "Login button label"],
  ["text.auth.register_title",      "Create Your Account",                       "Registration page title"],
  ["text.auth.register_subtitle",   "Join Bitzimi and start earning today",      "Registration page subtitle"],
  ["text.auth.register_cta",        "Create Account",                            "Registration button label"],
  ["text.auth.forgot_title",        "Reset Your Password",                       "Forgot password page title"],
  ["text.auth.forgot_subtitle",     "Enter your email to receive reset instructions", "Forgot password subtitle"],
  // Wallet
  ["text.wallet.page_title",        "My Wallet",                                 "Wallet page heading"],
  ["text.wallet.deposit_hint",      "Funds are credited after network confirmation", "Deposit hint text"],
  ["text.wallet.withdraw_hint",     "Withdrawals are processed within 24 hours", "Withdrawal hint text"],
  ["text.wallet.empty_transactions","No transactions yet",                        "Empty state for transaction list"],
  // VIP
  ["text.vip.page_title",           "VIP Membership",                            "VIP page heading"],
  ["text.vip.page_subtitle",        "Unlock exclusive rewards and early access features", "VIP page subtitle"],
  ["text.vip.subscribe_cta",        "Become VIP",                                "VIP subscribe button"],
  ["text.vip.streak_title",         "Daily Streak Rewards",                      "VIP streak section title"],
  ["text.vip.streak_hint",          "Claim your daily reward to keep your streak alive", "VIP streak hint"],
  // Tasks
  ["text.tasks.page_title",         "Task Marketplace",                          "Tasks page heading"],
  ["text.tasks.page_subtitle",      "Complete tasks and earn real money",        "Tasks page subtitle"],
  ["text.tasks.empty_title",        "No tasks available",                        "Tasks empty state title"],
  ["text.tasks.empty_subtitle",     "Check back later for new opportunities",   "Tasks empty state subtitle"],
  ["text.tasks.create_cta",         "Create Task",                               "Create task button label"],
  // Games
  ["text.games.page_title",         "Games",                                     "Games hub page heading"],
  ["text.games.page_subtitle",      "Play skill-based games and win real cash",  "Games hub subtitle"],
  ["text.games.lobby_waiting",      "Waiting for players…",                      "Lobby waiting state label"],
  ["text.games.no_games",           "No games available right now",              "Games empty state"],
  // Profile
  ["text.profile.page_title",       "My Profile",                                "Profile page heading"],
  ["text.profile.edit_cta",         "Edit Profile",                              "Edit profile button"],
  ["text.profile.avatar_hint",      "Upload a profile photo",                    "Avatar upload hint"],
  // Referrals
  ["text.referrals.page_title",     "Referral Program",                          "Referrals page heading"],
  ["text.referrals.page_subtitle",  "Invite friends and earn rewards together",  "Referrals page subtitle"],
  ["text.referrals.empty_title",    "No referrals yet",                          "Referrals empty state title"],
  ["text.referrals.share_cta",      "Share Your Link",                           "Referral share button"],
  // KYC
  ["text.kyc.page_title",           "Identity Verification",                     "KYC page heading"],
  ["text.kyc.page_subtitle",        "Verify your identity to unlock all features", "KYC page subtitle"],
  ["text.kyc.pending_message",      "Your documents are under review. We'll notify you within 24 hours.", "KYC pending message"],
  // Notifications
  ["text.notifications.empty_title","No notifications",                          "Notifications empty state title"],
  ["text.notifications.empty_sub",  "You'll see updates and alerts here",        "Notifications empty state subtitle"],
  // Affiliate
  ["text.affiliate.page_title",     "Affiliate Program",                         "Affiliate page heading"],
  ["text.affiliate.page_subtitle",  "Earn commissions by growing the Bitzimi community", "Affiliate page subtitle"],
  // Settings
  ["text.settings.page_title",      "Settings",                                  "Settings page heading"],
  // Footer / Support
  ["text.support.contact_email",    "support@bitzimi.com",                       "Support contact email address"],
  ["text.support.response_time",    "We typically respond within 24 hours",     "Support response time message"],
  // System messages
  ["text.system.maintenance_title", "Under Maintenance",                         "Maintenance mode page title"],
  ["text.system.maintenance_msg",   "We'll be back shortly. Thank you for your patience.", "Maintenance mode message"],
];

// Build a lookup of defaults
export const TEXT_DEFAULT_MAP: Record<string, string> = Object.fromEntries(
  TEXT_DEFAULTS.map(([k, v]) => [k, v])
);

// ── Seed text defaults (idempotent) ────────────────────────────────────────────

export async function seedDefaultText() {
  for (const [key, value, description] of TEXT_DEFAULTS) {
    const existing = await db.systemConfig.findUnique({ where: { key } });
    if (!existing) {
      await db.systemConfig.create({
        data: { key, value: JSON.stringify(value), description },
      });
    }
  }
}

// ── List text entries ──────────────────────────────────────────────────────────

export async function adminListText(opts: {
  page?:   string;   // e.g. "landing", "auth"
  search?: string;   // search in key or value
}) {
  const { page, search } = opts;

  const where: any = {
    key: { startsWith: "text." },
  };

  if (page) {
    where.key = { startsWith: `text.${page}.` };
  }

  if (search?.trim()) {
    const term = search.trim();
    where.OR = [
      { key:         { contains: term } },
      { value:       { contains: term } },
      { description: { contains: term } },
    ];
    // Keep the text.* prefix constraint
    if (!page) where.AND = [{ key: { startsWith: "text." } }];
  }

  const rows = await db.systemConfig.findMany({
    where,
    orderBy: { key: "asc" },
  });

  return rows.map(r => {
    const [, pg, ...fieldParts] = r.key.split(".");
    const field = fieldParts.join(".");
    const rawVal = (() => { try { return JSON.parse(r.value); } catch { return r.value; } })();
    const strVal = typeof rawVal === "string" ? rawVal : r.value;
    const defaultVal = TEXT_DEFAULT_MAP[r.key] ?? "";
    return {
      key:          r.key,
      page:         pg ?? "",
      field:        field ?? "",
      value:        strVal,
      defaultValue: defaultVal,
      description:  r.description ?? null,
      updatedAt:    r.updatedAt.toISOString(),
      updatedBy:    r.updatedBy ?? null,
      isCustomised: strVal !== defaultVal,
    } satisfies PlatformTextEntry;
  });
}

// ── Get distinct page groups ───────────────────────────────────────────────────

export async function adminListTextPages() {
  const rows = await db.systemConfig.findMany({
    where: { key: { startsWith: "text." } },
    select: { key: true },
    orderBy: { key: "asc" },
  });
  const pages = new Set<string>();
  for (const r of rows) {
    const [, pg] = r.key.split(".");
    if (pg) pages.add(pg);
  }
  return Array.from(pages).sort();
}

// ── Update a text entry ────────────────────────────────────────────────────────

export async function adminSetText(key: string, value: string, adminId: string) {
  if (!key.startsWith("text.")) {
    throw Object.assign(new Error("Key must start with 'text.'"), { statusCode: 400 });
  }
  await setConfig(key, value, adminId);
  return { key, value };
}

// ── Reset a text entry to default ─────────────────────────────────────────────

export async function adminResetText(key: string, adminId: string) {
  const defaultVal = TEXT_DEFAULT_MAP[key];
  if (defaultVal === undefined) {
    throw Object.assign(new Error("No default value found for this key"), { statusCode: 404 });
  }
  await setConfig(key, defaultVal, adminId);
  return { key, value: defaultVal };
}
