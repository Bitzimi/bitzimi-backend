# BitZimi — Master Completion Roadmap v2

**Updated:** 2026-09-05  
**Source:** `audit report.md` (full platform + full Admin Panel re-audit)

This roadmap supersedes the earlier roadmap conceptually and explicitly includes the previously under-audited phone verification, KYC/identity verification, sensitive document security, account security, admin privilege boundaries and complete Admin Panel verification.

## Mandatory implementation rules
1. Backend is authoritative for identity, phone/KYC verification, VIP eligibility, financial state, game state, permissions, rewards and commissions.
2. Never use localStorage as authority for KYC, phone verification, VIP status, balances, bets, settlements or rewards.
3. Protect sensitive operations server-side regardless of frontend visibility.
4. Use transactions, database constraints and idempotency for money, rewards, commissions, verification and settlement.
5. Preserve existing BitZimi business rules and architecture; do not redesign unnecessarily.
6. Remove dead/duplicate code only after dependency verification.
7. Every phase ends with build/typecheck → tests → failure review → fixes → repeat verification.
8. A phase is complete only after its real business flow is proven end-to-end.

## Phase 1 — Task Marketplace, Creator, My Task & Proof
- Enforce VIP + phone + KYC eligibility server-side.
- Full Task Wallet funding and Task Vault escrow lifecycle.
- Correct approval/rejection, pause/resume/stop, completion and reward tiers (35/45/65%).
- Force edited tasks back to admin review; block creator status manipulation.
- Complete Marketplace/My Task ownership and proof lifecycle.
- AI-first proof verification, manual fallback and exactly-once reward settlement.
- Admin task/proof management and audit logging.

## Phase 2 — Games Center
- Backend-authoritative rounds, stakes, timers, locks, results and settlement.
- Remove localStorage game authority; harden concurrency, max players, timeouts and restart recovery.
- Complete Colour Prediction, Coin Flip, Dice Clash, Dice Royale, Dice Arena, Spin Battle and Reaction Tap.
- Correct Dice Royale highest-number rule.
- Correct Dice Arena top-two/60-40 rule.
- Correct Spin Battle stake-proportional probability and matching wheel display.
- Complete Provably Fair for all applicable games; Reaction Tap remains excluded.
- Complete game admin configuration/monitoring.

## Phase 3 — Football AI
- Provider sync, data freshness, AI analysis, generation and persistence.
- Free exactly 2 games/day; unified VIP gating.
- Prepare tomorrow without early exposure; automatic midnight publication and next-day preparation.
- Automatic Football Hub points with idempotency.
- Worker/retry/timezone reliability.
- Admin monitors/configures/diagnoses the automated pipeline; reconcile permissions that allow unintended manual prediction creation.

## Phase 4 — Auction Marketplace
- Admin create/edit/schedule/activate/pause/end.
- User inventory/listing, bidding, concurrency, SSE/live updates.
- Winner, settlement, claim and failed/expired/cancelled flows.
- Wallet/ledger integration and public bidder identity.

## Phase 5 — Referral, Affiliate & Ambassador
- Code/link attribution and ambassador attribution.
- Registration/session persistence; self/circular protection.
- Task/game commissions, eligibility, idempotency and ledger records.
- Referral rewards and correct wallet destinations.
- Dashboards/downlines/statistics.
- Full admin investigation/configuration/monitoring.

## Phase 6 — Wallet, Ledger & Financial
- Reconcile one-wallet-per-user spendable model; remove legacy `main` safely.
- Separate Task Vault concept from spendable balances.
- Atomic debit/credit, concurrency, idempotency and reconciliation.
- Fiat/crypto deposits, provider webhooks and recovery.
- Withdrawals, limits, fees, PIN, KYC/phone checks, bank/USDT destinations and processing.
- Transfers and every domain's financial effects.
- Admin wallet adjustments require least privilege, reason, audit and idempotency.

## Phase 7 — Profile, Settings, Authentication & Identity
- `/users/me` sole identity authority.
- Remove local identity/profile source-of-truth behavior.
- Username/full-name/avatar/public ID synchronization.
- Registration, email verification, login, refresh rotation, logout, reset/change password, lockout, suspension/deactivation.
- TOTP/2FA and security PIN.
- Preferences, payment details and address security.
- Consolidate frontend API transport and remove production localhost/empty fallbacks.

## Phase 8 — Real Phone Verification
- Replace simulated frontend OTP entirely.
- Backend cryptographically secure OTP generation/storage/verification.
- Real SMS provider.
- Expiry, attempts, resend cooldown and per-user/phone/IP rate limits.
- No OTP returned to frontend, logged to console or stored as authoritative localStorage data.
- Verified timestamp and re-verification on phone changes.
- Remove client-controlled `phoneVerified` from profile update contract.
- KYC/VIP/withdrawal eligibility must use backend verification.

