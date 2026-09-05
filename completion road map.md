# BitZimi — Completion Roadmap

**Created:** 2026-09-05  
**Based on:** `audit report.md`  
**Purpose:** Master implementation order for correcting, completing, cleaning and verifying the entire BitZimi platform.

---

## 1. Purpose and rules for using this roadmap

This roadmap converts the findings in `audit report.md` into implementation phases. It is the master sequence to use for completing BitZimi.

The roadmap does **not** authorize a redesign of BitZimi's established business architecture. Each phase must:

1. Read the existing frontend, backend, database and relevant admin implementation before changing anything.
2. Preserve the canonical business rules already established for BitZimi.
3. Correct broken or incomplete behavior rather than replacing working systems unnecessarily.
4. Keep the backend authoritative for identity, financial state, game state, permissions, rewards, commissions and other business-critical state.
5. Remove dead, obsolete, duplicated or superseded code only after confirming that nothing still depends on it.
6. Keep API contracts synchronized between frontend and backend.
7. Verify every completed change with build/type checks and appropriate unit/integration/E2E testing.
8. Test both normal and edge/concurrency/failure paths where money, game outcomes, permissions or scheduled jobs are involved.
9. Do not mark a phase complete merely because code compiles. The business flow must be demonstrated end-to-end.
10. At the end of every phase: **verify → identify failures → fix → verify again**.

---

# Phase 1 — Task Marketplace, Task Creator, My Task & Proof System

### Objective
Make the complete Task ecosystem conform exactly to the canonical Task business rules and prove the complete financial/proof lifecycle.

### Fix / complete
- VIP-only Task creation enforcement.
- Confirm normal VIP eligibility is based on phone verification + KYC + active VIP status.
- Task Wallet funding flow.
- Full-budget locking into Task Vault before admin review.
- Pending-review → approved/rejected lifecycle.
- Rejection releases the correct remaining locked budget.
- Approved tasks remain funded in escrow while active.
- Completion deducts only the configured reward from the locked task budget.
- Free 35%, Verified 45%, VIP 65% reward tiers.
- Platform revenue calculation for each tier.
- Pause/resume behavior with no accidental refund.
- Stop/cancel behavior and release of remaining Task Vault balance.
- Task editing after partial completion without resetting spent/remaining budget.
- **Force edited tasks back through admin review before returning to Marketplace.**
- Prevent task creators from directly manipulating protected workflow status.
- My Task / Task Manager ownership and permissions.
- Task Marketplace availability and filtering.
- Task completion/proof submission.
- AI-first proof verification.
- Uncertain AI result → admin/manual proof review.
- Correct proof status transitions and reward settlement.
- Prevent duplicate proof/reward settlement.
- Confirm task creator can inspect task requirements/evidence appropriately.
- Audit all task-related API contracts between frontend/backend.
- Remove or isolate frontend proof logic that duplicates authoritative backend verification.
- Ensure frontend never treats local proof state as the source of truth.

### Admin included in this phase
- Task Management.
- Pending Task Approval.
- Task editing/review.
- Proof Review.
- Creator/task inspection.
- Task status controls and permission enforcement.
- Task analytics relevant to creators/admins.

### Cleanup
- Remove obsolete task status/update paths that bypass review.
- Remove dead task/proof helpers after dependency verification.
- Remove duplicated client-side business rules that are no longer required.

### Completion gate
A test creator must fund, submit, receive approval/rejection, edit, pause, resume, stop and settle tasks correctly; a completer must receive the correct reward tier; AI/manual proof paths must settle exactly once.

---

# Phase 2 — Complete Games Center (excluding Football AI and Auctions)

### Objective
Correct and fully verify Colour Prediction, Coin Flip, Dice Clash, Dice Royale, Dice Arena, Spin Battle and Reaction Tap, including matchmaking/private matches, lobbies, rounds, fees, settlement, game state and fairness.

## 2A. Shared Game Foundation

