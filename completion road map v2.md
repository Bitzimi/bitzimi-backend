# BitZimi — Master Completion Roadmap v2

**Updated:** 2026-09-06  
**Source of truth:** `audit report.md` — expanded full frontend/backend code audit dated 2026-09-06, plus confirmed BitZimi business/payment requirements.

This is the existing master roadmap. No second roadmap has been created.

## Mandatory implementation rules

1. Before starting ANY phase, first read these Mandatory rules, the Canonical rules, and the complete checklist for that phase.
2. When a phase starts, every item currently listed under it is in scope and must be audited before implementation.
3. If code/dependency/business-logic verification discovers a requirement genuinely necessary to make the current phase complete but not already listed, implement it and explicitly add it under that phase as **Additional requirement discovered during implementation**. Do not add arbitrary work.
4. Examples outside the roadmap, including “Admin approval API” or “Wiring of frontend with backend”, are not requirements unless actual audit proves they are necessary.
5. A phase cannot become `[✓]` until every original and genuinely necessary additional item is implemented, tested, verified and re-tested where necessary.
6. Backend is authoritative for identity, phone/KYC, VIP, financial state, game state, permissions, rewards and commissions.
7. Never use localStorage as authority for identity, phone/KYC, VIP, balances, bets, settlements, rewards or financial status.
8. Sensitive/privileged operations must be protected server-side.
9. Money, rewards, commissions, verification and settlement require transactions, constraints and idempotency.
10. Preserve existing BitZimi business rules and UX unless an audit finding requires correction.
11. Remove duplicate/dead code only after dependency verification.
12. Every phase ends: build/typecheck → tests → failure review → fixes → repeat verification.
13. Phase completion requires the real business flow to work end-to-end, not merely compile.
14. Provider capability and merchant activation must be verified before exposing a transaction rail.
15. Settings currency is display-only and must never select/change a payment rail.
16. After all original/additional items pass, immediately update this roadmap, mark the verified phase/items `[✓]`, and commit code + roadmap before moving on.

## Canonical identity, phone, KYC and VIP rules

### Phone
- Independent account/security feature.
- Can be verified without KYC/VIP.
- KYC requires verified phone.
- Withdrawal requires verified phone.
- Protected flow with unverified phone automatically opens the existing phone-verification UX and resumes the original flow after success.
- Already verified skips the phone step.
- Verification is persistent account state, not repeated every withdrawal.
- Backend determines verification state.

### KYC / Didit
- KYC is separate from VIP.
- Preserve current BitZimi KYC UX.
- Didit is the authoritative external identity-verification layer.
- Verify current Didit capabilities before implementation; never invent unsupported requirements.
- Successful KYC state is `verified`; eliminate `approved`/`verified` mismatch.
- KYC requires BitZimi checks + required Didit result.
- KYC does not automatically grant VIP.

### VIP
- Requires KYC `verified`.
- User separately subscribes or receives authorized admin grant.
- No separate direct VIP phone requirement; phone is already a KYC prerequisite.
- Dependency: **Phone Verified → KYC + Didit → KYC Verified → VIP eligibility → subscription/grant → VIP.**

### Current withdrawal UX — canonical baseline
- Wallet opens the unified `WithdrawalWizard`.
- Sequence: **method → phone gate → bank/wallet setup → PIN setup → amount/form → PIN confirmation → submission → success/status**.
- Fiat = existing bank-destination branch; crypto = existing USDT BEP-20/BSC branch.
- Preserve current PIN confirmation and backend one-time PIN-token security.
- Preserve destination, fee, amount and limit UX unless an audit finding requires correction.
- Local monitoring may display backend state but can never determine debit, success or completion.
- Completed status must come only from authoritative backend/provider state.

### Current deposit UX — canonical baseline
- Preserve the current fiat bank/account-details UX while replacing the manual/generated reference execution with real Kora collection.
- Preserve the current crypto USDT BEP-20/BSC unique exact-amount monitoring UX.
- Frontend polling/local monitoring can display state only; it cannot credit funds.

## Canonical payment/currency rules

- USD is internal/base accounting currency.
- Settings currency is display-only.
- Display currencies: NGN, KES, ZAR, GHS, USD, GBP.
- Transaction currency is determined by the configured supported transaction rail, not display currency.
- Store transaction currency, gross, fee, net, FX rate/source and base-USD value where applicable.
- Historical accounting is immutable.
- Kora/Korapay is the fiat gateway.
- Provider secrets remain server-side.
- Webhooks are authenticated, replay-safe and idempotent.
- Provider refs/idempotency keys are persisted and unique.

