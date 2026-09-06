# BitZimi — Completion Roadmap

**Updated:** 2026-09-06  
**Based on:** `audit report.md` full-platform re-audit and subsequent business-rule corrections  
**Purpose:** Master implementation sequence for making the entire BitZimi user platform and entire Admin Panel complete, secure, consistent, testable and production-ready.

---

# 1. Rules for every phase

1. Read the existing frontend, backend, Prisma schema/migrations and relevant Admin Panel code before changing anything.
2. Preserve established BitZimi business rules; do not redesign working architecture without a demonstrated reason.
3. Backend is authoritative for identity, verification, permissions, balances, game state, rewards, commissions and settlements.
4. Never use localStorage as authority for authentication, phone/KYC verification, balances, bets, settlements, rewards or game outcomes.
5. Do not add a second implementation when an existing authoritative implementation can be corrected.
6. Remove dead/duplicate code only after repository-wide dependency verification.
7. Financial, security, identity, KYC or privileged-admin mutations must be atomic where appropriate, idempotent and auditable.
8. Scheduled/background work must be durable and restart-safe where it affects business state.
9. Every changed backend API contract must be reconciled with frontend callers.
10. Every phase ends with **build/typecheck → unit/integration tests → E2E → concurrency/failure testing where applicable → verify → fix → verify again.**
11. A phase is not complete merely because TypeScript compiles.
12. Production sign-off requires live configuration verification for Supabase, Render, Vercel, storage, payment providers, SMS/email providers, Didit and other external dependencies.

---

# 2. Canonical Identity, Phone, KYC & VIP Rules

These rules override ambiguous or incorrect wording elsewhere in the roadmap.

### Phone verification
- Phone verification is an independent account/security feature.
- A user may verify their phone without completing KYC and without becoming VIP.
- Phone verification is required when entering protected flows that explicitly require it, including KYC and withdrawal.
- When a protected flow requires phone verification and the phone is not verified, the system automatically opens the existing phone-verification flow first.
- After successful verification, the original flow continues automatically.
- If the phone is already verified, the user proceeds without seeing the phone-verification step again.
- Phone verification is persistent account state, not a recurring requirement on every withdrawal/KYC attempt.
- The backend, not the client, determines whether the phone is verified.

### KYC
- KYC is a separate verification process.
- Starting KYC checks phone verification first; it does not grant VIP.
- If phone is not verified, the Verify Account flow automatically takes the user through phone verification before KYC can continue.
- If phone is already verified, KYC proceeds normally.
- The existing BitZimi KYC experience remains the user-facing foundation.
- Didit is integrated into that existing KYC flow as an additional authoritative identity-verification layer, rather than replacing the current BitZimi KYC experience.
- Final KYC verification requires the applicable BitZimi requirements **and** the required Didit verification result to pass.
- Didit requirements/API capabilities must be verified against the current supported Didit offering before implementation; do not invent unsupported requirements.
- Successful KYC status is `verified`.

### VIP
- KYC verification does not automatically make a user VIP.
- A user can be phone-verified and KYC-verified while remaining a non-VIP user.
- VIP requires KYC `verified` status as eligibility.
- The user must separately subscribe to VIP or receive an authorized administrative VIP grant.
- Phone verification is **not an independent VIP requirement**; it is already enforced as a prerequisite of KYC.
- Therefore the logical dependency is:
  **Phone Verified → KYC process (BitZimi + Didit) → KYC Verified → VIP eligibility → VIP subscription/grant → VIP user.**

### Withdrawal
- Withdrawal checks phone verification when the user clicks Withdraw.
- If already verified, continue directly to the normal withdrawal process.
- If not verified, automatically open phone verification, then continue to withdrawal after success.
- Do not repeatedly ask a user to verify a phone number that is already verified.

---

# Phase 1 — Identity, Authentication, Phone Verification & Profile Foundation

## Objective
Establish one trustworthy identity source and secure account authentication and phone verification.

## Implement/fix

### Authentication
- Registration.
- Email verification.
- Login.
- Password reset/change.
- Refresh-token rotation.
- Logout/revocation.
- Account suspension/deactivation.
- Lockout/failed-attempt controls.
- 2FA/TOTP login challenge.
- Security PIN lifecycle.
- Session/device state.

