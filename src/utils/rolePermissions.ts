/**
 * Role → Permission mapping — single source of truth for the backend.
 *
 * Imported by:
 *   - admin.middleware.ts (requirePermission hook)
 *   - users.service.ts    (getMe — embeds permissions in the JWT response)
 *
 * The frontend mirrors this in src/app/admin/permissions.ts for UI-only hints.
 * The backend is authoritative; the frontend copy is for progressive disclosure only.
 */

export type UserRole =
  | "super_admin"
  | "finance_admin"
  | "support_admin"
  | "moderator_admin"
  | "user";

export const ALL_PERMISSIONS = [
  "admin.dashboard.view",
  "admin.users.view",
  "admin.users.edit",
  "admin.users.suspend",
  "admin.users.override_limits",
  "admin.kyc.view",
  "admin.kyc.approve",
  "admin.kyc.reject",
  "admin.financial.view",
  "admin.financial.process_withdrawals",
  "admin.financial.confirm_deposits",
  "admin.financial.transactions.view",
  "admin.tasks.view",
  "admin.tasks.approve",
  "admin.tasks.reject",
  "admin.tasks.proofs.view",
  "admin.tasks.proofs.approve",
  "admin.tasks.proofs.reject",
  "admin.games.view",
  "admin.games.moderate",
  "admin.games.manage",
  "admin.vip.view",
  "admin.vip.manage",
  "admin.referrals.view",
  "admin.affiliates.approve",
  "admin.affiliates.reject",
  "admin.notifications.view",
  "admin.notifications.broadcast",
  "admin.notifications.manage",   // Phase 9 — delete/manage individual notifications
  "admin.content.view",           // Phase 9 — view content library
  "admin.content.edit",           // Phase 9 — create/edit/delete content posts
  "admin.pages.view",             // Phase 9 — view static platform pages
  "admin.pages.edit",             // Phase 9 — create/edit/delete static pages
  "admin.text.view",              // Phase 9 — view platform text entries
  "admin.text.edit",              // Phase 9 — edit platform text entries
  "admin.analytics.view",         // Phase 10 — view analytics dashboard and reports
  "admin.developer.view",         // Phase 14 — view real project scan results and issues
  "admin.developer.scan",         // Phase 14 — trigger real project scans
  "admin.developer.patch",        // Phase 14.3 — generate, approve, and reject patch proposals
  "admin.security.view",          // Phase 15 — view security events, sessions, login history, fraud alerts
  "admin.security.manage",        // Phase 15 — manage sessions, IP blocks, resolve fraud alerts
  "admin.settings.view",
  "admin.settings.edit",
  "admin.config.view",
  "admin.config.edit",
  "admin.audit.view",
  "admin.football.view",          // Phase 16 — view football leagues, matches, predictions
  "admin.football.manage",        // Phase 16 — create/edit/settle football predictions
  "admin.ai.view",                // Phase 17.1 — view AI engine status, config, analyses, queue
  "admin.ai.manage",              // Phase 17.1 — manage AI config, trigger analysis, manage queue
  // Phase 20 — Growth: Ambassador Program, Monthly Challenge, Football Daily Points
  "admin.ambassadors.view",       // Phase 20 — view ambassador applications and stats
  "admin.ambassadors.manage",     // Phase 20 — approve/reject ambassador applications
  "admin.referrals.manage",       // Phase 20 — manage referral programme settings
  "admin.challenges.view",        // Phase 20 — view monthly challenges and leaderboards
  "admin.challenges.manage",      // Phase 20 — create/activate/end challenges, VIP grants, distribution
  // Phase 21 — Featured Promotion & Platform Announcement System
  "admin.promotions.view",              // Phase 21 — view all promotions, featured requests, pricing
  "admin.promotions.manage",            // Phase 21 — create/edit/delete/activate platform promotions
  "admin.promotions.featured.approve",  // Phase 21 — approve/reject featured requests, manage pricing, link events
  "admin.promotions.revenue",           // Phase 21 — view featured revenue wallet (super_admin only)
  // Phase 22 — Auction Marketplace
  "admin.auction.view",                 // Phase 22 — view auctions, bids, collection
  "admin.auction.manage",              // Phase 22 — create/edit/delete/activate/launch/pause/end auctions
  "admin.auction.settings",            // Phase 22 — manage auction feature flags and configuration
  "admin.auction.statistics",          // Phase 22 — view auction revenue and statistics
  // Phase 28 — Admin Wallet Management
  "admin.wallets.view",                // Phase 28 — view wallet dashboard, explorer, ledger, diagnostics
  "admin.wallets.manage",              // Phase 28 — credit, debit, freeze, unfreeze wallets
] as const;

export type Permission = typeof ALL_PERMISSIONS[number];

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  super_admin: [...ALL_PERMISSIONS],

  finance_admin: [
    "admin.dashboard.view",
    "admin.users.view",
    "admin.users.override_limits",
    "admin.financial.view",
    "admin.financial.process_withdrawals",
    "admin.financial.confirm_deposits",
    "admin.financial.transactions.view",
    "admin.games.view",
    "admin.games.manage",
    "admin.vip.view",
    "admin.config.view",
    "admin.audit.view",
    "admin.content.view",
    "admin.text.view",
    "admin.analytics.view",
    "admin.wallets.view",
    "admin.wallets.manage",
  ],

  support_admin: [
    "admin.dashboard.view",
    "admin.wallets.view",
    "admin.users.view",
    "admin.users.edit",
    "admin.users.suspend",
    "admin.kyc.view",
    "admin.kyc.approve",
    "admin.kyc.reject",
    "admin.tasks.view",
    "admin.tasks.proofs.view",
    "admin.referrals.view",
    "admin.ambassadors.view",
    "admin.challenges.view",
    "admin.promotions.view",
    "admin.auction.view",
    "admin.notifications.view",
    "admin.notifications.manage",
    "admin.content.view",
    "admin.content.edit",
    "admin.pages.view",
    "admin.pages.edit",
    "admin.text.view",
    "admin.text.edit",
    "admin.analytics.view",
    "admin.developer.view",
    "admin.config.view",
    "admin.audit.view",
  ],

  moderator_admin: [
    "admin.dashboard.view",
    "admin.football.view",
    "admin.football.manage",
    "admin.ai.view",
    "admin.ai.manage",
    "admin.tasks.view",
    "admin.tasks.approve",
    "admin.tasks.reject",
    "admin.tasks.proofs.view",
    "admin.tasks.proofs.approve",
    "admin.tasks.proofs.reject",
    "admin.games.view",
    "admin.games.moderate",
    "admin.games.manage",
    "admin.referrals.view",
    "admin.notifications.view",
    "admin.promotions.view",
    "admin.auction.view",
    "admin.content.view",
    "admin.pages.view",
  ],

  user: [],
};

/** Check whether a role has a given permission. super_admin has wildcard ["*"]. */
export function roleHasPermission(role: UserRole, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  // super_admin wildcard is stored as ALL_PERMISSIONS, so direct includes() suffices.
  // We keep wildcard support for any token-level override.
  if ((perms as string[]).includes("*")) return true;
  return (perms as string[]).includes(permission);
}