### Transaction matrix
| Currency | Deposit | Withdrawal |
|---|---|---|
| NGN | Active when Kora rail is activated | Active when Kora rail is activated |
| KES | Active when Kora rail is activated | Active when Kora rail is activated |
| ZAR | Active when Kora rail is activated | Active when Kora rail is activated |
| GHS | Active only on configured Kora rail | Active only on configured supported Kora rail |
| USD | ON HOLD until Kora confirms/activates collection | Active only on verified supported Kora payout rail |
| GBP | Not currently supported for deposit | Active only on verified supported Kora payout rail |

## Deposit lifecycle requirements

- Create BitZimi transaction/reference before collection where required.
- Use correct Kora rail/currency.
- Authenticate and reconcile provider webhooks.
- Credit only authoritative successful provider transactions.
- Handle pending/failed/reversed/disputed states.
- Duplicate webhook replay cannot duplicate credit.
- Reconcile gateway state to ledger and merchant balance.

## Withdrawal lifecycle requirements

- Authoritative phone gate.
- Server-side currency/rail/limit/balance validation.
- Atomic reservation/lock before payout.
- Unique provider idempotency/reference.
- Pending until final provider/on-chain state.
- Success finalizes reservation/ledger.
- Failure releases reservation and records reason.
- Unknown/pending requires webhook/query reconciliation.
- Retry/replay/restart cannot create duplicate payout.

---

# Phase 1 — Task Marketplace, Creator, My Task & Proof [ ]
- [ ] Enforce VIP + KYC `verified` eligibility server-side; phone is an inherent KYC prerequisite.
- [ ] Full Task Wallet funding and Task Vault escrow lifecycle.
- [ ] Correct approval/rejection, pause/resume/stop, completion and 35/45/65% reward tiers.
- [ ] Force edited tasks back to admin review; creator cannot manipulate protected status/review state.
- [ ] Complete Marketplace/My Task ownership and proof lifecycle.
- [ ] AI-first proof verification, manual fallback and exactly-once reward settlement.
- [ ] Secure proof/document ownership and storage.
- [ ] Admin task/proof management and audit logging.
- [ ] **Additional requirement discovered during full audit:** creator update paths must not accept a status mutation that can bypass the required review lifecycle.

# Phase 2 — Games Center [ ]
- [ ] Backend-authoritative rounds, stakes, timers, locks, results and settlement.
- [ ] Remove localStorage game authority; harden concurrency, max players, timeouts and restart recovery.
- [ ] Complete Colour Prediction, Coin Flip, Dice Clash, Dice Royale, Dice Arena, Spin Battle and Reaction Tap.
- [ ] Dice Royale highest-number rule.
- [ ] Dice Arena top-two/60-40 rule.
- [ ] Spin Battle stake-proportional probability and matching wheel display.
- [ ] Provably Fair for all applicable games; Reaction Tap excluded.
- [ ] Game admin configuration/monitoring is the actual runtime source where configured.
- [ ] Colour Prediction client lobby/game-state dependency must be reduced to non-authoritative UI state.
- [ ] Local Spin Battle settlement/idempotency helpers cannot determine financial settlement.
- [ ] JSON/text player-list and join state must be concurrency-safe and durable.

# Phase 3 — Football AI [ ]
- [ ] Provider sync, freshness, AI analysis, generation and persistence.
- [ ] Free exactly 2 games/day; unified VIP gating.
- [ ] Prepare tomorrow without early exposure; automatic midnight publication and next-day preparation.
- [ ] Automatic Football Hub points with idempotency.
- [ ] Worker/retry/timezone reliability.
- [ ] Admin monitors/configures/diagnoses the automated pipeline; reconcile manual prediction permissions.
- [ ] VIP access must be derived from authenticated backend identity; client/query `isVip` assertions cannot authorize access.
- [ ] Provider failure/stale fixture behavior must fail closed rather than create silently valid predictions.

# Phase 4 — Auction Marketplace [ ]
- [ ] Admin create/edit/schedule/activate/pause/end.
- [ ] Inventory/listing, bidding, concurrency and SSE/live updates.
- [ ] Winner, settlement, claim, failure, expiry and cancellation.
- [ ] Wallet/ledger integration and public bidder identity.
- [ ] Durable scheduler/lock across restart and multiple instances.
- [ ] Bid/outbid/reservation concurrency and exactly-once settlement.