### Phone verification
- Remove simulated frontend OTP service.
- Remove client-generated OTP.
- Remove OTP from browser console/response.
- Add backend OTP challenge/state.
- Use cryptographically secure OTP generation.
- Hash OTP/challenge secret where appropriate.
- Expiry and attempt limits.
- Resend cooldown.
- Per-user/per-phone/per-IP rate limits.
- Phone normalization.
- Integrate the selected real SMS provider: **Contiguity managed OTP API**.
- Configure the BitZimi provider/account sender/name settings according to Contiguity's supported sender configuration; do not assume a carrier alphanumeric Sender ID until provider approval is confirmed.
- Verify OTP entirely on backend through Contiguity.
- Store only the provider challenge/OTP reference needed for verification, not the raw OTP.
- Store verified timestamp.
- Invalidate previous OTP challenges after successful verification.
- Prevent client from submitting `phoneVerified=true`.
- Controlled re-verification when changing a verified phone number.
- Audit privileged phone-verification changes.
- Make protected-flow interception reusable by KYC and withdrawal without duplicating verification logic.

### Identity/profile
- Make `/users/me` the authoritative identity source.
- Refactor IdentityContext to bootstrap from backend.
- Remove localStorage identity as authority.
- Synchronize username/full name/avatar/phone/KYC/VIP/role/permissions from backend.
- Remove duplicate profile business rules.
- Fix username cooldown bypass.
- Keep username uniqueness database-safe.
- Introduce a short public user ID where needed while preserving internal UUIDs.
- Stop exposing internal UUIDs where public identity is intended.
- Ensure suspended/deleted accounts are rejected by every business API.
- Verify issued sessions after suspension/deactivation.

## Admin
- Harden AdminRouteGuard and route-level permissions.
- Separate ordinary user editing from privileged role/security operations.
- Create explicit Super Admin-only role-management permission.
- Add mandatory audit for role changes.
- Restrict security actions such as disabling 2FA/clearing PIN to dedicated permissions.

## Completion gate
A user can register, verify email, log in, securely verify a phone, manage profile/security state, refresh/logout and be suspended/deactivated without any browser value forging authoritative identity or phone-verification state.

---

# Phase 2 — KYC / Identity Verification, Didit Integration & Sensitive Document System

## Objective
Complete the existing BitZimi KYC experience and connect it to Didit so final KYC verification is authoritative, durable and secure.

## User flow
- Verify phone automatically when entering KYC if not already verified.
- If already phone verified, skip that step and continue directly to KYC.
- Preserve the current BitZimi KYC user experience and fields where still valid.
- Use authoritative country/ID-type configuration.
- Collect the identity information required by the final BitZimi + Didit flow.
- Document uploads.
- Selfie/face verification as supported by Didit.
- Proof of address where required by the selected verification policy/provider.
- Submission/review state.
- Rejection and safe resubmission.
- Backend status polling/refresh.
- No local fallback submission.
- No sensitive image/form persistence in localStorage.

## Didit integration
- Verify current Didit API/product requirements before implementation.
- Integrate the current supported Didit verification flow into the existing BitZimi KYC process.
- Pass only required/allowed data to Didit.
- Receive and validate Didit verification results through a secure server-to-server flow/webhook where supported.
- Verify webhook authenticity/signatures according to Didit documentation.
- Persist Didit verification/session identifiers and decision evidence required for audit.
- Make Didit callbacks idempotent and replay-safe.
- Do not treat frontend Didit/client callbacks as authoritative.
- Do not invent a separate custom ID-number requirement merely because the existing UI contains one.
- If BitZimi currently collects an ID number, reconcile it with the authoritative Didit-supported identity data rather than maintaining an ad-hoc parallel verification authority.

## Final KYC decision
- Final KYC status becomes `verified` only when the required BitZimi checks and required Didit verification have passed.
- KYC verification never creates VIP membership automatically.
- Standardize all success-state contracts on `verified`.
- Remove `approved`/`verified` mismatch.
- Centralize allowed KYC status transitions.

## Storage/security
- Replace local filesystem as production KYC storage.
- Use private object storage.
- Bind uploads to the correct user/KYC submission.
- Short-lived signed access for authorized reviewers.
- MIME/content validation.
- Size limits.
- Malicious-file/content controls where applicable.
- Retention/deletion policy.
- Secure handling of superseded documents.
- Audit sensitive document access.

## Processing
- Replace process-local `setImmediate()` verification processing with durable jobs/outbox/queue processing.
- Idempotency.
- Retry/dead-letter behavior.
- Restart-safe processing.

## Admin KYC
- Queue.
- Detail.
- Secure document viewing.
- Approve/reject according to the final provider/manual-review workflow.
- Mandatory rejection reason.
- Atomic profile/name/address-lock synchronization.
- Super Admin-only manual override where permitted.
- Immutable review audit record.
- Reviewer identity/time/version.

## Completion gate
A user who has not verified a phone is automatically routed through phone verification before KYC; a user who has already verified the phone proceeds directly to KYC; valid BitZimi + Didit verification produces durable KYC `verified`; KYC rejection can be resubmitted; and no client/localStorage manipulation can create verified KYC.

