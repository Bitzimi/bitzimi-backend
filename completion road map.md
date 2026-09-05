# BitZimi — Completion Roadmap

**Updated:** 2026-09-05  
**Based on:** `audit report.md` full-platform re-audit  
**Purpose:** Master implementation sequence for making the entire BitZimi user platform and entire Admin Panel complete, secure, consistent, testable and production-ready.

---

# 1. Rules for every phase

1. Read the existing frontend, backend, Prisma schema/migrations and relevant Admin Panel code before changing anything.
2. Preserve established BitZimi business rules; do not redesign working architecture without a demonstrated reason.
3. Backend is authoritative for identity, verification, permissions, balances, game state, rewards, commissions and settlements.
4. Never use localStorage as authority for authentication, KYC/phone verification, balances, bets, settlements, rewards or game outcomes.
5. Do not add a second implementation when an existing authoritative implementation can be corrected.
6. Remove dead/duplicate code only after repository-wide dependency verification.
7. Any financial, security, identity, KYC or privileged-admin mutation must be atomic where appropriate, idempotent and auditable.
8. Scheduled/background work must be durable and restart-safe where it affects business state.
9. Every API contract changed in backend must be reconciled with frontend callers.
10. Every phase ends with: **build/typecheck → unit/integration tests → E2E → concurrency/failure testing where applicable → verify → fix → verify again.**
11. A phase is not complete merely because TypeScript compiles.
12. Production sign-off requires live configuration verification for Supabase, Render, Vercel, storage, payment providers, SMS/email providers and other external dependencies.

---

# Phase 1 — Identity, Authentication, Phone Verification & Profile Foundation

## Objective
Establish one trustworthy identity source and make account authentication/phone verification secure before dependent privileges are completed.

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

### Phone verification — new critical work
- Remove simulated frontend OTP service.
- Remove client-generated OTP.
- Remove OTP from browser console/response.
- Add backend OTP challenge model/state.
- Use cryptographically secure OTP generation.
- Hash OTP/challenge secret where appropriate.
- Add expiry.
- Add attempt limits.
- Add resend cooldown.
- Add per-user/per-phone/per-IP rate limits.
- Normalize phone numbers.
- Integrate the selected real SMS provider.
- Verify OTP entirely on backend.
- Store verified timestamp.
- Invalidate previous OTPs after successful verification.
- Prevent client from submitting `phoneVerified=true` directly.
- Require re-verification for controlled phone-number changes.
- Add audit events for privileged phone verification changes.

### Identity/profile
- Make `/users/me` the authoritative identity source.
- Refactor IdentityContext to bootstrap from backend.
- Remove localStorage identity as source of truth.
- Synchronize username/full name/avatar/phone/KYC/VIP/role/permissions from backend.
- Remove duplicate profile business rules.
- Fix username cooldown bypass in `updateMe()`.
- Keep username uniqueness database-safe.
- Introduce a short public user ID if required while preserving internal UUID primary keys.
- Stop exposing internal UUIDs where public identity is intended.
- Ensure suspended/deleted accounts are rejected by every business API.
- Verify all issued sessions after suspension/deactivation.

## Admin
- Harden AdminRouteGuard and frontend route-level permissions.
- Separate generic user editing from privileged role/security operations.
- Create explicit Super Admin-only role-management permission.
- Add mandatory audit for role changes.
- Restrict admin security actions such as disabling 2FA/clearing PIN to dedicated permissions.

## Completion gate
A new account can register, verify email, log in, complete real phone OTP verification, enable/disable 2FA/PIN, update profile, refresh/logout, and become suspended/deactivated without any local browser value being able to forge its authoritative identity.

---

# Phase 2 — KYC / Identity Verification & Sensitive Document System

## Objective
Make identity verification real, durable, secure and consistent with phone verification.

## User flow
- Backend-enforced phone verification prerequisite.
- Country/ID-type selection from authoritative backend catalog.
- Personal information validation.
- Capture/store required ID number.
- Document uploads.
- Selfie.
- Proof of address.
- Submission/review state.
- Resubmission after rejection.
- Status polling/refresh from backend.
- No local fallback submission.
- No sensitive image/form persistence in localStorage.

## Verification engine
- Remove fake frontend face/OCR verification authority.
- Keep frontend validation UX-only.
- Implement the selected real identity provider or explicitly operate a controlled manual-review production model until automated verification is available.
- If automated verification is used, implement real face/document/address checks.
- Define thresholds and evidence rules server-side.
- Never enable mock verification in production.
- Store verification decision/evidence version.

## Storage
- Replace local filesystem as production KYC storage.
- Implement private object storage.
- Implement upload ownership binding.
- Implement short-lived signed document access.
- Add MIME/content validation.
- Add size limits.
- Add malicious-file/content controls where applicable.
- Add retention/deletion policy.
- Safely delete/retain superseded documents according to policy.
- Audit sensitive document access.

