/**
 * Translation Management Service — Phase 24.2
 *
 * Manages TranslationKey and Translation tables.
 *
 * Architecture:
 *  - TranslationKey stores the canonical key + English default value.
 *  - Translation stores per-language overrides.
 *  - Fetching a bundle falls back to the defaultValue if no Translation row exists.
 *  - AI auto-translation via Anthropic API (claude-haiku-4-5-20251001), batch of 50 keys.
 */
import { db } from "../../../db";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TranslationKeyRow {
  key:          string;
  namespace:    string;
  defaultValue: string;
  description:  string | null;
}

export interface TranslationSummaryRow {
  languageCode:  string;
  languageName:  string;
  total:         number;
  translated:    number;
  missing:       number;
  percentage:    number;
}

export interface MissingKey {
  key:          string;
  namespace:    string;
  defaultValue: string;
}

// ── Read ───────────────────────────────────────────────────────────────────────

/** Returns a flat bundle { key: translated_value } for the given language code. Falls back to defaultValue. */
export async function getTranslationsForLanguage(langCode: string): Promise<Record<string, string>> {
  const [keys, translations] = await Promise.all([
    db.translationKey.findMany(),
    db.translation.findMany({ where: { languageCode: langCode } }),
  ]);
  const translationMap: Record<string, string> = {};
  for (const t of translations) translationMap[t.key] = t.value;
  const bundle: Record<string, string> = {};
  for (const k of keys) {
    bundle[k.key] = translationMap[k.key] ?? k.defaultValue;
  }
  return bundle;
}

/** Returns keys that have no Translation row for the given language. */
export async function getMissingTranslations(langCode: string): Promise<MissingKey[]> {
  const [allKeys, existing] = await Promise.all([
    db.translationKey.findMany({ orderBy: { key: "asc" } }),
    db.translation.findMany({ where: { languageCode: langCode }, select: { key: true } }),
  ]);
  const existingSet = new Set(existing.map(t => t.key));
  return allKeys
    .filter(k => !existingSet.has(k.key))
    .map(k => ({ key: k.key, namespace: k.namespace, defaultValue: k.defaultValue }));
}

/** Summary: how complete is each language? */
export async function getTranslationSummary(): Promise<TranslationSummaryRow[]> {
  const [languages, totalKeys, translations] = await Promise.all([
    db.language.findMany({ orderBy: { sortOrder: "asc" } }),
    db.translationKey.count(),
    db.translation.groupBy({ by: ["languageCode"], _count: { key: true } }),
  ]);
  const countMap: Record<string, number> = {};
  for (const t of translations) countMap[t.languageCode] = t._count.key;
  return languages.map(l => {
    const translated = countMap[l.code] ?? 0;
    const missing = Math.max(0, totalKeys - translated);
    return {
      languageCode: l.code,
      languageName: l.name,
      total:        totalKeys,
      translated,
      missing,
      percentage:   totalKeys > 0 ? Math.round((translated / totalKeys) * 100 * 10) / 10 : 100,
    };
  });
}

// ── Write ──────────────────────────────────────────────────────────────────────

export async function upsertTranslation(
  langCode: string,
  key: string,
  value: string,
  isAutoTranslated = false,
  changedBy?: string,
): Promise<void> {
  // Fetch existing value for history tracking
  const existing = await db.translation.findUnique({
    where: { languageCode_key: { languageCode: langCode, key } },
    select: { value: true },
  });

  await db.translation.upsert({
    where:  { languageCode_key: { languageCode: langCode, key } },
    create: { languageCode: langCode, key, value, isAutoTranslated, isApproved: !isAutoTranslated },
    update: { value, isAutoTranslated, updatedAt: new Date() },
  });

  // Record history entry whenever the value changes (or is created)
  if (!existing || existing.value !== value) {
    await db.translationHistory.create({
      data: {
        languageCode: langCode,
        key,
        oldValue:  existing?.value ?? null,
        newValue:  value,
        changedBy: changedBy ?? null,
      },
    });
  }
}

