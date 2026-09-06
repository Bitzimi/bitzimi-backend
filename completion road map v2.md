# BitZimi — Master Completion Roadmap v2

**Updated:** 2026-09-06  
**Source of truth:** `audit report.md` (2026-09-05 full platform + full Admin Panel re-audit), plus subsequently confirmed BitZimi business/payment requirements.

This roadmap remains the master completion roadmap. It preserves the audited roadmap structure and incorporates the confirmed phone-verification, KYC/Didit, withdrawal-gate, Kora payment and currency requirements. It does not treat unsupported provider capabilities as available features.

## Mandatory implementation rules
1. Backend is authoritative for identity, phone/KYC verification, VIP eligibility, financial state, game state, permissions, rewards and commissions.
2. Never use localStorage as authority for KYC, phone verification, VIP status, balances, bets, settlements or rewards.
3. Protect sensitive operations server-side regardless of frontend visibility.
4. Use transactions, database constraints and idempotency for money, rewards, commissions, verification and settlement.
5. Preserve existing BitZimi business rules and architecture; do not redesign unnecessarily.
6. Remove dead/duplicate code only after dependency verification.
7. Every phase ends with build/typecheck → tests → failure review → fixes → repeat verification.
8. A phase is complete only after its real business flow is proven end-to-end.
9. Provider capabilities and merchant activation must be verified before a transaction rail is exposed as active.
10. Settings currency is display-only; it must never silently select or change a deposit/withdrawal rail.

## Canonical identity, phone, KYC and VIP rules

### Phone verification
- Phone verification is an independent account/security feature.
- A user may verify their phone without completing KYC and without becoming VIP.
- KYC requires phone verification.
- Withdrawal requires phone verification.
- When a protected flow requires phone verification and the phone is not verified, automatically open the existing phone-verification flow first; after success, continue the original flow.
- If already verified, skip the phone step and continue directly.
- Phone verification is persistent account state, not a recurring requirement on every withdrawal.
- The backend, not the client, determines phone verification state.

### KYC / Didit
- KYC is separate from VIP.
- Preserve the current BitZimi KYC user experience as the foundation.
- Integrate Didit as the authoritative external identity-verification layer.
- Verify current Didit requirements/capabilities before implementation; do not invent unsupported requirements.
- KYC cannot become `verified` until the required BitZimi checks and required Didit verification succeed.
- Successful KYC state is `verified`; remove `approved`/`verified` contract mismatches.
- KYC verification does not automatically make the user VIP.

### VIP
- VIP requires KYC `verified` status.
- The user must separately subscribe to VIP or receive an authorized administrative grant.
- Phone verification is not a separate direct VIP requirement; it is already a prerequisite of KYC.
- Logical dependency: **Phone Verified → KYC (BitZimi + Didit) → KYC Verified → VIP eligibility → VIP subscription/grant → VIP user.**

### Withdrawal
- Clicking Withdraw checks authoritative phone verification.
- If unverified, open phone verification automatically, then continue to withdrawal after successful verification.
- If already verified, continue directly without repeating verification.

## Canonical payment and currency rules

### Internal/base accounting
- **USD is BitZimi's internal/base accounting currency.**
- The user's Settings currency is **display-only**.
- Display currency may include **NGN, KES, ZAR, GHS, USD and GBP**.
- Transaction currency is separate from display currency and is determined by the configured, gateway-supported transaction rail.
- Store transaction currency, gross amount, fee, net amount, FX rate/source and converted base-USD amount where applicable.
- Historical FX and transaction amounts are immutable; never recompute historical accounting from today's FX rate.

### Current payment gateway
- **Kora/Korapay** is the payment gateway for the confirmed fiat payment architecture.
- Provider secrets remain server-side.
- Gateway webhooks must be authenticated, replay-safe and idempotent.
- Provider transaction/reference IDs and idempotency keys must be persisted and uniquely protected.
- Client responses must never be the sole authority for crediting or finalizing funds.

### Confirmed transaction matrix
| Currency | Deposit | Withdrawal | Rule |
|---|---|---|---|
| NGN | Active | Active | Kora-supported rail; production activation/configuration required |
| KES | Active | Active | Kora-supported rail; merchant/rail availability must be configured |
| ZAR | Active | Active | Kora-supported rail; merchant/rail availability must be configured |
| GHS | Active when Kora merchant rail is enabled | Active where supported rail is enabled | Use the actually enabled Kora Ghana rail; do not assume bank payout if only mobile-money support is enabled |
| USD | **Integrated but ON HOLD** | Active | USD collection remains disabled until Kora confirms/activates merchant availability; withdrawal uses supported Kora bank payout |
| GBP | **Not supported for deposit currently** | Active | Do not expose GBP deposit until Kora officially supports/activates it; GBP bank withdrawal remains supported |

### Deposit lifecycle
- Create the BitZimi transaction/reference before collection where required.
- Use the correct Kora rail for the selected transaction currency.
- Verify webhook authenticity and reconcile provider reference to the correct BitZimi transaction.
- Credit only verified successful provider transactions.
- Handle pending, failed, reversed and disputed states.
- Duplicate webhooks must not duplicate wallet credits.
- Reconcile gateway transactions against the internal ledger and Kora merchant balance.