---

# Phase 3 — VIP Eligibility, Subscription, Streaks & Grants

## Objective
Make the single VIP system obey the corrected KYC dependency without incorrectly making phone verification a direct VIP requirement.

## Implement/fix
- One unified VIP subscription.
- Require KYC `verified` status for normal VIP subscription eligibility.
- Do **not** add a separate phone-verification gate to VIP; verified KYC is the authoritative prerequisite.
- KYC verification does not activate VIP.
- User must separately subscribe to VIP.
- Require active/valid subscription state for VIP membership.
- Correct all status vocabulary.
- Prevent direct client VIP claims.
- VIP task-creation eligibility.
- VIP Football AI eligibility.
- Other configured VIP features.
- Subscription payment lifecycle.
- Renewal behavior.
- Cancellation behavior.
- Streak reward calculation/atomicity.
- Streak reset behavior.
- Duplicate claim protection.
- VIP price configuration.
- Exact monetary representation after financial migration.

## Admin
- VIP member list/detail.
- Authorized VIP grants.
- Custom durations: 1 week, 2 weeks, 1 month, 3 months, 1 year.
- Cancel VIP.
- Reset streak.
- Audit every grant/cancel/reset.
- Super Admin-only privileged actions where required.

## Completion gate
A phone-verified/KYC-verified user remains non-VIP until subscribing or receiving an authorized grant; VIP status is authoritative, durable and correctly expires/cancels.

---

# Phase 4 — Task Marketplace, Task Creator, My Task & Proof System

## Objective
Complete the entire task lifecycle using authoritative VIP eligibility.

## Implement/fix
- VIP-only task creation.
- Revalidate active VIP and KYC `verified` status on server.
- Do not add a redundant direct phone requirement when valid KYC is already authoritative.
- Task Wallet funding.
- Full budget moved into Task Vault before review.
- Pending review.
- Admin approval/rejection.
- Rejection returns remaining escrow.
- Active task keeps remaining escrow locked.
- Completion deducts exactly the configured reward.
- Free 35% / Verified 45% / VIP 65% reward tiers.
- Platform revenue calculation.
- Pause without refund.
- Resume without resetting budget.
- Stop/cancel and return remaining escrow.
- Edit after partial completion preserves spent/remaining amounts.
- Edited task automatically returns to pending review.
- Creator cannot manipulate protected workflow status.
- Task expiration.
- Completion ownership.
- Duplicate proof prevention.
- AI-first proof verification.
- Uncertain proof → admin manual review.
- Exactly-once reward settlement.
- Creator My Task/Task Manager.
- Marketplace filtering/listing/detail.

## Admin
- Task dashboard.
- Pending approval.
- Task detail.
- Marketplace monitoring.
- Proof review.
- Correct status permissions.
- Task analytics.

## Cleanup
- Remove obsolete task update paths.
- Remove duplicate proof authority.
- Remove local proof authority.
- Secure production storage for task reference/proof documents.

## Completion gate
Creator funding → review → publication → edit/re-review → pause/resume/stop and completer proof/reward all reconcile exactly under concurrent requests.

---

# Phase 5 — Complete Games Center & Provably Fair

## Objective
Make all seven user-facing game areas fully functional, authoritative, concurrency-safe and independently verifiable.

## Shared foundation
- Backend-authoritative game state.
- Persistent/restart-safe rounds.
- Matchmaking/private room correctness.
- Duplicate join prevention.
- Balance/stake validation.
- Lock thresholds.
- Max-player enforcement.
- Timeout/abandonment handling.
- Atomic settlement.
- Idempotent settlement.
- Fee configuration.
- No localStorage authority.
- No internal UUID public identity leakage.

## Colour Prediction
- Red/Blue multiplayer.
- Correct countdown/lock/spin/result/settlement.
- Correct fee/accounting model.
- Displayed round resets at midnight.
- Underlying/global round ID remains continuous.
- Backend/admin configuration.

## PvP Coin Flip
- 1v1 matchmaking.
- Private match.
- Stake selection.
- Configurable fee.
- Winner/payout.
- Timeout/cancellation.
- Provably Fair.

## Dice Duel category
### Dice Clash
- 1v1 matchmaking/private match.
- Stakes.
- Tie handling.
- Settlement.
- Provably Fair.

### Dice Royale
- Max 6.
- First player waits.
- Second player triggers 30-second countdown.
- Additional joins during countdown.
- Lock at 5 seconds.
- Highest dice number wins.
- Correct deterministic tie rule.
- No bots/fabricated players.
- Provably Fair.
- Correct frontend copy.