- Standardize game API contracts.
- Ensure backend is authoritative for rounds, joins, bets/stakes, timers, results and settlement.
- Remove inappropriate localStorage persistence of authoritative game state.
- Verify concurrent join protection.
- Verify duplicate-join prevention.
- Verify stake/balance validation.
- Verify configured game fees are applied to the correct economic base per game.
- Verify failed settlement rolls back safely.
- Verify users cannot participate after the lock threshold.
- Verify maximum-player limits.
- Verify abandoned/waiting rounds and timeout behavior.
- Verify restart/recovery behavior.
- Verify private match creation/join/access controls.
- Verify matchmaking behavior for 1v1 games.
- Ensure internal UUIDs are not unnecessarily exposed to normal users.

## 2B. Colour Prediction

- Correct the fee/accounting representation inconsistency.
- Verify Red/Blue participation and round lifecycle.
- Verify payout/losing-side economics against the established rules.
- Verify daily displayed round number resets at midnight while the underlying/global identity remains continuous.
- Verify round creation and settlement across midnight.
- Verify lobby configuration comes from backend configuration where applicable.
- Remove accidental UI elements introduced by previous design work.

## 2C. Coin Flip

- Verify matchmaking.
- Verify private match.
- Verify stake selection.
- Verify configurable game fee.
- Verify winner determination and payout.
- Verify double-spend/race protection.
- Verify cancellation/timeout behavior.
- Verify provably-fair lifecycle.

## 2D. Dice Clash

- Verify 1v1 matchmaking/private match.
- Verify stake selection and fee.
- Verify dice result and tie handling.
- Verify payout/settlement.
- Verify provably-fair lifecycle.

## 2E. Dice Royale

- Restore/fix reliable user join/play flow.
- Enforce maximum 6 players.
- First player waiting state.
- Second player starts 30-second countdown.
- Additional joins during countdown.
- Lock at 5 seconds.
- Highest dice number wins.
- Correct deterministic tie handling.
- Correct payout and fee.
- Correct round cleanup/recovery.
- Correct frontend description; remove the incorrect “highest unique roll” rule.
- Verify no bot/player fabrication.

## 2F. Dice Arena

- Verify/fix user join flow.
- First player waiting.
- Second player still waiting.
- Third player starts 30-second countdown.
- Maximum 6 players.
- Lock at 5 seconds.
- Top two dice results win.
- 60/40 settlement according to the established rule/configuration.
- Deterministic tie handling.
- Correct cleanup/recovery.

## 2G. Spin Battle

- **Correct the winner-selection algorithm so wheel probability is proportional to participant stake.**
- Preserve deterministic/provably-fair derivation while incorporating stake weights correctly.
- Verify $50/$30/$20 produces 50%/30%/20% winner probability weighting.
- First player waiting state.
- Second player starts 30-second countdown.
- Additional joins during countdown.
- Lock at 5 seconds.
- Maximum 12 players.
- Correct wheel display/segment weighting.
- Correct settlement and fee accounting.
- Correct lobby/room configuration.

## 2H. Reaction Tap

- Verify 1v1 matchmaking/private match.
- Verify skill/reaction timing rules.
- Verify settlement and fee.
- Confirm Provably Fair remains excluded.
- Verify anti-abuse/race conditions.

## 2I. Provably Fair for all applicable games

- Verification ID generation and persistence.
- Verify-before-bet commitment.
- Seed reveal after settlement.
- Complete verification for Colour Prediction.
- Complete verification for Spin Battle including stake-weighted selection.
- Complete verification for Coin Flip.
- Complete verification for Dice Clash.
- Complete verification for Dice Royale.
- Complete verification for Dice Arena.
- Ensure Verification ID is visible/copyable after applicable rounds.
- Ensure frontend can display meaningful verification results instead of generic JSON.
- Ensure verifier can independently validate multiplayer player lists/results.
- Keep Reaction Tap excluded.

## Admin included in this phase
- Game configuration.
- Per-game fees.
- Lobby/room/stake configuration.
- Colour Prediction management.
- Spin Battle management.
- Dice Royale management.
- Dice Arena management.
- Matchmaking/private-match monitoring where applicable.
- Provably Fair monitoring/configuration.