# Phase 5 — Referral, Affiliate & Ambassador [ ]
- [ ] Code/link attribution and ambassador attribution.
- [ ] Registration/session persistence; self-referral and circular-lineage protection.
- [ ] Task/game commissions, eligibility, idempotency and ledger records.
- [ ] Referral rewards and correct wallet destinations.
- [ ] Dashboards/downlines/statistics.
- [ ] Ambassador application/approval/activity/pool distribution lifecycle.
- [ ] Full admin investigation/configuration/monitoring.
- [ ] Prevent duplicate first-VIP referral rewards on renewal/concurrency.

# Phase 6 — Wallet, Ledger & Financial [ ]
- [ ] One-wallet-per-user spendable model; safely remove legacy `main`.
- [ ] Task Vault separated conceptually from spendable balances.
- [ ] Exact monetary representation; remove Float accounting risk.
- [ ] Atomic debit/credit, concurrency, idempotency and reconciliation.
- [ ] Real Kora fiat collection replacing generated/manual BZ bank references.
- [ ] Real Kora payout replacing provider-less withdrawal execution while preserving the current WithdrawalWizard UX.
- [ ] NGN/KES/ZAR/configured GHS rails only after actual merchant/rail activation.
- [ ] USD deposit architecture ON HOLD/disabled until Kora confirmation/activation.
- [ ] GBP deposit unavailable until supported/activated.
- [ ] USD/GBP withdrawals only through verified supported Kora payout rails.
- [ ] Provider refs, idempotency, webhook authentication/replay protection and reconciliation.
- [ ] Exact transaction currency/gross/fee/net/FX/source/base-USD fields and immutable history.
- [ ] Preserve crypto deposit unique-amount UX; make matching, confirmations, crediting and checkpoint durable/idempotent.
- [ ] Preserve crypto withdrawal USDT BEP-20 UX; implement actual backend-controlled on-chain payout, durable status/reconciliation, duplicate protection and failure/retry recovery.
- [ ] Fiat deposit must no longer use generated BZ/manual confirmation as the normal production path.
- [ ] Fiat withdrawal must preserve bank destination/fee/limit/PIN UX while connecting to Kora.
- [ ] Frontend/local monitoring cannot finalize deposits or withdrawals.
- [ ] Transfers and every domain's financial effects are ledger-reconciled.
- [ ] Transfer request-level idempotency for client retries.
- [ ] Admin wallet adjustments require least privilege, reason, audit and idempotency.

# Phase 7 — Profile, Settings, Authentication & Identity [ ]
- [ ] `/users/me` is sole identity authority.
- [ ] Remove local identity/profile source-of-truth behavior.
- [ ] Username/full-name/avatar/public ID synchronization.
- [ ] Enforce username cooldown consistently across every update path.
- [ ] Registration, email verification, login, refresh rotation, logout, reset/change password, lockout, suspension/deactivation.
- [ ] TOTP/2FA and Security PIN.
- [ ] Preferences, payment details and address security.
- [ ] Consolidate frontend API transport and remove localhost/empty production fallbacks.
- [ ] Authenticated transport owns refresh/retry behavior.
- [ ] Payment-detail changes have controlled security/reverification, masking and audit semantics.

# Phase 8 — Real Phone Verification [ ]
- [ ] Replace simulated frontend OTP entirely.
- [ ] Backend cryptographically secure OTP generation/storage/verification.
- [ ] Integrate Contiguity managed OTP API.
- [ ] Sender/name follows actual provider-supported configuration; no assumed carrier approval.
- [ ] Expiry, attempts, resend cooldown and per-user/phone/IP rate limits.
- [ ] No OTP returned to frontend, console or authoritative localStorage.
- [ ] Verified timestamp and controlled re-verification on phone change.
- [ ] Remove client-controlled `phoneVerified` from profile update.
- [ ] KYC and withdrawal use backend verification state.