### Dice Arena
- Max 6.
- First/second waiting behavior.
- Third player triggers 30-second countdown.
- Lock at 5 seconds.
- Top two winners.
- 60/40 split.
- Tie handling.
- Provably Fair.

## Spin Battle
- Max 12.
- Second player triggers 30-second countdown.
- Lock at 5 seconds.
- Stake-proportional winner probability.
- Correct wheel segment weighting.
- Correct fee/settlement.
- Provably Fair verification of weighted result.
- Backend/admin lobby configuration.

## Reaction Tap
- 1v1.
- Matchmaking/private match.
- Skill/reaction rules.
- Anti-abuse.
- Settlement.
- No Provably Fair.

## Provably Fair
- Commit/reveal lifecycle.
- Verification ID persistence.
- All applicable games.
- Multiplayer player-list verification.
- Human-readable frontend verification.
- Independent verification of weighted Spin Battle selection.

## Admin
- Per-game configuration.
- Fees.
- Lobbies/stakes/rooms.
- Monitoring/moderation.
- Historical-result immutability.

## Completion gate
All seven game areas work under normal, concurrent, timeout, duplicate-request and restart scenarios; applicable games have complete usable fairness verification.

---

# Phase 6 — Football AI Prediction Platform

## Objective
Make Football AI fully automatic, correctly gated and schedule-safe.

## Implement/fix
- Provider ingestion.
- Provider failure/fallback.
- Current/upcoming fixtures.
- AI analysis.
- Automatic prediction generation.
- Daily configured prediction volume.
- Free exactly 2 games/day.
- Unified VIP gating based on active VIP status/KYC eligibility.
- VIP-only categories where configured.
- Tomorrow preparation.
- 00:00 publication boundary.
- Automatic next-day preparation.
- Timezone correctness.
- Prediction result updates.
- Stale-data prevention.
- Durable worker scheduling.
- Retry/idempotency.
- Automatic Football Hub points on entry.
- Duplicate point prevention.
- No manual prediction creation as the normal operating model.

## Admin
- Separate Football AI area.
- Provider health.
- AI status.
- Queue.
- Diagnostics.
- Monitoring.
- Prediction/result monitoring.
- Configuration.
- Learning/analysis visibility.
- Admin controls must not contradict automatic prediction generation.

## Completion gate
Simulated days including provider failures and midnight rollover preserve quotas, VIP access and automatic prediction publishing without manual prediction creation.

---

# Phase 7 — Auction Marketplace

## Implement/fix
- Admin create/edit/configure.
- Draft/scheduled/active/ended lifecycle.
- User marketplace visibility.
- Bid validation.
- Reserved funds.
- Outbid release.
- Bid concurrency.
- Live/SSE updates.
- Winner determination.
- Settlement.
- Claim.
- Cancellation/expiry.
- Wallet/ledger integration.
- Exactly-once settlement.
- Durable scheduler/recovery.

## Admin
- Create/manage.
- Monitor bids.
- Monitor winners/settlement.
- Statistics.
- Configuration.

## Completion gate
Admin creates auction → users bid concurrently → auction ends → one correct winner settles → claim and ledger reconcile.

---

# Phase 8 — Referral, Affiliate & Ambassador

## Implement/fix
- Referral code/link.
- Affiliate code/link.
- Ambassador identity/link.
- Registration attribution.
- Attribution persistence.
- Self-referral/circular prevention.
- Correct program lineage.
- Task commissions.
- Game commissions.
- First-VIP referral reward.
- Renewal exclusion where required.
- Exactly-once commission jobs.
- Retry/recovery.
- Referral/Affiliate/Ambassador wallet credits.
- Dashboards/statistics.
- Ambassador applications/approval/activity/pool distribution.

## Admin
- Referral management.
- Affiliate approvals/rejections.
- Ambassador management.
- Commission monitoring.
- Attribution investigation.

## Completion gate
Attribution remains correct from registration through qualifying activity and every reward/commission is created exactly once.

---

# Phase 9 — Wallet, Ledger, Deposits, Withdrawals & Complete Financial Gateway System

## Objective
Correct financial representation and complete every money-moving feature using the authoritative gateway architecture, while keeping USD as BitZimi's internal/base accounting currency and keeping display currency separate from transaction currency.

## Canonical currency architecture
- **USD is the internal/base accounting currency.**
- User Settings currency is **display-only** and must never be treated as the user's deposit/withdrawal rail.
- Display currency may include **NGN, KES, ZAR, GHS, USD and GBP**.
- Deposit/withdrawal currency is a separate backend-controlled transaction capability determined by configured gateway rails.
- Store transaction currency, gross amount, fee, net amount, FX rate/source and converted base-USD amount for every applicable financial transaction.
- Historical transactions must retain their original recorded FX rate and amounts; never recompute historical values from today's rate.
- Do not expose a currency in a transaction flow merely because it exists in Settings.