### Cleanup
- Remove obsolete game-local state that duplicates DB state.
- Remove obsolete game services/components after dependency mapping.
- Remove duplicate settlement helpers that are not used by authoritative services.

### Completion gate
Each of the seven games must complete its real user lifecycle under normal, concurrent and failure conditions, and every applicable Provably Fair game must produce a usable Verification ID and complete verification.

---

# Phase 3 — Football AI Prediction Platform

### Objective
Make Football AI fully automatic, correctly gated, correctly scheduled and production-verifiable without requiring manual admin prediction creation.

### Fix / complete
- Provider synchronization and provider fallback behavior.
- Current/upcoming football match ingestion.
- Feature extraction and AI analysis.
- Prediction generation.
- Confidence/reasoning/learning pipeline where already implemented.
- Daily prediction generation volume/configuration.
- Free users receive exactly 2 games/day.
- One unified VIP subscription gates all VIP-only prediction sections.
- Elite / Sure Game / Big Odd / 2.5 Goals / other configured categories.
- Tomorrow's predictions may be prepared in advance but remain inaccessible until 00:00.
- Midnight rollover.
- Automatic next-day preparation after rollover.
- Prediction persistence and publication.
- Prediction status/result updates.
- Prevent stale/invalid provider data from silently becoming predictions.
- Provider failure handling.
- Automatic scheduling/worker reliability.
- Hub entry automatically grants configured football points with no separate claim.
- Prevent duplicate points for repeated entry when the business rule does not permit it.
- Verify user access rules for Free/VIP sections.
- Verify prediction date/timezone behavior.

### Admin included in this phase
- Dedicated Football AI admin section.
- Provider health.
- AI job monitoring.
- Prediction monitoring.
- Prediction result monitoring.
- Diagnostics.
- Configuration.
- Points monitoring.
- Admin visibility into AI decisions/reasoning without requiring manual prediction creation.

### Cleanup
- Remove dead/manual prediction paths if they are obsolete under the automatic model, only after confirming no required admin override depends on them.
- Remove duplicated football API/provider adapters.

### Completion gate
The system must automatically prepare, publish and roll over predictions for multiple consecutive simulated days; Free/VIP access and points must behave exactly as specified.

---

# Phase 4 — Auction Marketplace

### Objective
Restore the complete Auction lifecycle from admin creation to user participation and settlement.

### Fix / complete
- Admin auction creation.
- Auction editing/configuration.
- Draft/scheduled/active/ended lifecycle.
- Auction listing visibility.
- User auction Marketplace inventory.
- Bid submission.
- Bid validation and balance reservation/charging according to existing auction rules.
- Bid concurrency/race protection.
- Live/SSE updates.
- Winner determination.
- Settlement.
- Claiming.
- Failed/expired/cancelled auction handling.
- Wallet/ledger integration.
- Transaction history integration.
- User identity display using public identity rather than internal UUIDs.

### Admin included in this phase
- Auction creation and management.
- Auction monitoring.
- Bid monitoring.
- Winner/settlement controls where already permitted by the architecture.
- Auction reporting.

### Cleanup
- Remove dead auction UI/services that are not connected to the authoritative auction API.
- Remove duplicate auction wallet access logic if superseded.

### Completion gate
Admin creates an auction → it becomes visible → users bid → live updates work → auction closes → winner settles → claim completes → all wallet/ledger records reconcile.

---

# Phase 5 — Referral, Affiliate & Ambassador

### Objective
Make attribution, downline relationships, commissions and ambassador functionality reliable from registration through task/game revenue events.

### Fix / complete
- Referral code generation and uniqueness.
- Referral link handling.
- Affiliate code/link handling.
- Ambassador username/link handling.
- Registration attribution persistence.
- Authentication/session preservation of attribution.
- Prevent self-referral and invalid/circular attribution.
- Referral relationship correctness.
- Affiliate relationship correctness.
- Ambassador relationship correctness.
- Task commission generation.
- Game commission generation.
- Commission calculation according to existing platform rules.
- Commission eligibility and exclusions.
- Duplicate commission prevention/idempotency.
- Commission ledger/transaction records.
- Pending → approved/settled commission lifecycle where applicable.
- Referral rewards.
- Affiliate dashboard data.
- Ambassador dashboard/data.
- Downline visibility and statistics.
- Correct wallet destination: Referral, Affiliate and Ambassador balances.
- Verify attribution remains correct after profile/auth changes.