# Phase 9 — Real KYC / Identity Verification [ ]
- [ ] Server-side phone prerequisite.
- [ ] Integrate Didit into existing BitZimi KYC UX.
- [ ] Persist required identity fields without unsupported/ad-hoc requirements.
- [ ] Validate country/ID type and document ownership.
- [ ] Private production storage and short-lived signed URLs.
- [ ] File security, retention, deletion and replacement lifecycle.
- [ ] Real Didit verification; production mock mode blocked.
- [ ] Auto-approve/manual-review/reject/resubmission lifecycle.
- [ ] Atomic KYC/profile/address-lock synchronization.
- [ ] Notifications and audit trail.
- [ ] Remove sensitive PII/images from localStorage and unsafe logs.
- [ ] Secure admin document review; explicit Super Admin-only override where permitted.
- [ ] Durable KYC processing; no process-local critical verification job.
- [ ] KYC document keys must be ownership-checked server-side.

# Phase 10 — VIP & Verification-Gated Privileges [ ]
- [ ] One unified VIP subscription.
- [ ] Eligibility = active VIP + verified KYC.
- [ ] No separate direct phone gate; phone remains KYC prerequisite.
- [ ] Task, Football AI and all other VIP gates use backend identity.
- [ ] Purchase/renew/expiry/streaks.
- [ ] Admin grants: 1 week, 2 weeks, 1 month, 3 months, 1 year.
- [ ] Cancel/reset/monitor/audit.
- [ ] No client-side VIP authority.
- [ ] Normalize all `approved`/`verified` contracts.

# Phase 11 — Promotions, Monthly Events, Notifications & Rewards [ ]
- [ ] Promotion lifecycle, scheduling, eligibility, funding and approval.
- [ ] Featured promotion flow.
- [ ] Monthly Challenge/Event lifecycle and leaderboards.
- [ ] Referral/affiliate/ambassador connections.
- [ ] Exactly-once rewards.
- [ ] Notification delivery/read/unread/delete/broadcast/retry.
- [ ] Durable event/outbox/queue semantics for critical notifications and rewards.
- [ ] Concurrent challenge distribution cannot double-pay.
- [ ] Full admin controls and audit.

# Phase 12 — Entire Admin Panel & Configuration [ ]
Verify every admin page, route, API and mutation:
- [ ] Dashboard/Analytics.
- [ ] Users/User Detail.
- [ ] KYC.
- [ ] Deposits/Withdrawals/Transactions/Wallets.
- [ ] Tasks/Approvals/Proofs.
- [ ] Games.
- [ ] Football AI.
- [ ] VIP.
- [ ] Referral/Affiliate/Ambassador.
- [ ] Challenges/Football Points.
- [ ] Promotions.
- [ ] Auctions.
- [ ] Notifications.
- [ ] Content/Pages/Platform Text.
- [ ] Security events/login history/sessions/IP controls/fraud/compliance.
- [ ] Audit Log.
- [ ] Currency/Languages/Translations.
- [ ] Feature Management.
- [ ] Settings/configuration.
- [ ] AI Developer Center.
- [ ] Backend permissions are authoritative and frontend child-route permissions align for correct UX.
- [ ] Generic user editing cannot change privileged roles.
- [ ] Role changes are Super Admin-only, explicit and audited.
- [ ] KYC direct overrides are removed or explicit Super Admin-only audited exceptions.
- [ ] Financial/KYC/security actions use least privilege, privacy/masking and immutable audit records.
- [ ] Config pages demonstrably change backend runtime behavior.
- [ ] Analytics reconcile to authoritative transactions/ledger.
- [ ] No mock/local authority in production admin.
- [ ] Display currency remains separate from transaction-rail configuration.
- [ ] AI Developer Center patch lifecycle is authorized, reviewable, auditable, verifiable and rollback-safe.

# Phase 13 — Content, Translation & Localization [ ]
- [ ] Inventory every user-facing string.
- [ ] Full main-platform/admin translation coverage.
- [ ] Backend-managed catalog.
- [ ] Remove business-critical hardcoded text bypassing localization.
- [ ] Synchronize supported languages/currencies without duplicate inconsistent catalogs.
- [ ] Display currency remains separate from transaction currency/rail.
- [ ] Correct timezone/date/money formatting.