## Processing
- Replace `setImmediate()` verification processing with durable job/outbox/queue processing.
- Add idempotency.
- Add retry/dead-letter behavior.
- Make verification restart-safe.

## Status consistency
- Standardize on one successful status, e.g. `verified`.
- Remove `approved`/`verified` contract mismatch.
- Centralize allowed status transitions.

## Admin KYC
- Queue.
- Detail.
- Secure document viewing.
- Approve/reject.
- Mandatory rejection reason.
- Atomic profile/name/address-lock synchronization.
- Controlled Super Admin override only.
- Immutable review audit record.
- Reviewer identity/time/version.

## Completion gate
A real user submits valid/invalid identity documents; backend stores them securely, verification/manual review produces a durable decision, profile/address state synchronizes atomically, rejected users can safely resubmit, and no client/localStorage manipulation can create verified KYC.

---

# Phase 3 — VIP Eligibility, Subscription, Streaks & Grants

## Objective
Make the single VIP system obey the corrected identity prerequisites and all administrative requirements.

## Implement/fix
- One unified VIP subscription.
- Require KYC `verified` status.
- Require phone verification.
- Require active/valid subscription state.
- Correct all status vocabulary.
- Prevent direct client VIP claims.
- VIP task creation eligibility.
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
- Award VIP manually.
- Custom durations: 1 week, 2 weeks, 1 month, 3 months, 1 year.
- Cancel VIP.
- Reset streak.
- Audit every grant/cancel/reset.
- Super Admin-only actions where required.

## Completion gate
A user cannot become normally VIP without phone + KYC; VIP purchase, renewal, streak and admin custom grants all produce correct authoritative state and audit records.

---

# Phase 4 — Task Marketplace, Task Creator, My Task & Proof System

## Objective
Complete the entire task lifecycle after the identity/VIP foundation is reliable.

## Implement/fix
- VIP-only task creation.
- Revalidate phone + KYC + active VIP on server.
- Task Wallet funding.
- Full budget moved into Task Vault before review.
- Pending review.
- Admin approval/rejection.
- Rejection refunds remaining escrow.
- Active task keeps remaining escrow locked.
- Completion deducts exactly the configured reward.
- Free 35% / Verified 45% / VIP 65% reward tiers.
- Platform revenue calculation.
- Pause without refund.
- Resume without resetting budget.
- Stop/cancel and refund remaining escrow.
- Edit after partial completion preserves spent/remaining amounts.
- Edited task automatically returns to pending review.
- Creator cannot manipulate protected workflow status.
- Task expiration.
- Task completion ownership.
- Duplicate proof prevention.
- AI-first proof verification.
- Manual admin review for uncertain proofs.
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
- Use secure production storage for task reference/proof documents.

## Completion gate
Creator funding → review → publication → edit/re-review → pause/resume/stop and completer proof/reward all reconcile exactly under concurrent requests.

---

# Phase 5 — Complete Games Center & Provably Fair

## Objective
Make every game fully functional, authoritative, concurrency-safe and independently verifiable.

## Shared foundation
- Backend authoritative game state.
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
- Daily displayed round resets at midnight.
- Global underlying round ID remains continuous.
- Backend/admin lobby configuration.

## Coin Flip
- 1v1 matchmaking.
- Private match.
- Stake selection.
- Configurable fee.
- Winner/payout.
- Timeout/cancellation.
- Provably Fair.

## Dice Clash
- 1v1 matchmaking/private match.
- Stakes.
- Tie handling.
- Settlement.
- Provably Fair.

## Dice Royale
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

## Dice Arena
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
- **Stake-proportional winner probability.**
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
All seven games work under normal, concurrent, timeout, duplicate-request and restart scenarios; applicable games have complete usable fairness verification.

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
- Unified VIP gating.
- VIP-only categories.
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
- Ensure admin controls do not contradict monitor-first automatic prediction requirements.

## Completion gate
Run several simulated days including provider failures and midnight rollover; quotas, VIP access and automatic prediction publishing remain correct without manual prediction creation.

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

# Phase 9 — Wallet, Ledger & Complete Financial System

## Objective
Correct financial representation and reconcile every money-moving feature.

## Data model
- Replace Float monetary fields with exact financial representation.
- Migrate wallet balances safely.
- Remove legacy `main` wallet.
- Maintain Game/Task/Referral/Affiliate/Ambassador spendable balances.
- Separate Task Vault conceptually and operationally from spendable wallet.
- Add required database constraints/indexes.