### Admin included in this phase
- Referral management.
- Affiliate management.
- Ambassador management.
- Commission monitoring.
- Attribution investigation.
- Reward/commission configuration where already supported.

### Cleanup
- Remove duplicated referral/affiliate identity handling.
- Remove obsolete frontend-local referral state.
- Remove dead ambassador UI/services if any are no longer connected.

### Completion gate
A new user registers through referral/affiliate/ambassador links and later completes qualifying tasks/games; attribution and every applicable reward/commission must be correct exactly once.

---

# Phase 6 — Wallet, Ledger & Complete Financial System

### Objective
Correct the wallet data model and make every financial flow across BitZimi reliable and reconcilable.

### Fix / complete
- Establish the intended one-wallet-per-user model for spendable balances:
  - Game Wallet
  - Task Wallet
  - Referral Wallet
  - Affiliate Wallet
  - Ambassador Wallet
- Remove the obsolete `main` wallet concept safely after dependency/data analysis.
- Correct all backend references to `main`.
- Resolve the Task Vault model mismatch while preserving its role as locked task-budget escrow separate from spendable balances.
- Correct Total Balance calculation.
- Ensure Task Vault is excluded from spendable total.
- Preserve task escrow/accounting integrity.
- Wallet credits/debits.
- Atomic conditional debits.
- Concurrent transaction safety.
- Transaction idempotency.
- Ledger integrity.
- Ledger-to-wallet reconciliation.
- Deposit creation.
- Payment-provider confirmation/webhooks.
- Webhook idempotency.
- Deposit failure/rollback behavior.
- Withdrawal creation.
- Withdrawal PIN/security checks.
- Minimum/maximum withdrawal limits.
- Limit reset behavior.
- Withdrawal fees/net amount.
- Withdrawal processing/status lifecycle.
- Transfer between permitted wallet balances/users according to existing rules.
- Game wallet settlement.
- Task wallet settlement.
- Referral/Affiliate/Ambassador wallet settlement.
- Auction wallet integration.
- VIP payment integration.
- Promotion/reward financial effects.
- Admin wallet credit/debit/freeze operations and audit trail.
- Transaction history completeness.
- Financial reconciliation/reporting.

### Admin included in this phase
- Wallet management.
- Deposits.
- Withdrawals.
- Transactions.
- Financial limits.
- Wallet adjustment tools.
- Financial audit/reconciliation.
- Permission controls for sensitive financial operations.

### Frontend included
- Remove wallet localStorage as an authoritative balance source.
- Remove legacy local wallet/affiliate balance migration logic once verified unnecessary.
- Wallet screens must always reflect backend balances and transaction history.

### Cleanup
- Delete obsolete `main` wallet code/data paths after migration verification.
- Remove duplicate wallet calculation helpers.
- Remove dead financial compatibility code.

### Completion gate
All financial operations must reconcile exactly: wallet balances = ledger state, no double settlement, no negative balances outside explicitly permitted rules, and Task Vault never appears as spendable balance.

---

# Phase 7 — Profile, Settings, Authentication & Identity

### Objective
Create one reliable user identity flow across the entire platform while completing profile, settings and authentication behavior.

### Fix / complete
- Backend `/users/me` remains authoritative.
- Remove frontend localStorage identity/profile as a source of truth.
- Correct IdentityContext synchronization.
- Correct username/full-name/avatar synchronization.
- Correct profile loading after login/refresh.
- Correct profile updates across all pages.
- Correct avatar propagation.
- Correct username propagation throughout tasks, games, auctions, referrals and admin views.
- Introduce/complete a dedicated short public user ID while preserving internal UUID primary keys.
- Stop exposing internal UUIDs where public identity is intended.
- Registration.
- Email verification.
- Login.
- Refresh token rotation.
- Logout/revocation.
- Account suspension/deletion behavior.
- Lockout behavior.
- Password change/reset.
- TOTP/Google 2FA.
- Security PIN where applicable.
- Phone verification.
- KYC linkage.
- Language preference.
- Currency preference.
- Theme preference.
- USDT address.
- Banking details.
- Address/profile security.
- Profile verification locks.
- Referral/affiliate/ambassador attribution during registration.
- Ensure auth/profile changes do not break attribution.