## Kora gateway integration
- Current payment gateway: **Kora**.
- Replace the current placeholder/manual deposit architecture with a real Kora collection flow where the selected rail is supported and enabled.
- Replace provider-less/manual withdrawal execution with Kora payout requests and asynchronous status handling.
- Keep provider credentials/secrets server-side only.
- Add Kora provider references and idempotency keys to transaction records.
- Verify Kora webhook authenticity/signatures according to the current Kora integration requirements.
- Process webhooks idempotently and make replay handling safe.
- Query Kora transaction status when required for reconciliation or uncertain webhook states.
- Never credit or finalize money solely from a client response.

## Deposit rollout
### NGN — ACTIVE
- Kora NGN virtual account/bank-transfer collection.
- Verify successful Kora transaction/webhook before crediting the user's wallet.

### KES — ACTIVE
- Kora KES virtual-account collection where enabled for the merchant/account.
- Handle asynchronous virtual-account creation and transaction webhooks/query lifecycle.

### GHS — ACTIVE WHEN THE KORA MERCHANT RAIL IS ENABLED
- Use the Kora-supported Ghana collection rail configured for BitZimi, including the documented pool-account/mobile-money capability where applicable.
- Treat Kora beta/merchant-activation requirements as configuration gates, not assumptions.

### ZAR — ACTIVE WHEN THE KORA MERCHANT RAIL IS ENABLED
- Use the Kora-supported South African collection rail configured for BitZimi, including the documented pool-account/EFT capability where applicable.
- Treat Kora beta/merchant-activation requirements as configuration gates, not assumptions.

### USD — INTEGRATED BUT ON HOLD
- Build the USD deposit architecture and Kora USD virtual-account integration points.
- **Do not activate USD deposits in production until Kora confirms/activates USD collection for the BitZimi merchant account.**
- The current Kora USD virtual-account capability is documented as beta, so it must remain feature-flagged/disabled until merchant availability is confirmed.
- Once confirmed, enable the USD deposit rail through configuration/feature flag without redesigning the financial architecture.

### GBP — NOT AVAILABLE FOR DEPOSIT YET
- Do not expose or activate GBP deposit through Kora while Kora does not provide a confirmed GBP deposit/collection rail for BitZimi.
- Keep the architecture extensible so GBP deposit can be added later when Kora officially supports/activates it.

## Withdrawal rollout
### NGN — ACTIVE
- Kora Nigerian bank payout.

### KES — ACTIVE
- Kora Kenyan bank payout.

### ZAR — ACTIVE
- Kora South African bank payout.

### GHS — ACTIVE WHERE THE SELECTED KORA PAYOUT RAIL IS ENABLED
- Kora Ghana payout support currently documented through mobile money.
- Do not assume Ghana bank payout if the enabled Kora merchant rail does not support it.

### USD — ACTIVE
- Kora USD bank payout.
- Capture all Kora-required international payout fields where applicable, including bank country, bank name, beneficiary details, account/IBAN, routing/payment method, bank address, purpose of payment and supporting documents where required.

### GBP — ACTIVE
- Kora GBP bank payout.
- Capture Kora-required GBP payout information such as bank country, bank details, IBAN/Sort Code and other required beneficiary/payment fields.
- **GBP withdrawal is active even though GBP deposit is not yet supported.**

## Withdrawal lifecycle
- When Withdraw is clicked, enforce the authoritative phone-verification gate.
- If phone is unverified, automatically open phone verification and continue to withdrawal after successful verification.
- If phone is already verified, continue directly without repeating verification.
- Validate supported withdrawal currency/rail server-side.
- Validate balance and limits atomically.
- Reserve/lock the required funds before submitting the payout.
- Create a unique idempotency key/provider reference.
- Submit the Kora payout request.
- Keep the withdrawal pending until Kora confirms the final state.
- On success, finalize the reserved funds and immutable ledger entries.
- On failure/rejection, release the reservation and record the failure reason.
- Handle pending/unknown states through webhook/query reconciliation rather than guessing.
- Prevent duplicate payouts from double clicks, retries, webhook replay or worker restart.

## Deposit lifecycle
- Create a transaction/reference before collection where required.
- Use the correct Kora rail for the selected transaction currency.
- Never credit user funds from frontend-only confirmation.
- Validate webhook authenticity.
- Match provider reference/customer/reference/narration to the correct BitZimi transaction.
- Credit only verified successful provider transactions.
- Make webhook processing exactly-once/idempotent.
- Handle pending, failed, reversed and disputed states.
- Reconcile gateway transactions against internal ledger and Kora merchant balances.