## Phase 9 — Real KYC / Identity Verification
- Server-side phone prerequisite.
- Persist all required identity fields including ID number.
- Validate country/ID type and document ownership.
- Private production storage and short-lived signed URLs.
- File security, retention, deletion and replacement lifecycle.
- Real identity provider integration for face/document/address verification; mock mode blocked in production.
- Auto-approve/manual-review/reject lifecycle and resubmission.
- Atomic KYC/profile/address-lock synchronization.
- Notifications and audit trail.
- Remove sensitive PII/images from browser localStorage and unsafe logs.
- Admin secure document review; explicit Super Admin-only KYC award/override; ordinary admins cannot bypass verification.

## Phase 10 — VIP & Verification-Gated Privileges
- One unified VIP subscription.
- Eligibility = active VIP + verified phone + verified KYC.
- Task, Football AI and all other VIP gates.
- Purchase/renew/expiry/streaks.
- Admin grants for 1 week, 2 weeks, 1 month, 3 months and 1 year.
- Cancel/reset/monitor/audit.
- No client-side VIP authority.

## Phase 11 — Promotions, Monthly Events, Notifications & Rewards
- Promotion lifecycle, scheduling, eligibility, funding and approval.
- Featured promotion flow.
- Monthly Challenge/Event lifecycle and leaderboards.
- Referral/affiliate/ambassador connections.
- Exactly-once rewards.
- Notification delivery/read/unread/delete/broadcast/retry.
- Full admin controls and audit.

## Phase 12 — Entire Admin Panel & Configuration
Verify every admin page, route, API and mutation, including:
- Dashboard/Analytics.
- Users/User Detail.
- KYC.
- Deposits/Withdrawals/Transactions/Wallets.
- Tasks/Approvals/Proofs.
- Games.
- Football AI.
- VIP.
- Referral/Affiliate/Ambassador.
- Challenges/Football Points.
- Promotions.
- Auctions.
- Notifications.
- Content/Pages/Platform Text.
- Security: events, login history, sessions, IP controls, fraud and compliance.
- Audit Log.
- Currency/Languages/Translations.
- Feature Management.
- Settings/configuration.
- AI Developer Center.

Admin requirements: backend permissions authoritative; desktop/mobile nav consistent; generic user editing cannot modify privileged state; financial/KYC/security actions least-privilege and audited; config pages must actually change their backend setting; analytics reconcile to source transactions; no mock/local data in production admin.

## Phase 13 — Content, Translation & Localization
- Inventory every user-facing string.
- Full main-platform/admin translation coverage.
- Backend-managed catalog.
- Remove business-critical hardcoded text bypassing localization.
- Synchronize languages/currencies.
- Correct timezone/date/money formatting.

## Phase 14 — Security, Database, Runtime & Production Infrastructure
- Supabase RLS verification for all relevant tables.
- DB constraints/index review and legacy cleanup.
- Rate limits for auth/OTP/password reset/KYC/financial/admin endpoints.
- Upload and PII/logging security.
- Session/replay protection and secure headers/CORS.
- Durable worker scheduling/locking/retries/idempotency.
- Remove process-local authoritative state.
- Game restart and Render multi-instance recovery.
- Verify Vercel + Render + Supabase + storage + SMS + email + payment + football providers and all production env variables.

## Phase 15 — AI Developer Center
- Real repository scans.
- Issue classification/evidence.
- Patch proposals and admin approval/rejection.
- Verification/rollback.
- CI/CD, scan history and monitoring.
- Never represent mock scan output as real.

## Phase 16 — Dead Code / Duplication / Legacy Cleanup
After dependency analysis remove:
- legacy `main` wallet;
- local identity/profile authority;
- simulated phone OTP;
- sensitive KYC localStorage progress;
- duplicate API/profile/proof/settlement logic;
- obsolete static game/lobby configuration;
- obsolete manual Football paths;
- dead admin/game services/routes/components;
- obsolete DB fields/models/indexes;
- stale flags and phase-number comments.

## Phase 17 — Automated Testing, E2E & Final Sign-Off
- Backend unit/integration/authorization/financial/concurrency/KYC/phone/game/worker tests.
- Frontend automated test framework and CI.
- E2E: registration → email → login/2FA → phone → KYC → profile → VIP → tasks → all games/fairness → Football AI → auction → referral/affiliate/ambassador → deposits/withdrawals → promotions/events/notifications → full admin.
- Adversarial tests: tampered payloads, expired tokens/OTPs, duplicate requests, races, cross-user IDs/document keys, replay, suspension/deactivation and restarts.
- Final gate: no unresolved P0; no unresolved P1 without accepted risk; canonical rules verified; ledger reconciled; security and production integrations verified; final audit updated.

## Final order
**1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17**