## Financial lifecycle
- Atomic debit/credit.
- Transfer.
- Ledger entries.
- Deposits.
- Payment webhooks.
- Webhook idempotency.
- Withdrawals.
- Fees/net amounts.
- Minimum/maximum limits.
- Daily/monthly reset.
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

## Admin
- Wallet dashboard/explorer.
- Credit/debit.
- Freeze/unfreeze.
- Deposit confirmation.
- Withdrawal processing.
- Transaction explorer.
- Reconciliation.
- Mandatory reason/audit for privileged adjustments.

## Completion gate
Wallet balances and ledger reconcile exactly across every domain under concurrent operations, with no binary floating-point accounting and no spendable Task Vault/main wallet contamination.

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
Audit and finish every Admin Panel surface, not merely the navigation.

## Admin domains

### Dashboard/Analytics
- Correct metrics.
- Correct time windows.
- No client-side financial calculations.
- Cross-domain consistency.

### Users
- Search/pagination.
- User detail.
- Profile edits.
- Suspension.
- Deactivation visibility.
- Verification visibility.
- VIP visibility.
- Security visibility.
- Financial visibility.
- Strict field masking.

### KYC
- Queue/detail.
- Approve/reject.
- Super Admin override.
- Document access.
- Audit.

### Financial
- Deposits.
- Withdrawals.
- Transactions.
- Wallets.
- Reconciliation.

### Tasks
- Pending.
- Marketplace.
- Detail.
- Proof review.
- Correct transition permissions.

### Games
- Per-game config.
- Lobbies/stakes.
- Monitoring.
- Moderation.
- Immutable historical results.

### VIP
- Members.
- Custom-duration grants.
- Cancel/reset.
- Audit.

### Referral/Affiliate/Ambassador
- Applications.
- Approvals.
- Attribution.
- Commissions.
- Pool/reward management.

### Football/AI
- Monitor automatic AI pipeline.
- Provider health.
- Queue.
- Predictions/results.
- Diagnostics.
- Avoid inappropriate manual prediction paths.

### Auctions
- Full lifecycle controls.

### Promotions/Challenges
- Full lifecycle/rewards.

### Notifications/Content/Pages/Text
- CRUD.
- Permissions.
- Audit.
- Translation linkage.

### Security/Audit/Compliance
- Login history.
- Sessions.
- Security events.
- Fraud alerts.
- IP controls.
- Compliance.
- Audit log.
- Complete event coverage.

### Configuration
- System settings.
- Features.
- Currency.
- Languages.
- Translations.
- Branding.
- Explicit precedence and permissions.

### AI Developer Center
- Scan.
- Issue lifecycle.
- Patch proposal.
- Approval.
- Verification.
- Rollback.
- Strict privileged permissions.

## Permission matrix
Create and test a route/action matrix for:
- super_admin;
- finance_admin;
- support_admin;
- moderator_admin;
- normal user.

Explicitly protect role changes, KYC overrides, wallet adjustments, security overrides, configuration changes and code-changing AI actions.

## Completion gate
Every Admin Panel route and mutation is reachable only by the correct role/permission, and every sensitive mutation is auditable.

---

# Phase 12 — Translation, Language, Currency, Branding & Platform Content

## Implement/fix
- Single authoritative language catalog.
- Single authoritative currency catalog.
- Translation-key coverage across the entire user platform and Admin Panel.
- Remove hardcoded strings that should be catalog-backed.
- Missing-key fallback.
- Runtime language propagation.
- Runtime currency propagation.
- Admin editing.
- Cache invalidation/refresh.
- Branding propagation.
- Static pages/content propagation.
- Consistent notification templates.

## Completion gate
Changing a supported language/currency in Admin or user settings propagates consistently without stale frontend constants or missing critical text.

---

# Phase 13 — Database, Supabase RLS, Security, Storage & Runtime Resilience

## Database
- Verify Supabase RLS on every exposed table.
- Add/fix indexes.
- Add foreign-key constraints where needed.
- Add uniqueness/check constraints.
- Verify migrations against production schema.
- Remove legacy schema only after data migration verification.

## Security
- Least privilege.
- Rate limits.
- CORS.
- Helmet.
- Token/session security.
- XSS/storage review.
- Sensitive-data masking.
- Document access controls.
- Admin authorization.
- Audit coverage.

## Runtime
Replace critical process-local mechanisms with durable primitives where necessary:
- KYC verification jobs;
- notifications;
- audit events;
- commissions;
- Football AI;
- auctions;
- promotions;
- game coordination/state;
- cleanup/retention jobs.

Test:
- Render restart;
- process crash;
- multi-instance execution;
- duplicate worker execution;
- network/provider failure;
- database transient failure;
- job retry.

## Production configuration
- Render environment variables.
- Vercel API configuration.
- Supabase production schema/RLS.
- Private storage.
- SMS provider.
- Email provider.
- Payment providers.
- Football providers.
- AI provider/configuration.