### API layer included in this phase
- Consolidate/standardize frontend API transport behavior where practical.
- Remove production localhost fallbacks from production-capable API services.
- Ensure API base URL is explicitly configured for production.
- Standardize token injection.
- Standardize 401/403 handling.
- Standardize response/error parsing.
- Standardize API contracts without changing business rules.

### Admin included in this phase
- User list/detail.
- User profile inspection.
- User editing.
- Account state controls.
- Identity display.
- Permission visibility.

### Cleanup
- Remove `userProfileService` behavior that duplicates backend authority where no longer needed.
- Remove obsolete identity/localStorage keys.
- Remove duplicate profile validation/business rules from frontend.
- Remove dead authentication compatibility paths only after dependency verification.

### Completion gate
Register → verify email → login → refresh → edit profile/avatar/username → logout → login again → verify all platform pages display the same backend identity; referral/affiliate/ambassador attribution remains intact.

---

# Phase 8 — VIP, KYC & Security-Sensitive User Privileges

### Objective
Complete VIP/KYC business rules and make privileged administration safe and auditable.

### Fix / complete
- One unified VIP subscription.
- VIP purchase flow.
- VIP duration.
- VIP expiry.
- VIP access gating.
- VIP renewal/cancellation behavior.
- VIP streak behavior.
- VIP task reward tier.
- VIP task creation eligibility.
- VIP Football AI access.
- Phone verification prerequisite.
- KYC prerequisite.
- Ensure normal users cannot become VIP without required prerequisites.
- KYC submission.
- KYC review.
- KYC approve/reject lifecycle.
- Super Admin-only KYC award/override capability.
- Ordinary admins must not gain Super Admin KYC powers.
- Audit all sensitive VIP/KYC actions.

### Admin included in this phase
- VIP member management.
- **Custom VIP grants:** 1 week, 2 weeks, 1 month, 3 months, 1 year and supported custom durations.
- VIP cancellation/reset tools.
- KYC review.
- Super Admin KYC award/override.
- Role/permission enforcement.

### Cleanup
- Remove dead VIP administration paths.
- Remove duplicate eligibility checks that conflict with authoritative VIP/KYC state.
- Remove unused KYC/VIP UI controls that do not correspond to backend capabilities.

### Completion gate
Normal users, VIP users, support/admin users and Super Admins must each receive exactly the permissions defined by the canonical rules.

---

# Phase 9 — Promotions, Monthly Events, Notifications & Rewards

### Objective
Complete the remaining growth/reward systems and connect them reliably to identity, wallet and attribution systems.

## Promotions
- Promotion creation/configuration.
- Scheduling.
- Active/inactive behavior.
- Featured promotion behavior.
- User visibility.
- Eligibility rules.
- Reward/financial effects.
- Admin approval/management flow where present.
- Expiration and cleanup.

## Monthly Events / Challenges
- Event/challenge creation.
- Scheduling and monthly rollover.
- Authentication linkage.
- Referral linkage.
- Affiliate linkage.
- Ambassador linkage.
- Participation tracking.
- Leaderboards.
- Qualification rules.
- Reward calculation.
- Reward settlement.
- Duplicate reward prevention.
- Wallet/ledger integration.
- Admin management and reporting.

## Notifications
- Backend notification creation.
- User notification retrieval.
- Unread counts.
- Read/mark-read state.
- Admin broadcast.
- Relevant event-triggered notifications.
- Notification permissions/targeting.
- Delivery reliability.
- Duplicate notification prevention.

### Admin included
- Promotions.
- Monthly Challenge/Event management.
- Notifications/broadcasts.
- Reward monitoring.