export async function bulkImportTranslations(
  langCode: string,
  bundle: Record<string, string>,
  isAutoTranslated = false,
): Promise<number> {
  let count = 0;
  for (const [key, value] of Object.entries(bundle)) {
    const exists = await db.translationKey.findUnique({ where: { key } });
    if (!exists) continue;
    await upsertTranslation(langCode, key, value, isAutoTranslated);
    count++;
  }
  return count;
}

export async function upsertTranslationKey(
  key: string,
  defaultValue: string,
  namespace = "common",
  description?: string,
): Promise<void> {
  await db.translationKey.upsert({
    where:  { key },
    create: { key, defaultValue, namespace, description },
    update: { defaultValue, namespace, ...(description && { description }) },
  });
}

export async function deleteTranslationKey(key: string): Promise<void> {
  await db.translationKey.delete({ where: { key } });
}

export async function listTranslationKeys(): Promise<TranslationKeyRow[]> {
  const rows = await db.translationKey.findMany({ orderBy: { key: "asc" } });
  return rows.map(r => ({ key: r.key, namespace: r.namespace, defaultValue: r.defaultValue, description: r.description ?? null }));
}

// ── Approval workflow ──────────────────────────────────────────────────────────

export interface PendingTranslation {
  key:          string;
  namespace:    string;
  defaultValue: string;
  value:        string;
}

/** Returns auto-translated, not-yet-approved translations for a language. */
export async function getPendingTranslations(langCode: string): Promise<PendingTranslation[]> {
  const [pending, keys] = await Promise.all([
    db.translation.findMany({
      where: { languageCode: langCode, isAutoTranslated: true, isApproved: false },
      orderBy: { key: "asc" },
    }),
    db.translationKey.findMany({ select: { key: true, namespace: true, defaultValue: true } }),
  ]);
  const keyMap: Record<string, { namespace: string; defaultValue: string }> = {};
  for (const k of keys) keyMap[k.key] = { namespace: k.namespace, defaultValue: k.defaultValue };
  return pending.map(t => ({
    key:          t.key,
    namespace:    keyMap[t.key]?.namespace ?? "common",
    defaultValue: keyMap[t.key]?.defaultValue ?? t.key,
    value:        t.value,
  }));
}

export interface TranslationHistoryRow {
  id:          number;
  oldValue:    string | null;
  newValue:    string;
  changedBy:   string | null;
  createdAt:   string;
}