## Completion gate
The platform remains correct after restarts, retries, concurrent workers and provider/database failures, with live RLS/security/storage/configuration verified.

---

# Phase 14 — Dead Code Removal, Consolidation, Automated Testing & Final Sign-Off

## Cleanup
Only after all preceding phases are stable:

- remove simulated phone OTP;
- remove fake document verification;
- remove local KYC submission fallback;
- remove local KYC image/form persistence;
- remove duplicate identity/profile authority;
- remove duplicate API transports;
- remove local financial/game authority;
- remove legacy `main` wallet;
- remove duplicate KYC status mutation paths;
- remove stale static lobby configuration;
- remove obsolete/manual Football prediction paths where superseded;
- remove obsolete process-local callbacks after durable replacements exist;
- remove dead routes/services/components/hooks;
- remove obsolete feature flags/config only after dependency verification.

## Automated testing
Build complete backend/frontend test suites covering:

### Identity/security
- registration;
- email verification;
- login;
- refresh/logout;
- password reset/change;
- phone OTP;
- 2FA;
- PIN;
- suspension/deactivation;
- profile/public ID.

### KYC
- upload;
- ownership;
- verification/manual review;
- approval/rejection;
- resubmission;
- address locking;
- storage access;
- retention.

### Financial
- wallet;
- ledger;
- deposit;
- withdrawal;
- transfers;
- fees;
- limits;
- webhooks;
- reconciliation;
- concurrent money operations.

### Tasks
- creation;
- review;
- edit/re-review;
- pause/resume/stop;
- proof AI/manual;
- exact reward settlement.

### Games
All seven games, matchmaking/private rooms, lobbies, timers, locks, settlement, fairness, concurrency and restart recovery.

### Football AI
Multiple simulated days, quotas, VIP access, provider failure, rollover and points.

### Auctions
Create/bid/outbid/end/winner/settlement/claim/recovery.

### Growth/rewards
Referral/affiliate/ambassador/promotions/challenges/notifications and exactly-once rewards.

### Admin
Every admin route/action against every role, including explicit negative authorization tests.

## Final production sign-off
- Frontend production build.
- Backend production build/typecheck.
- Database migration verification.
- Supabase RLS verification.
- Render deployment verification.
- Vercel deployment verification.
- API contract verification.
- Security review.
- Performance/load smoke tests.
- Restart/multi-instance tests.
- Financial reconciliation.
- Game fairness verification.
- KYC/privacy review.
- Admin permission matrix sign-off.
- No open P0/P1 findings.
- All critical flows demonstrated end-to-end.

---

# 2. Final implementation order

**Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 8 → Phase 9 → Phase 10 → Phase 11 → Phase 12 → Phase 13 → Phase 14**

The most important change from the previous roadmap is that **Identity + Authentication + Phone Verification + KYC now form the foundation**. This prevents us from completing dependent VIP, task and other privileged features on top of an identity/verification system that can still be forged or is not production-real.

---

# 3. Audit finding coverage

| Audit area | Roadmap phase |
|---|---|
| Phone OTP/client authority | 1 |
| Authentication/session lifecycle | 1 |
| Profile/IdentityContext/public ID | 1 |
| KYC/identity verification | 2 |
| KYC storage/provider/jobs | 2, 13 |
| VIP eligibility/status/grants | 3 |
| Task lifecycle/proofs | 4 |
| Games/settlement | 5 |
| Provably Fair | 5 |
| Football AI | 6 |
| Auctions | 7 |
| Referral/Affiliate/Ambassador | 8 |
| Wallet/ledger/Float/main wallet | 9 |
| Promotions/challenges/notifications | 10 |
| Entire Admin Panel | 11 |
| Translation/language/currency/content | 12 |
| RLS/security/storage/runtime | 13 |
| Dead code/duplication | 14 |
| Automated/E2E testing | 14 |

---

# 4. Definition of 100% complete

BitZimi is considered complete only when:

- no P0/P1 audit findings remain;
- identity is backend-authoritative;
- phone verification is real and server-authoritative;
- KYC is real, durable and secure;
- VIP eligibility is correct;
- every task/game/football/auction/growth/financial workflow works end-to-end;
- all money uses exact accounting representation and reconciles;
- Admin Panel permissions are least-privilege and complete;
- all privileged actions are auditable;
- scheduled work survives restart/retry/multi-instance execution;
- frontend/backend contracts are consistent;
- no critical localStorage authority remains;
- no fake/simulated production verification remains;
- no obsolete main-wallet/duplicate authority remains;
- all critical flows have automated tests and E2E verification;
- Supabase RLS and production infrastructure are live-verified;
- production deployment has been tested, not merely built.