### Cleanup
- Remove dead notification mocks/local arrays.
- Remove obsolete promotion/event UI paths.
- Remove duplicate reward helpers after authoritative flow is confirmed.

### Completion gate
Create a promotion/event/admin notification and prove that eligible users receive the correct UI state, reward and wallet/ledger effects exactly once.

---

# Phase 10 — Admin Panel, Platform Configuration, Translation & Content Management

### Objective
Make the admin panel a complete, coherent control center whose settings actually drive the user platform.

### Admin organization
Maintain and verify business grouping around:

- Overview / Analytics
- Users
- Task
- Games
- Referral / Affiliate / Ambassador
- Wallet / Financial
- VIP
- KYC / Security
- Football AI
- Auctions
- Promotions
- Monthly Events
- Notifications / Content
- Translation / Localization
- AI Developer Center
- Security / Audit
- Features / Configuration
- Reports / Analytics

### Fix / complete
- Verify every sidebar item opens the intended page.
- Verify every admin page calls the correct backend endpoint.
- Verify admin permissions against backend RBAC, not cached frontend identity.
- Ensure sensitive actions are hidden and rejected for unauthorized roles.
- Ensure Super Admin-only actions cannot be invoked by ordinary admins through direct API calls.
- Correct scattered configuration surfaces.
- Replace raw boolean editing with appropriate switches/toggles where applicable.
- Organize percentages, fees, limits, feature flags and rollout settings.
- Ensure backend configuration is actually reflected in user-facing behavior.
- Remove hardcoded frontend lobby/stake configuration where backend configuration is authoritative.
- Ensure admin-created configuration can appear without rebuilding the frontend where required.

## Translation / Localization
- Establish one authoritative content/translation catalog.
- Categorize content by platform section/page.
- Cover Landing, Auth, Tasks, Games, Wallet, Referral, VIP, Football AI, Auctions, Promotions, Events, Settings, Profile, Notifications and all other user-facing areas.
- Include buttons, labels, modals, popups, validation messages, errors, success messages and notifications.
- Ensure language selection actually changes all supported content.
- Ensure admin can manage translations/content without code changes.
- Remove/replace remaining hardcoded user-visible strings where dynamic translation is required.

### Content management
- Verify Static Pages.
- Platform Text.
- Branding where applicable.
- Content Library.
- Ensure content changes propagate correctly to frontend.

### Cleanup
- Remove duplicate translation/content administration paths where they represent the same catalog.
- Remove unused admin pages/components/routes.
- Remove dead configuration fields and stale feature flags after dependency verification.

### Completion gate
An admin must be able to configure a supported platform behavior/text, and the corresponding user-facing behavior must change correctly without modifying application source code where the requirement calls for admin-managed configuration.

---

# Phase 11 — Database, Security, Runtime Resilience & Production Infrastructure

### Objective
Close the platform-wide security, data integrity and operational-readiness findings that cross all business domains.

### Database
- Re-check current Supabase RLS state.
- Enable/verify appropriate row-level security according to the established backend-authoritative architecture.
- Verify policies do not expose or permit unauthorized user data modification.
- Audit foreign-key indexes.
- Validate/remove unused indexes based on actual query patterns.
- Review JSON-as-text structures for validation/integrity risks without unnecessary redesign.
- Verify unique constraints and idempotency constraints for financial/game/reward records.
- Verify cascade/restrict behavior.
- Verify migrations from legacy wallet structures.
- Verify backup/recovery readiness.

### Security
- Full RBAC audit.
- User/admin authorization audit.
- Financial endpoint authorization.
- Game manipulation/race-condition audit.
- KYC/VIP privilege audit.
- Internal-ID exposure audit.
- Token/session security audit.
- Rate-limit audit.
- Input validation audit.
- CORS/security-header audit.
- Sensitive data exposure audit.
- Audit-log completeness for privileged/financial operations.

### Runtime resilience
- Address process-local game state risks in Dice Royale, Dice Arena, Spin Battle and Colour Prediction.
- Verify restart recovery.
- Verify scheduled worker recovery.
- Verify background job idempotency.
- Verify multi-instance behavior or enforce the existing deployment assumptions safely.
- Address process-local authentication/security state where persistence is required.
- Verify graceful failure and recovery of workers.