### Withdrawal lifecycle
- Verify phone gate before withdrawal.
- Validate supported currency/rail, limits and balance server-side.
- Reserve/lock funds atomically before submitting payout.
- Submit Kora payout with a unique idempotency key/reference.
- Keep withdrawal pending until Kora confirms final state.
- Success finalizes the reservation and immutable ledger entries.
- Failure releases the reservation and records the reason.
- Pending/unknown states require webhook/query reconciliation; never guess.
- Duplicate requests, retries, webhook replay and worker restart must not create duplicate payouts.

## Phase 1 — Task Marketplace, Creator, My Task & Proof
- Enforce VIP + KYC `verified` eligibility server-side; phone verification is inherently required because KYC requires it.
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
- Replace placeholder/manual deposit flow with real Kora collection lifecycle.
- Replace provider-less/manual withdrawal execution with real Kora payout lifecycle.
- Implement NGN, KES, ZAR and configured GHS deposit/withdrawal rails according to actual Kora merchant activation.
- Integrate USD deposit architecture but keep USD deposits **ON HOLD/disabled** until Kora confirms/activates merchant availability.
- Keep GBP deposits unavailable until Kora officially supports/activates a GBP collection rail.
- Keep USD withdrawals active and GBP withdrawals active through supported Kora bank payout rails.
- Add provider references, idempotency, webhook authentication/replay protection and reconciliation.
- Store exact transaction currency, gross/fee/net, FX rate/source and base-USD value where applicable.
- Fiat/crypto deposits, provider webhooks and recovery.
- Withdrawals, limits, fees, PIN, authoritative phone/KYC checks, bank/USDT destinations and processing.
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
- Integrate **Contiguity managed OTP API** as the selected SMS provider.
- Configure sender/name according to Contiguity-supported configuration; do not assume carrier alphanumeric Sender ID approval.
- Expiry, attempts, resend cooldown and per-user/phone/IP rate limits.
- No OTP returned to frontend, logged to console or stored as authoritative localStorage data.
- Verified timestamp and controlled re-verification on phone changes.
- Remove client-controlled `phoneVerified` from profile update contract.
- KYC and withdrawal must use backend verification state.

## Phase 9 — Real KYC / Identity Verification
- Server-side phone prerequisite.
- Integrate Didit into the existing BitZimi KYC experience.
- Persist required identity fields without creating unsupported/ad-hoc identity requirements.
- Validate country/ID type and document ownership.
- Private production storage and short-lived signed URLs.
- File security, retention, deletion and replacement lifecycle.
- Real Didit identity verification; mock mode blocked in production.
- Auto-approve/manual-review/reject lifecycle and resubmission.
- Atomic KYC/profile/address-lock synchronization.
- Notifications and audit trail.
- Remove sensitive PII/images from browser localStorage and unsafe logs.
- Admin secure document review; explicit Super Admin-only KYC override where permitted; ordinary admins cannot bypass verification.

## Phase 10 — VIP & Verification-Gated Privileges
- One unified VIP subscription.
- Eligibility = active VIP + verified KYC.
- Do not add a separate direct phone requirement to VIP; phone is a KYC prerequisite.
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

Admin requirements: backend permissions authoritative; desktop/mobile nav consistent; generic user editing cannot modify privileged state; financial/KYC/security actions least-privilege and audited; config pages must actually change their backend setting; analytics reconcile to source transactions; no mock/local data in production admin; transaction-rail configuration must be separate from display currency.

## Phase 13 — Content, Translation & Localization
- Inventory every user-facing string.
- Full main-platform/admin translation coverage.
- Backend-managed catalog.
- Remove business-critical hardcoded text bypassing localization.
- Synchronize languages/currencies.
- Keep display currency separate from transaction currency/rail.
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
- Verify Kora merchant activation separately for each enabled collection/payout rail.
- Keep unsupported or unconfirmed rails disabled rather than exposing them optimistically.

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
- stale flags and phase-number comments;
- duplicate payment/deposit/withdrawal implementations.

## Phase 17 — Automated Testing, E2E & Final Sign-Off
- Backend unit/integration/authorization/financial/concurrency/KYC/phone/game/worker tests.
- Frontend automated test framework and CI.
- E2E: registration → email → login/2FA → independent phone verification → KYC/Didit → profile → VIP → tasks → all games/fairness → Football AI → auction → referral/affiliate/ambassador → deposits/withdrawals → promotions/events/notifications → full admin.
- Payment E2E: NGN/KES/ZAR/GHS enabled rails, USD withdrawal, GBP withdrawal; USD deposit remains disabled until Kora confirmation; GBP deposit remains unavailable.
- Verify withdrawal phone gate for both unverified and already-verified users.
- Adversarial tests: tampered payloads, expired tokens/OTPs, duplicate requests, races, cross-user IDs/document keys, replay, suspension/deactivation and restarts.
- Final gate: no unresolved P0; no unresolved P1 without accepted risk; canonical rules verified; ledger reconciled; security and production integrations verified; final audit updated.

## Final order
**1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17**