/** Returns version history for a specific key in a language, newest first. */
export async function getTranslationHistory(langCode: string, key: string): Promise<TranslationHistoryRow[]> {
  const rows = await db.translationHistory.findMany({
    where:   { languageCode: langCode, key },
    orderBy: { createdAt: "desc" },
    take:    50,
  });
  return rows.map(r => ({
    id:        r.id,
    oldValue:  r.oldValue,
    newValue:  r.newValue,
    changedBy: r.changedBy,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Set isApproved for a single translation. */
export async function setTranslationApproval(langCode: string, key: string, approved: boolean): Promise<void> {
  await db.translation.update({
    where: { languageCode_key: { languageCode: langCode, key } },
    data:  { isApproved: approved, updatedAt: new Date() },
  });
}

/** Approve all auto-translated translations for a language. Returns count approved. */
export async function approveAllAutoTranslated(langCode: string): Promise<number> {
  const result = await db.translation.updateMany({
    where: { languageCode: langCode, isAutoTranslated: true, isApproved: false },
    data:  { isApproved: true },
  });
  return result.count;
}

// ── AI Auto-translation ────────────────────────────────────────────────────────

async function callAnthropicTranslate(
  items: Array<{ key: string; value: string }>,
  targetLanguage: string,
): Promise<Record<string, string>> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured. Set it in the server environment.");

  const payload = items.map(i => `${i.key}: ${i.value}`).join("\n");
  const prompt = `You are a professional UI translator. Translate the following UI strings from English to ${targetLanguage}.

Rules:
- Return ONLY a valid JSON object where keys are the original keys and values are the translated strings.
- Keep all keys exactly as provided.
- Do not translate the keys, only the values.
- Preserve any {variable} placeholders exactly as-is.
- Keep translations concise — these are UI labels, buttons, and short messages.
- Return nothing else — only the JSON object.

Strings to translate:
${payload}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }
  const json: any = await res.json();
  const text = json?.content?.[0]?.text ?? "{}";
  // Extract JSON from response — model sometimes wraps it in markdown
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Anthropic returned no valid JSON");
  return JSON.parse(match[0]);
}

export async function autoTranslateLanguage(
  langCode: string,
  targetLanguageName: string,
  missingOnly = true,
): Promise<{ translated: number; skipped: number }> {
  const keys = missingOnly
    ? await getMissingTranslations(langCode)
    : await listTranslationKeys().then(all => all.map(k => ({ key: k.key, namespace: k.namespace, defaultValue: k.defaultValue })));

  if (keys.length === 0) return { translated: 0, skipped: 0 };

  const BATCH = 50;
  let translated = 0;
  let skipped = 0;

  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH);
    const items = batch.map(k => ({ key: k.key, value: k.defaultValue }));
    try {
      const result = await callAnthropicTranslate(items, targetLanguageName);
      for (const k of batch) {
        const value = result[k.key];
        if (value && typeof value === "string") {
          await upsertTranslation(langCode, k.key, value, true);
          translated++;
        } else {
          skipped++;
        }
      }
    } catch (e) {
      skipped += batch.length;
      console.error(`[Translation] Batch ${i}–${i + BATCH} failed:`, e);
    }
  }
  return { translated, skipped };
}

// ── Seeding ────────────────────────────────────────────────────────────────────

const SEED_KEYS: Array<{ key: string; namespace: string; defaultValue: string; description?: string }> = [
  // common
  { key: "common.loading",         namespace: "common", defaultValue: "Loading..." },
  { key: "common.save",            namespace: "common", defaultValue: "Save" },
  { key: "common.cancel",          namespace: "common", defaultValue: "Cancel" },
  { key: "common.confirm",         namespace: "common", defaultValue: "Confirm" },
  { key: "common.delete",          namespace: "common", defaultValue: "Delete" },
  { key: "common.edit",            namespace: "common", defaultValue: "Edit" },
  { key: "common.close",           namespace: "common", defaultValue: "Close" },
  { key: "common.back",            namespace: "common", defaultValue: "Back" },
  { key: "common.next",            namespace: "common", defaultValue: "Next" },
  { key: "common.submit",          namespace: "common", defaultValue: "Submit" },
  { key: "common.search",          namespace: "common", defaultValue: "Search" },
  { key: "common.filter",          namespace: "common", defaultValue: "Filter" },
  { key: "common.refresh",         namespace: "common", defaultValue: "Refresh" },
  { key: "common.copy",            namespace: "common", defaultValue: "Copy" },
  { key: "common.share",           namespace: "common", defaultValue: "Share" },
  { key: "common.download",        namespace: "common", defaultValue: "Download" },
  { key: "common.upload",          namespace: "common", defaultValue: "Upload" },
  { key: "common.view",            namespace: "common", defaultValue: "View" },
  { key: "common.add",             namespace: "common", defaultValue: "Add" },
  { key: "common.remove",          namespace: "common", defaultValue: "Remove" },
  { key: "common.enabled",         namespace: "common", defaultValue: "Enabled" },
  { key: "common.disabled",        namespace: "common", defaultValue: "Disabled" },
  { key: "common.active",          namespace: "common", defaultValue: "Active" },
  { key: "common.inactive",        namespace: "common", defaultValue: "Inactive" },
  { key: "common.yes",             namespace: "common", defaultValue: "Yes" },
  { key: "common.no",              namespace: "common", defaultValue: "No" },
  { key: "common.error",           namespace: "common", defaultValue: "Error" },
  { key: "common.success",         namespace: "common", defaultValue: "Success" },
  { key: "common.warning",         namespace: "common", defaultValue: "Warning" },
  { key: "common.copied",          namespace: "common", defaultValue: "Copied!" },
  { key: "common.empty_state",     namespace: "common", defaultValue: "Nothing here yet." },
  { key: "common.try_again",       namespace: "common", defaultValue: "Try again" },
  { key: "common.see_all",         namespace: "common", defaultValue: "See all" },
  { key: "common.optional",        namespace: "common", defaultValue: "Optional" },
  { key: "common.required",        namespace: "common", defaultValue: "Required" },
  // nav
  { key: "nav.tasks",              namespace: "nav", defaultValue: "Tasks" },
  { key: "nav.games",              namespace: "nav", defaultValue: "Games" },
  { key: "nav.referrals",          namespace: "nav", defaultValue: "Referrals" },
  { key: "nav.wallet",             namespace: "nav", defaultValue: "Wallet" },
  { key: "nav.settings",           namespace: "nav", defaultValue: "Settings" },
  { key: "nav.profile",            namespace: "nav", defaultValue: "Profile" },
  { key: "nav.vip",                namespace: "nav", defaultValue: "VIP" },
  { key: "nav.affiliate",          namespace: "nav", defaultValue: "Affiliate" },
  { key: "nav.ambassador",         namespace: "nav", defaultValue: "Ambassador" },
  // auth
  { key: "auth.login.title",       namespace: "auth", defaultValue: "Sign In" },
  { key: "auth.login.subtitle",    namespace: "auth", defaultValue: "Welcome back" },
  { key: "auth.login.email",       namespace: "auth", defaultValue: "Email address" },
  { key: "auth.login.password",    namespace: "auth", defaultValue: "Password" },
  { key: "auth.login.submit",      namespace: "auth", defaultValue: "Sign In" },
  { key: "auth.login.no_account",  namespace: "auth", defaultValue: "Don't have an account?" },
  { key: "auth.login.signup",      namespace: "auth", defaultValue: "Sign up" },
  { key: "auth.login.forgot",      namespace: "auth", defaultValue: "Forgot password?" },
  { key: "auth.register.title",    namespace: "auth", defaultValue: "Create an account" },
  { key: "auth.register.subtitle", namespace: "auth", defaultValue: "Join and start earning today" },
  { key: "auth.register.name",     namespace: "auth", defaultValue: "Full name" },
  { key: "auth.register.email",    namespace: "auth", defaultValue: "Email address" },
  { key: "auth.register.password", namespace: "auth", defaultValue: "Password" },
  { key: "auth.register.submit",   namespace: "auth", defaultValue: "Create Account" },
  { key: "auth.register.has_account", namespace: "auth", defaultValue: "Already have an account?" },
  { key: "auth.register.signin",   namespace: "auth", defaultValue: "Sign in" },
  // wallet
  { key: "wallet.title",           namespace: "wallet", defaultValue: "Wallet" },
  { key: "wallet.balance",         namespace: "wallet", defaultValue: "Balance" },
  { key: "wallet.deposit",         namespace: "wallet", defaultValue: "Deposit" },
  { key: "wallet.withdraw",        namespace: "wallet", defaultValue: "Withdraw" },
  { key: "wallet.history",         namespace: "wallet", defaultValue: "Transaction History" },
  { key: "wallet.no_transactions", namespace: "wallet", defaultValue: "No transactions yet." },
  { key: "wallet.game_wallet",     namespace: "wallet", defaultValue: "Game Wallet" },
  { key: "wallet.referral_wallet", namespace: "wallet", defaultValue: "Referral Wallet" },
  { key: "wallet.affiliate_wallet",namespace: "wallet", defaultValue: "Affiliate Wallet" },
  { key: "wallet.task_wallet",     namespace: "wallet", defaultValue: "Task Wallet" },
  // games
  { key: "game.place_bet",         namespace: "games", defaultValue: "Place Bet" },
  { key: "game.waiting",           namespace: "games", defaultValue: "Waiting..." },
  { key: "game.round",             namespace: "games", defaultValue: "Round" },
  { key: "game.result",            namespace: "games", defaultValue: "Result" },
  { key: "game.win",               namespace: "games", defaultValue: "Win" },
  { key: "game.lose",              namespace: "games", defaultValue: "Lose" },
  { key: "game.draw",              namespace: "games", defaultValue: "Draw" },
  { key: "game.bet_amount",        namespace: "games", defaultValue: "Bet Amount" },
  { key: "game.multiplier",        namespace: "games", defaultValue: "Multiplier" },
  { key: "game.potential_win",     namespace: "games", defaultValue: "Potential Win" },
  { key: "game.live_bets",         namespace: "games", defaultValue: "Live Bets" },
  // tasks
  { key: "tasks.title",            namespace: "tasks", defaultValue: "Task Marketplace" },
  { key: "tasks.browse",           namespace: "tasks", defaultValue: "Browse Tasks" },
  { key: "tasks.my_tasks",         namespace: "tasks", defaultValue: "My Tasks" },
  { key: "tasks.complete",         namespace: "tasks", defaultValue: "Complete Task" },
  { key: "tasks.reward",           namespace: "tasks", defaultValue: "Reward" },
  { key: "tasks.no_tasks",         namespace: "tasks", defaultValue: "No tasks available." },
  { key: "tasks.submit_proof",     namespace: "tasks", defaultValue: "Submit Proof" },
  { key: "tasks.status.pending",   namespace: "tasks", defaultValue: "Pending" },
  { key: "tasks.status.approved",  namespace: "tasks", defaultValue: "Approved" },
  { key: "tasks.status.rejected",  namespace: "tasks", defaultValue: "Rejected" },
  // referrals
  { key: "referrals.title",           namespace: "referrals", defaultValue: "Referral Program" },
  { key: "referrals.your_link",       namespace: "referrals", defaultValue: "Your Referral Link" },
  { key: "referrals.copy_link",       namespace: "referrals", defaultValue: "Copy Link" },
  { key: "referrals.share_link",      namespace: "referrals", defaultValue: "Share Link" },
  { key: "referrals.total",           namespace: "referrals", defaultValue: "Total Referrals" },
  { key: "referrals.active",          namespace: "referrals", defaultValue: "Active Referrals" },
  { key: "referrals.earned",          namespace: "referrals", defaultValue: "Total Earned" },
  { key: "referrals.no_referrals",    namespace: "referrals", defaultValue: "No referrals yet. Share your link!" },
  // vip
  { key: "vip.title",             namespace: "vip", defaultValue: "VIP Membership" },
  { key: "vip.subscribe",         namespace: "vip", defaultValue: "Subscribe" },
  { key: "vip.active",            namespace: "vip", defaultValue: "VIP Active" },
  { key: "vip.expires",           namespace: "vip", defaultValue: "Expires" },
  { key: "vip.benefits",          namespace: "vip", defaultValue: "VIP Benefits" },
  { key: "vip.streak",            namespace: "vip", defaultValue: "Daily Streak" },
  { key: "vip.claim_streak",      namespace: "vip", defaultValue: "Claim Streak Reward" },
  // settings
  { key: "settings.title",        namespace: "settings", defaultValue: "Settings" },
  { key: "settings.language",     namespace: "settings", defaultValue: "Language" },
  { key: "settings.currency",     namespace: "settings", defaultValue: "Currency" },
  { key: "settings.theme",        namespace: "settings", defaultValue: "Theme" },
  { key: "settings.theme.dark",   namespace: "settings", defaultValue: "Dark" },
  { key: "settings.theme.light",  namespace: "settings", defaultValue: "Light" },
  { key: "settings.notifications",namespace: "settings", defaultValue: "Notifications" },
  { key: "settings.security",     namespace: "settings", defaultValue: "Security" },
  { key: "settings.saved",        namespace: "settings", defaultValue: "Settings saved" },
  // profile
  { key: "profile.title",         namespace: "profile", defaultValue: "Profile" },
  { key: "profile.username",      namespace: "profile", defaultValue: "Username" },
  { key: "profile.full_name",     namespace: "profile", defaultValue: "Full Name" },
  { key: "profile.email",         namespace: "profile", defaultValue: "Email" },
  { key: "profile.phone",         namespace: "profile", defaultValue: "Phone" },
  { key: "profile.bio",           namespace: "profile", defaultValue: "Bio" },
  { key: "profile.save",          namespace: "profile", defaultValue: "Save Profile" },
  { key: "profile.kyc",           namespace: "profile", defaultValue: "Identity Verification" },
  // errors
  { key: "error.generic",         namespace: "errors", defaultValue: "Something went wrong. Please try again." },
  { key: "error.network",         namespace: "errors", defaultValue: "Network error. Check your connection." },
  { key: "error.unauthorized",    namespace: "errors", defaultValue: "You are not authorised to do this." },
  { key: "error.not_found",       namespace: "errors", defaultValue: "Not found." },
  { key: "error.validation",      namespace: "errors", defaultValue: "Please check your input." },
  { key: "error.server",          namespace: "errors", defaultValue: "Server error. Please try again later." },
  // notifications
  { key: "notifications.title",   namespace: "notifications", defaultValue: "Notifications" },
  { key: "notifications.empty",   namespace: "notifications", defaultValue: "No notifications." },
  { key: "notifications.mark_read", namespace: "notifications", defaultValue: "Mark all read" },
  // game lobby
  { key: "game.lobby.title",                namespace: "games",   defaultValue: "Game Center" },
  { key: "game.lobby.subtitle",             namespace: "games",   defaultValue: "Choose a game to start earning rewards" },
  { key: "game.feature_locked",             namespace: "games",   defaultValue: "Access Restricted" },
  { key: "game.feature_locked_hint",        namespace: "games",   defaultValue: "This feature is not available in your current plan." },
  { key: "game.provably_fair.title",        namespace: "games",   defaultValue: "Provably Fair Gaming" },
  { key: "game.provably_fair.description",  namespace: "games",   defaultValue: "All game outcomes are cryptographically verifiable. Independently verify any result." },
  { key: "game.provably_fair.verify",       namespace: "games",   defaultValue: "Verify a Round" },
  // landing — hero
  { key: "landing.hero.title",    namespace: "landing", defaultValue: "Play. Earn. Grow." },
  { key: "landing.hero.subtitle", namespace: "landing", defaultValue: "Compete in games, complete tasks, and build your referral network." },
  { key: "landing.cta.signup",    namespace: "landing", defaultValue: "Get Started Free" },
  { key: "landing.cta.login",     namespace: "landing", defaultValue: "Sign In" },
  // landing — extended (Phase 24.2 full t() coverage)
  { key: "landing.nav.features",         namespace: "landing", defaultValue: "Features" },
  { key: "landing.nav.games",            namespace: "landing", defaultValue: "Games" },
  { key: "landing.nav.how_it_works",     namespace: "landing", defaultValue: "How It Works" },
  { key: "landing.hero.badge",           namespace: "landing", defaultValue: "Next-Gen Fintech Gaming Platform" },
  { key: "landing.hero.title_1",         namespace: "landing", defaultValue: "Play, Earn & Compete" },
  { key: "landing.hero.title_2",         namespace: "landing", defaultValue: "in Real Time" },
  { key: "landing.hero.cta_primary",     namespace: "landing", defaultValue: "Start Earning Now" },
  { key: "landing.cta.final_title",      namespace: "landing", defaultValue: "Ready to Start Earning?" },
  { key: "landing.cta.final_sub",        namespace: "landing", defaultValue: "Join {name} and unlock unlimited earning potential through competitive gaming, task completion, and affiliate rewards." },
  { key: "landing.cta.create_account",   namespace: "landing", defaultValue: "Create Free Account" },
  { key: "landing.stats.games",          namespace: "landing", defaultValue: "Core Games" },
  { key: "landing.stats.vip_rewards",    namespace: "landing", defaultValue: "VIP Task Rewards" },
  { key: "landing.stats.currencies",     namespace: "landing", defaultValue: "Display Currencies" },
  { key: "landing.stats.support",        namespace: "landing", defaultValue: "Support" },
  { key: "landing.sections.features",    namespace: "landing", defaultValue: "Platform Features" },
  { key: "landing.sections.features_sub",namespace: "landing", defaultValue: "Everything you need to earn, compete, and grow" },
  { key: "landing.sections.games",       namespace: "landing", defaultValue: "5 Competitive Games" },
  { key: "landing.sections.games_sub",   namespace: "landing", defaultValue: "Skill-based PvP games with live rooms and instant payouts" },
  { key: "landing.sections.how_it_works",    namespace: "landing", defaultValue: "How It Works" },
  { key: "landing.sections.how_it_works_sub",namespace: "landing", defaultValue: "Start earning in minutes, not days" },
  { key: "landing.sections.security",    namespace: "landing", defaultValue: "Banking-Grade Security" },
  // landing — features
  { key: "landing.feature.wallet.title",    namespace: "landing", defaultValue: "Secure Multi-Wallet System" },
  { key: "landing.feature.wallet.desc",     namespace: "landing", defaultValue: "Four specialized wallets with real-time balance tracking" },
  { key: "landing.feature.games.title",     namespace: "landing", defaultValue: "5 Competitive Games" },
  { key: "landing.feature.games.desc",      namespace: "landing", defaultValue: "Color Prediction, Coin Flip, Dice Duel, Reaction Tap, and Spin Battle" },
  { key: "landing.feature.payments.title",  namespace: "landing", defaultValue: "Lightning Fast Payments" },
  { key: "landing.feature.payments.desc",   namespace: "landing", defaultValue: "Instant USDT BEP-20 withdrawals and direct bank transfers" },
  { key: "landing.feature.affiliate.title", namespace: "landing", defaultValue: "Affiliate Rewards System" },
  { key: "landing.feature.affiliate.desc",  namespace: "landing", defaultValue: "3-tier referral program with commission from platform fees" },
  { key: "landing.feature.vip.title",       namespace: "landing", defaultValue: "VIP Membership Benefits" },
  { key: "landing.feature.vip.desc",        namespace: "landing", defaultValue: "Up to 65% task rewards, priority support, and exclusive features" },
  { key: "landing.feature.kyc.title",       namespace: "landing", defaultValue: "KYC Verification" },
  { key: "landing.feature.kyc.desc",        namespace: "landing", defaultValue: "Advanced identity verification with face matching for secure compliance" },
  { key: "landing.feature.currencies.title",namespace: "landing", defaultValue: "10 Display Currencies" },
  { key: "landing.feature.currencies.desc", namespace: "landing", defaultValue: "View your USD balance in local currency for convenience" },
  { key: "landing.feature.notifs.title",    namespace: "landing", defaultValue: "Real-Time Notifications" },
  { key: "landing.feature.notifs.desc",     namespace: "landing", defaultValue: "Live alerts for games, wins, transactions, and affiliate earnings" },
  { key: "landing.feature.tasks.title",     namespace: "landing", defaultValue: "Task Marketplace" },
  { key: "landing.feature.tasks.desc",      namespace: "landing", defaultValue: "Complete tasks and earn: Free 35%, Verified 45%, VIP 65% rewards" },
  { key: "landing.feature.security.title",  namespace: "landing", defaultValue: "Blockchain Security" },
  { key: "landing.feature.security.desc",   namespace: "landing", defaultValue: "Bank-grade encryption with transparent on-chain verification" },
  // landing — steps
  { key: "landing.step1.title", namespace: "landing", defaultValue: "Create Account" },
  { key: "landing.step1.desc",  namespace: "landing", defaultValue: "Sign up in seconds with email or referral code" },
  { key: "landing.step2.title", namespace: "landing", defaultValue: "Verify Identity" },
  { key: "landing.step2.desc",  namespace: "landing", defaultValue: "Complete KYC verification for enhanced limits" },
  { key: "landing.step3.title", namespace: "landing", defaultValue: "Fund Wallet" },
  { key: "landing.step3.desc",  namespace: "landing", defaultValue: "Deposit via crypto (USDT BEP-20) or bank transfer" },
  { key: "landing.step4.title", namespace: "landing", defaultValue: "Join Games" },
  { key: "landing.step4.desc",  namespace: "landing", defaultValue: "Choose from 5 competitive PvP games" },
  { key: "landing.step5.title", namespace: "landing", defaultValue: "Earn Rewards" },
  { key: "landing.step5.desc",  namespace: "landing", defaultValue: "Win games, complete tasks, and earn affiliate commissions" },
  { key: "landing.step6.title", namespace: "landing", defaultValue: "Withdraw Funds" },
  { key: "landing.step6.desc",  namespace: "landing", defaultValue: "Cash out anytime with fast processing" },
  // landing — VIP benefits
  { key: "landing.vip.benefit1", namespace: "landing", defaultValue: "Up to 65% task completion rewards" },
  { key: "landing.vip.benefit2", namespace: "landing", defaultValue: "3-Tier Affiliate Rewards System" },
  { key: "landing.vip.benefit3", namespace: "landing", defaultValue: "Priority 24/7 customer support" },
  { key: "landing.vip.benefit4", namespace: "landing", defaultValue: "Exclusive game rooms and tournaments" },
  { key: "landing.vip.benefit5", namespace: "landing", defaultValue: "Higher withdrawal limits" },
  { key: "landing.vip.benefit6", namespace: "landing", defaultValue: "Early access to new features" },
  // landing — compliance
  { key: "landing.compliance.age.title",     namespace: "landing", defaultValue: "18+ Only" },
  { key: "landing.compliance.age.desc",      namespace: "landing", defaultValue: "Strict age verification required for all users" },
  { key: "landing.compliance.kyc.title",     namespace: "landing", defaultValue: "KYC Compliance" },
  { key: "landing.compliance.kyc.desc",      namespace: "landing", defaultValue: "Advanced identity verification with face matching" },
  { key: "landing.compliance.aml.title",     namespace: "landing", defaultValue: "AML Protection" },
  { key: "landing.compliance.aml.desc",      namespace: "landing", defaultValue: "Anti-money laundering monitoring and compliance" },
  { key: "landing.compliance.encrypt.title", namespace: "landing", defaultValue: "Secure Encryption" },
  { key: "landing.compliance.encrypt.desc",  namespace: "landing", defaultValue: "256-bit AES bank-grade wallet encryption" },
  { key: "landing.compliance.gaming.title",  namespace: "landing", defaultValue: "Responsible Gaming" },
  { key: "landing.compliance.gaming.desc",   namespace: "landing", defaultValue: "Fair play policies and player protection standards" },
  { key: "landing.compliance.txn.title",     namespace: "landing", defaultValue: "Protected Transactions" },
  { key: "landing.compliance.txn.desc",      namespace: "landing", defaultValue: "Blockchain-verified and immutably secured payments" },
  // affiliate
  { key: "affiliate.title",    namespace: "referrals", defaultValue: "Affiliate Program" },
  { key: "affiliate.subtitle", namespace: "referrals", defaultValue: "3-Tier MLM · VIP-Only Earnings" },
  // ambassador
  { key: "ambassador.title",    namespace: "common", defaultValue: "Ambassador Program" },
  { key: "ambassador.subtitle", namespace: "common", defaultValue: "Grow with BitZimi and earn more" },
  // profile (extended)
  { key: "profile.game_activity",   namespace: "profile", defaultValue: "Game Activity" },
  { key: "profile.account_actions", namespace: "profile", defaultValue: "Account Actions" },
];

export async function seedDefaultTranslationKeys(): Promise<void> {
  for (const item of SEED_KEYS) {
    await db.translationKey.upsert({
      where:  { key: item.key },
      create: { key: item.key, namespace: item.namespace, defaultValue: item.defaultValue, description: item.description ?? null },
      update: {},
    });
    // Ensure English translation exists
    await db.translation.upsert({
      where:  { languageCode_key: { languageCode: "en", key: item.key } },
      create: { languageCode: "en", key: item.key, value: item.defaultValue, isAutoTranslated: false, isApproved: true },
      update: {},
    });
  }
}