### Render / Vercel / production configuration
- Revalidate current Render configuration.
- Revalidate current Vercel configuration.
- Ensure production API URL is explicit and correct.
- Ensure no production code relies on localhost defaults.
- Verify build/start commands.
- Verify environment variables.
- Verify database connection and migrations.
- Verify deployment health checks.
- Verify logs/error monitoring.

### Completion gate
Security controls, database policies, migrations, workers and production configuration must survive restart/deployment and must not allow unauthorized financial, identity, game or admin actions.

---

# Phase 12 — Dead Code Removal, Duplication Cleanup & Codebase Consolidation

### Objective
Clean the entire frontend/backend repository after functional corrections so obsolete implementation does not remain as a second source of truth or future failure point.

### Audit and remove only after dependency verification
- Dead files.
- Unused services.
- Unused components.
- Unused routes.
- Unused hooks.
- Obsolete wallet code.
- Obsolete main-wallet references.
- Obsolete localStorage identity/profile code.
- Obsolete localStorage game state.
- Duplicate API wrappers that are no longer required.
- Duplicate profile business logic.
- Duplicate proof-verification logic.
- Duplicate settlement logic.
- Obsolete manual Football AI prediction paths.
- Dead auction helpers.
- Dead translation/content paths.
- Stale feature flags/configuration.
- Unused database fields/models only when confirmed safe through schema/reference/migration analysis.
- Old compatibility/migration code whose migration window has ended.

### Code quality
- Remove unused imports/exports.
- Remove unreachable branches.
- Remove stale comments describing old business rules.
- Update incorrect game descriptions/documentation.
- Remove misleading “temporary” fallbacks.
- Ensure names reflect current business terminology.
- Ensure no dead code still appears in production bundles.

### Completion gate
A repository-wide dependency/reference scan must show no remaining obsolete authoritative paths and no unexplained dead production code.

---

# Phase 13 — Full Automated Testing, End-to-End Verification & Final Production Sign-Off

### Objective
Prove the entire platform after all corrections rather than assuming correctness from static code.

### Testing foundation
- Establish/complete frontend automated test infrastructure.
- Backend unit tests for critical business rules.
- Integration tests for database transactions/API contracts.
- E2E tests for user flows.
- Admin E2E tests.
- Financial reconciliation tests.
- Game concurrency tests.
- Scheduled-job tests.
- Permission/RBAC tests.

### Mandatory end-to-end suites

#### User lifecycle
- Registration.
- Referral/affiliate/ambassador attribution.
- Email verification.
- Login/logout/refresh.
- Profile update.
- Avatar/username synchronization.
- Settings.
- Phone verification.
- KYC.
- VIP.

#### Task lifecycle
- Create → fund → review → approve/reject → marketplace → proof → AI/manual review → reward → pause/resume/edit/stop.

#### Game lifecycle
- Colour Prediction.
- Coin Flip.
- Dice Clash.
- Dice Royale.
- Dice Arena.
- Spin Battle.
- Reaction Tap.
- Matchmaking/private matches.
- Lobby/round timers.
- Fees.
- Settlement.
- Recovery.
- Provably Fair verification.

#### Football AI
- Provider sync.
- AI generation.
- Daily publishing.
- Free/VIP gating.
- Midnight rollover.
- Points.

#### Auction
- Admin create → user listing → bid → close → winner → settlement → claim.

#### Referral/Affiliate/Ambassador
- Attribution → qualifying activity → commission/reward → wallet → ledger.

#### Wallet/Financial
- Deposit.
- Withdrawal.
- Transfer.
- Wallet settlement.
- Ledger.
- Reconciliation.
- Concurrent transactions.

#### Promotions/Events/Notifications
- Admin creation → user eligibility → reward/notification → settlement/read state.

#### Admin
- Role-based access.
- User management.
- Financial controls.
- Task controls.
- Game configuration.
- Football AI monitoring.
- Auction management.
- VIP grants.
- KYC Super Admin controls.
- Translation/content management.
- Security/audit logs.