## Data model
- Replace Float monetary fields with exact financial representation.
- Migrate wallet balances safely.
- Remove legacy `main` wallet.
- Maintain Game/Task/Referral/Affiliate/Ambassador spendable balances.
- Separate Task Vault conceptually and operationally from spendable wallet.
- Add transaction currency, base-USD amount, FX rate, fee and provider metadata where required.
- Add provider transaction/reference IDs and unique idempotency constraints.
- Add required constraints/indexes.

## Financial lifecycle
- Atomic debit/credit.
- Transfer.
- Ledger entries.
- Deposits.
- Payment webhooks.
- Webhook idempotency.
- Withdrawals.
- Fees/net amounts.
- Minimum/maximum limits from backend/gateway configuration rather than hardcoded frontend NGN values.
- Daily/monthly limits where applicable.
- PIN security.
- Provider processing.
- Failure/reversal handling.
- Reconciliation.
- Transaction history.
- Game settlement.
- Task settlement.
- VIP payment.
- Auction settlement.
- Promotion/reward settlement.
- Referral/affiliate/ambassador settlement.

## Admin Financials
- Deposits dashboard.
- Withdrawals dashboard.
- Wallet explorer.
- Transaction explorer.
- Provider reference/status visibility.
- Currency and transaction-rail visibility.
- Gross/fee/net/base-USD amounts and recorded FX rate.
- Kora webhook/reconciliation status.
- Failed/pending/unknown transaction investigation.
- Deposit confirmation only where a legitimate manual-review state remains; manual confirmation must not bypass provider verification for gateway transactions.
- Withdrawal processing/reconciliation.
- Credit/debit adjustments.
- Freeze/unfreeze.
- Mandatory reason/audit for privileged adjustments.

## Completion gate
Wallet balances and ledger reconcile exactly across every domain under concurrent operations, with no binary floating-point accounting, no spendable Task Vault/main-wallet contamination, no duplicate gateway payout/credit, and no unsupported currency presented as an active transaction rail. USD remains the internal/base currency; USD deposit stays disabled until Kora merchant availability is confirmed; GBP withdrawal is active while GBP deposit remains unavailable.

---

# Phase 10 — Promotions, Monthly Events, Rewards & Notifications

## Implement/fix
- Promotion creation/editing/scheduling.
- Activation/expiry.
- Featured placement lifecycle.
- Promotion funding/revenue.
- Monthly Event/Challenge lifecycle.
- Referral/affiliate/ambassador linkage.
- Reward eligibility.
- Reward distribution.
- Exactly-once reward settlement.
- Durable schedulers/workers.
- Notification creation.
- Notification read/unread.
- Delete/retention.
- Broadcast.
- Templates.
- Translation integration.

## Admin
- Promotion management.
- Challenge management.
- Reward monitoring.
- Notification broadcast/management.
- Content linkage.

## Completion gate
Scheduled promotions/challenges run across restarts without duplicate activation or rewards, and critical notifications are durable/retryable.

---

# Phase 11 — Complete Admin Panel Functionalization & Least-Privilege Hardening

## Objective
Audit and finish every Admin Panel surface, not merely the navigation, with strict server-side privilege boundaries.

## Admin domains

### Dashboard/Analytics
- Correct metrics.
- Correct time windows.
- No client-side financial calculations.
- Cross-domain consistency.

### Users
- Search/filter/detail.
- Suspend/unsuspend.
- Account controls.
- Profile/security management.
- Ordinary user management.
- No privileged role changes by normal Admins.

### Role hierarchy — mandatory
- Super Admin is the highest privileged role.
- **Only Super Admin can add/promote another Admin.**
- **Only Super Admin can change privileged user roles.**
- Normal Admins may manage ordinary users but cannot promote a user to Admin or Super Admin.
- Normal Admins cannot demote, promote or otherwise modify privileged roles.
- Frontend role controls must reflect these permissions, but backend authorization is the final enforcement point.
- Role changes require dedicated permission checks and immutable audit records.
- Generic user-edit endpoints must not provide a route around Super Admin-only role management.

### KYC/Security
- KYC queue/detail/review.
- Secure document access.
- Verification override controls according to privilege.
- Phone/security controls.
- 2FA/PIN administration.
- Audit trail.

### Financials/Wallet
- Deposits.
- Withdrawals.
- Wallet explorer.
- Ledger/reconciliation.
- Kora provider status/reference visibility.
- Currency/rail configuration.
- Privileged adjustment controls.