# Phase 14 — Security, Database, Runtime & Production Infrastructure [ ]
- [ ] Supabase RLS verification for all relevant tables.
- [ ] DB constraints/index review and legacy cleanup.
- [ ] Exact monetary representation migration and constraints.
- [ ] Durable OTP challenge storage and uniqueness constraints.
- [ ] Rate limits for auth/OTP/password reset/KYC/financial/admin endpoints.
- [ ] Upload/PII/logging security.
- [ ] Session/replay protection and secure headers/CORS.
- [ ] Durable worker scheduling/locking/retries/idempotency.
- [ ] Remove process-local authoritative state, including game/auction/promotion/KYC/notification/crypto-deposit cursors and completion state.
- [ ] Game restart and Render multi-instance recovery.
- [ ] Verify Vercel/Render/Supabase/storage/SMS/email/payment/football providers and production env variables.
- [ ] Verify Kora merchant activation separately for every enabled collection/payout rail.
- [ ] Verify Kora webhook authenticity, provider-reference reconciliation and status-query recovery.
- [ ] Verify blockchain checkpoint/replay recovery for crypto deposits and payouts.
- [ ] Keep unsupported/unconfirmed rails disabled.

# Phase 15 — AI Developer Center [ ]
- [ ] Real repository scans.
- [ ] Issue classification/evidence.
- [ ] Patch proposals and admin approval/rejection.
- [ ] Verification/rollback.
- [ ] CI/CD, scan history and monitoring.
- [ ] Never represent mock scan output as real.

# Phase 16 — Dead Code / Duplication / Legacy Cleanup [ ]
After dependency analysis:
- [ ] Root `app/` duplicate frontend tree where proven unused.
- [ ] Legacy `main` wallet.
- [ ] Local identity/profile authority.
- [ ] Simulated phone OTP.
- [ ] Simulated/local KYC verification and local sensitive KYC progress.
- [ ] Duplicate API/profile/proof/settlement logic.
- [ ] Obsolete static game/lobby configuration.
- [ ] Local Spin Battle settlement/idempotency authority.
- [ ] Obsolete manual Football paths conflicting with automatic AI.
- [ ] Superseded local-only withdrawal dialogs/monitoring paths after dependency verification.
- [ ] Dead admin/game services/routes/components.
- [ ] Obsolete DB fields/models/indexes.
- [ ] Stale flags/phase comments.
- [ ] Duplicate payment/deposit/withdrawal implementations.

# Phase 17 — Automated Testing, E2E & Final Sign-Off [ ]
- [ ] Backend unit/integration/authorization/financial/concurrency/KYC/phone/game/worker tests.
- [ ] Frontend automated test framework and CI.
- [ ] Full E2E: registration → email → login/2FA → independent phone → KYC/Didit → profile/settings → VIP → tasks → all games/fairness → Football AI → auction → referral/affiliate/ambassador → deposits/withdrawals/transfers/history → promotions/events/notifications → admin.
- [ ] Settings E2E: language, display currency, password, Security PIN, bank details, USDT address and address security.
- [ ] Payment E2E for enabled NGN/KES/ZAR/GHS rails, USD withdrawal and verified GBP withdrawal; USD deposit disabled pending Kora confirmation; GBP deposit unavailable.
- [ ] Fiat/Kora deposit E2E: create → provider collection → pending → webhook/status confirmation → success/failure/reversal/dispute → replay.
- [ ] Crypto/BEP-20 deposit E2E: session → exact amount → detection → confirmations → credit → expiry/failure → restart/replay.
- [ ] Current WithdrawalWizard E2E: bank and crypto branches, phone gate, destination setup, PIN, amount/fee/limits, submission, pending/final states, failure/release and retry/recovery.
- [ ] Withdrawal phone-gate E2E for unverified and already-verified users, including automatic return to original withdrawal flow.
- [ ] Transfer idempotency/replay E2E.
- [ ] Adversarial/security/concurrency/replay/idempotency/restart tests across every money/reward/commission/settlement flow.
- [ ] Every Admin role tested against every privileged route/mutation.
- [ ] Final gate: no unresolved P0; no P1 without accepted risk; canonical identity/phone/KYC/VIP rules verified; ledger reconciled; provider/infrastructure/security verified; audit report updated.
- [ ] Final sign-off follows phase order 1 → 17.

---

## Additional-requirement rule — mandatory for every phase

During implementation of any phase, if actual code inspection, dependency analysis, business logic or verification reveals a requirement genuinely necessary to make that phase fully complete and it is not already listed, it must be implemented and explicitly added under that same phase as **Additional requirement discovered during implementation**. The new item must then be tested and verified before the phase can be marked `[✓]`. Unrelated improvements must not be added merely because they are desirable.