### Final production checks
- Frontend build.
- Backend build.
- Prisma migrations.
- Environment validation.
- Vercel deployment.
- Render deployment.
- Supabase connectivity/security.
- Browser smoke test of every major route.
- Console/network error review.
- API error review.
- Financial reconciliation review.
- Security review.
- Performance review.
- Worker/restart recovery test.

### Final completion gate
BitZimi is not marked complete until all critical workflows are demonstrably working, business rules match the canonical specification, unauthorized actions are rejected, financial/game state is authoritative and recoverable, and no known P0/P1 audit finding remains unresolved.

---

# Cross-Phase Completion Tracking

| Phase | Domain | Primary outcome | Blocking status |
|---|---|---|---|
| 1 | Task | Complete task/escrow/proof lifecycle | P0/P1 |
| 2 | Games | Complete all seven games + Provably Fair | P0/P1 |
| 3 | Football AI | Automatic prediction pipeline | P1 |
| 4 | Auctions | Complete auction lifecycle | P1 |
| 5 | Referral/Affiliate/Ambassador | Complete attribution/commission lifecycle | P1 |
| 6 | Wallet/Financial | Correct wallet model + reconciliation | P0/P1 |
| 7 | Profile/Settings/Auth | Single authoritative identity + auth lifecycle | P0/P1 |
| 8 | VIP/KYC | Correct eligibility + privileged admin controls | P1 |
| 9 | Promotions/Events/Notifications | Complete growth/reward/content delivery flows | P1/P2 |
| 10 | Admin/Config/Localization | Admin control actually drives platform | P1/P2 |
| 11 | Security/DB/Infrastructure | Secure, resilient production foundation | P0/P1 |
| 12 | Cleanup | Remove dead/duplicate/legacy code | P1/P2 |
| 13 | Testing/Sign-off | Prove complete platform | Final gate |

---

# Audit Finding → Roadmap Coverage

The known audit findings are intentionally distributed across the phases instead of being left as a generic cleanup list:

- Split frontend identity → Phase 7.
- Localhost production fallbacks → Phase 7 + Phase 11.
- Task edit/review bypass → Phase 1.
- Spin Battle equal-index winner → Phase 2.
- Legacy `main` wallet → Phase 6 + Phase 12.
- Task Vault model mismatch → Phase 6.
- Colour Prediction fee/accounting inconsistency → Phase 2 + Phase 6.
- Supabase RLS → Phase 11.
- Multiple API wrappers → Phase 7 + Phase 12.
- Local game/financial state → Phase 2 + Phase 6 + Phase 7.
- Duplicate profile/proof logic → Phase 1 + Phase 7 + Phase 12.
- Static game lobby configuration → Phase 2 + Phase 10.
- Dice Royale incorrect frontend rule description → Phase 2.
- Incomplete multiplayer Provably Fair verification → Phase 2.
- Internal UUID exposure → Phase 2 + Phase 4 + Phase 7.
- Missing public user ID → Phase 7.
- VIP custom grants → Phase 8.
- Super Admin KYC override → Phase 8.
- Process-local game state → Phase 2 + Phase 11.
- Process-local security/background state → Phase 11.
- Missing frontend automated tests → Phase 13.
- Auction lifecycle → Phase 4.
- Football AI production pipeline → Phase 3.
- Translation coverage → Phase 10.
- Promotion lifecycle → Phase 9.
- Monthly Event/reward lifecycle → Phase 9.
- Notification lifecycle → Phase 9.
- Admin organization/functionality → Phase 10, with domain-specific controls handled in Phases 1–9.
- Database indexes/JSON/constraints → Phase 11.
- Dead code/legacy compatibility → Phase 12.
- Full production proof → Phase 13.

---

# Final implementation order

**Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 8 → Phase 9 → Phase 10 → Phase 11 → Phase 12 → Phase 13**

This order intentionally fixes the highest-impact business domains first, then cross-platform identity/privilege/configuration/security concerns, then performs repository cleanup and finally conducts full end-to-end verification.

**This document is the master BitZimi completion roadmap.**