### Tasks/Proofs
- Task review.
- Proof review.
- Creator/task monitoring.
- Reward/rejection controls.

### Games
- Per-game configuration.
- Lobbies.
- Stakes.
- Fees.
- Monitoring/moderation.
- Historical results.
- Provably Fair administration.

### Football AI
- Provider health.
- AI monitoring.
- Prediction monitoring.
- Configuration.
- No ordinary admin control that contradicts automatic prediction generation.

### Auctions
- Create/manage.
- Bids.
- Settlement/claim monitoring.

### VIP
- Member management.
- Grants.
- Cancellations.
- Streak administration.
- Privileged actions.

### Referral/Affiliate/Ambassador
- Attribution.
- Approvals.
- Commission monitoring.
- Ambassador management.

### Promotions/Events/Rewards
- Full lifecycle management.
- Reward monitoring.
- Scheduling.

### Notifications/Content/Translation
- Broadcast.
- Templates.
- Content management.
- Platform-wide translation/localization management without code changes.

### Configuration/Features/Currency
- Global configuration.
- Feature flags.
- Currency configuration.
- Deposit/withdrawal rail configuration.
- Gateway availability/activation flags.
- Per-game settings.
- Controlled rollout.
- Separate display-currency catalog from transaction-currency/rail capabilities.
- USD deposit activation must remain disabled until Kora merchant confirmation.
- GBP deposit remains unavailable until Kora officially supports it.
- GBP withdrawal remains enabled as a supported payout rail.

### Audit/Security
- Immutable audit records.
- Authentication/security events.
- Privileged actions.
- Payment webhook/audit events.
- Suspicious activity monitoring.

### AI Developer Center
- Dashboard/health.
- Repository scanning.
- Issue detection.
- Severity/confidence.
- Auto-fix generation.
- Admin review/approval.
- Verification.
- Rollback.
- CI/CD/monitoring integrations.

## Completion gate
Every Admin Panel route, action and mutation has a verified backend authorization path, every required domain is functional, privileged operations are separated from ordinary user management, and only Super Admin can change privileged roles.

---

# Phase 12 — Database, Security, Storage & Runtime Hardening

## Objective
Remove structural production risks that cut across all platform features.

## Database
- Reconcile Prisma schema and migrations with Supabase.
- Remove obsolete/duplicate models and fields only after dependency verification.
- Add constraints/indexes/unique rules.
- Enforce ownership and foreign keys.
- Exact monetary types.
- Durable idempotency records.
- Provider transaction/reference uniqueness.
- Audit records.
- Safe migration strategy.

## Security
- Remove sensitive localStorage authority.
- Review token storage/rotation strategy.
- Protect all privileged APIs server-side.
- Validate all ownership boundaries.
- Prevent IDOR/internal UUID exposure.
- Rate limits.
- CSRF/CORS/security headers as applicable.
- Input validation.
- File-upload security.
- Secrets/configuration hygiene.
- Kora/Didit/Contiguity webhook and callback authentication.
- Audit security-sensitive mutations.

## Runtime
- Replace process-local timers/state for durable business workflows.
- Durable workers/queues.
- Retry/dead-letter strategy.
- Graceful restart/recovery.
- Health checks.
- Observability.
- Error handling.
- Production-safe CORS/API configuration.
- Remove localhost/empty API fallbacks from production paths.
- Payment reconciliation worker and recovery path.

## Completion gate
The platform survives restart, duplicate requests, provider failures and unauthorized requests without losing or fabricating business state.

---

# Phase 13 — Integration, E2E & Cross-Domain Verification

## Objective
Verify the whole platform as one connected system rather than testing isolated modules only.

## Identity/KYC/VIP journeys
- New user registration.
- Email verification.
- Phone verification independently through Contiguity.
- Verify Account with unverified phone → phone verification → KYC → Didit → KYC verified.
- Verify Account with already verified phone → direct KYC.
- KYC verified user remains non-VIP until subscription/grant.
- VIP subscription after KYC.
- VIP expiry/cancellation.
- Withdrawal with unverified phone → phone verification → withdrawal.
- Withdrawal with already verified phone → direct withdrawal.

## Payment/currency journeys
- NGN deposit through Kora → verified webhook/query → USD base-ledger credit.
- KES deposit through Kora → verified webhook/query → USD base-ledger credit.
- GHS/ZAR deposit through the configured Kora collection rail when merchant-enabled.
- USD deposit architecture remains disabled while Kora USD collection is unconfirmed/beta-gated.
- GBP deposit is unavailable and cannot be selected.
- NGN/KES/ZAR withdrawals through Kora.
- GHS payout through the supported configured Kora rail.
- USD bank payout through Kora.
- GBP bank payout through Kora.
- Currency display setting changes do not change transaction rails.
- FX, fee, gross/net and base-USD amounts remain consistent and immutable per transaction.
- Duplicate Kora webhooks do not duplicate credits.
- Duplicate withdrawal requests do not duplicate payouts.
- Failed/pending/reversed provider states reconcile correctly.

## Core platform journeys
- Task creation/funding/review/completion/refund.
- All seven game flows.
- Provably Fair verification.
- Football AI daily rollover.
- Auction bidding/settlement/claim.
- Referral/affiliate/ambassador attribution and commissions.
- Wallet/ledger reconciliation.
- Promotions/events/rewards.
- Notifications/localization.

## Admin journeys
- Super Admin promotes ordinary user to Admin.
- Admin cannot promote user to Admin/Super Admin.
- Admin cannot change privileged roles through alternate endpoints.
- Super Admin can perform authorized privileged role changes.
- KYC review/override permissions.
- Financial adjustment permissions.
- Payment/currency configuration permissions.
- Game/configuration permissions.
- Audit records for all privileged actions.

## Failure/concurrency testing
- Duplicate submissions.
- Double clicks.
- Concurrent joins/bids/withdrawals.
- Provider timeout/failure.
- Webhook replay.
- Worker restart.
- Database retry.
- Midnight rollover.
- Session invalidation.
- Kora transaction query/reconciliation after uncertain webhook delivery.

## Completion gate
Cross-domain E2E tests prove that the intended identity → KYC → VIP relationships, withdrawal phone gate, payment gateway lifecycle, currency rules, financial settlement and Admin privilege hierarchy work together in production-like conditions.

---

# Phase 14 — Production Readiness, Cleanup & Final Sign-Off

## Objective
Close remaining gaps without introducing new architecture unnecessarily and certify the complete BitZimi platform.

## Final audit
- Re-run full main-platform audit.
- Re-run full Admin Panel audit.
- Compare implementation against this roadmap and `audit report.md`.
- Re-check all seven games.
- Re-check KYC + Didit integration.
- Re-check phone verification in independent and dependent flows.
- Re-check VIP subscription versus KYC eligibility.
- Re-check withdrawal phone gating.
- Re-check Super Admin/Admin role boundaries.
- Re-check every active Kora deposit and withdrawal rail against current provider capabilities and merchant activation.
- Re-check USD deposit feature flag remains disabled until confirmed.
- Re-check GBP withdrawal is active and GBP deposit remains unavailable.

## Cleanup
- Remove verified dead code.
- Remove duplicate services.
- Remove obsolete localStorage authorities.
- Remove development/mock providers from production paths.
- Remove localhost fallbacks.
- Reconcile documentation with actual implementation.

## Production verification
- Supabase.
- Render.
- Vercel.
- Storage.
- SMS provider/Contiguity.
- Email provider/Brevo.
- KYC provider/Didit.
- Payment provider/Kora.
- External game/football providers where applicable.
- Environment variables/secrets.
- Monitoring/alerts.
- Backups/recovery.

## Final acceptance criteria
- No critical or high-severity unresolved security/financial/identity defects.
- No client-controlled authoritative state.
- KYC cannot be verified without the required phone prerequisite and required BitZimi + Didit verification.
- KYC verification does not automatically grant VIP.
- VIP requires KYC verification and a separate subscription or authorized grant.
- Withdrawal automatically verifies phone only when needed and never repeatedly asks an already verified user.
- Only Super Admin can change privileged roles or promote users to Admin/Super Admin.
- All ordinary Admin operations remain available within their assigned permissions.
- All seven games and their required fairness rules work correctly.
- Wallet/ledger reconciles across every money-moving domain.
- Kora gateway integration is authoritative, idempotent, reconciled and feature-gated by actual merchant-supported rails.
- NGN/KES/ZAR/GHS transaction capabilities are enabled only where their configured Kora rails are active.
- USD remains the internal/base accounting currency.
- USD withdrawal is active; USD deposit remains disabled until Kora confirms/activates collection for BitZimi.
- GBP withdrawal is active; GBP deposit remains unavailable until Kora officially supports/activates it.
- Settings currency remains display-only and cannot silently enable an unsupported transaction rail.
- Admin Panel is fully functional and auditable.
- Automated tests, E2E tests and production smoke tests pass.

---

# Roadmap Status Rule

A phase is **Complete** only when its implementation, security checks, cross-layer integration, tests and verification gates pass. If a later audit discovers a business-rule mismatch or a gateway capability changes, update the roadmap and audit report first, then implement the corrected rule rather than building on an incorrect assumption.
