# BitZimi — Master Completion Roadmap v2

**Updated:** 2026-09-07  
**Source of truth:** `audit report.md` — expanded full frontend/backend code audit dated 2026-09-06, plus confirmed BitZimi business/payment requirements.

This is the existing master roadmap. No second roadmap has been created.

## Mandatory implementation rules

1. Before starting ANY phase, first read these Mandatory rules, the Canonical rules, and the complete checklist for that phase.
2. When a phase starts, every item currently listed under it is in scope and must be audited before implementation.
3. If code/dependency/business-logic verification discovers a requirement genuinely necessary to make the current phase complete but not already listed, implement it and explicitly add it under that phase as **Additional requirement discovered during implementation**. Do not add arbitrary work.
4. A phase cannot become `[✓]` until every original and genuinely necessary additional item is implemented, tested, verified and re-tested where necessary.
5. Backend is authoritative for identity, phone/KYC, VIP, financial state, game state, permissions, rewards and commissions.
6. Never use localStorage as authority for identity, phone/KYC, VIP, balances, bets, settlements, rewards or financial status.
7. Sensitive/privileged operations must be protected server-side.
8. Money, rewards, commissions, verification and settlement require transactions, constraints and idempotency.
9. Preserve existing BitZimi business rules and UX unless an audit finding requires correction.
10. Remove duplicate/dead code only after dependency verification.
11. Every phase ends: build/typecheck → tests → failure review → fixes → repeat verification.
12. Phase completion requires the real business flow to work end-to-end, not merely compile.
13. Provider capability and merchant activation must be verified before exposing a transaction rail.
14. Settings currency is display-only and must never select/change a payment rail.
15. After all original/additional items pass, immediately update this roadmap, mark the verified phase/items `[✓]`, and commit code + roadmap before moving on.

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

# Phase 1 — Task Marketplace, Creator, My Task & Proof [✓]
- [✓] Enforce VIP + KYC `verified` eligibility server-side; phone is an inherent KYC prerequisite.
- [✓] Full Task Wallet funding and Task Vault escrow lifecycle.
- [✓] Correct approval/rejection, pause/resume/stop, completion and 35/45/65% reward tiers.
- [✓] Force edited tasks back to admin review; creator cannot manipulate protected status/review state.
- [✓] Complete Marketplace/My Task ownership and proof lifecycle.
- [✓] AI-first proof verification, manual fallback and exactly-once reward settlement.
- [✓] Secure proof/document ownership and storage.
- [✓] Admin task/proof management and audit logging.
- [✓] **Additional requirement discovered during full audit:** creator update paths must not accept a status mutation that can bypass the required review lifecycle.
- [✓] **Additional requirement discovered during implementation:** proof AI verification is queued in the existing DB-backed job queue before the request returns, with retry/stuck-job recovery; reward settlement remains transactionally guarded and idempotent.
- [✓] **Additional requirement discovered during implementation:** task reference/proof uploads are server-validated; client-supplied existing storage paths are rejected for task reference screenshots and proof uploads are restricted to supported image MIME types.
- [✓] **Additional requirement discovered during implementation:** rejecting an edited task with previously completed proofs refunds only the remaining Task Vault escrow, preventing an over-refund of already-paid rewards.

# Phase 2 — Games Center [✓]
- [✓] Backend-authoritative rounds, stakes, timers, locks, results and settlement.
- [✓] Remove localStorage game authority; harden concurrency, max players, timeouts and restart recovery.
- [✓] Complete Colour Prediction, Coin Flip, Dice Clash, Dice Royale, Dice Arena, Spin Battle and Reaction Tap.
- [✓] Dice Clash highest-number rule: the higher roll wins; equal rolls use the deterministic tie-break path.
- [✓] Dice Royale highest-number rule.
- [✓] Dice Arena top-two/60-40 rule.
- [✓] Spin Battle stake-proportional winner probability and matching server-side wheel probability model.
- [✓] Provably Fair verification for applicable games; Reaction Tap excluded.
- [✓] No client-side financial settlement authority.
- [✓] Durable/restart-safe matchmaking and round state.
- [✓] **Additional requirement discovered during implementation:** added durable DB uniqueness/settlement guards for game bets, active dice rounds and matchmaking queue entries, plus a database trigger that merges concurrent Dice Royale/Arena player lists and rejects over-capacity joins atomically.
- [✓] **Additional requirement discovered during implementation:** immediate 1v1 match funding now occurs in one transaction with match creation; a durable recovery loop retries unresolved Dice Clash/Coin Flip settlements after restart.
- [✓] **Additional requirement discovered during implementation:** Reaction Tap signal/timeout processing is database-state driven rather than dependent on a single process-local timeout callback.
- [✓] **Additional requirement discovered during implementation:** private-room join/start/rematch transitions use row locking and a `starting` claim state so concurrent start requests cannot create duplicate funded matches.
- [✓] **Additional requirement discovered during implementation:** Spin Battle settlement now persists the exact player/stake inputs used for the weighted Provably Fair calculation so the result can be independently verified.
- [✓] **Additional requirement discovered during implementation:** the Phase 1 admin proof service syntax regression found during the Phase 2 audit was corrected and the production build re-verified.
- [✓] **Additional requirement discovered during Phase 2 verification:** game rate limiting is now keyed by authenticated user and the games scope allows sufficient polling capacity; users sharing one IP no longer consume the same game-rate bucket.
- [✓] **Additional requirement discovered during Phase 2 verification:** 1v1 matchmaking uses a 15-second waiting lease renewed by authenticated queue polling; expired/disconnected/kicked players cannot remain matchable as ghost opponents.
- [✓] **Additional requirement discovered during Phase 2 verification:** Coin Flip, Dice Clash and Reaction Tap settlements now record explicit winner/loss wallet-history entries and backend-authoritative win/loss notifications atomically with settlement.
- [✓] **Additional requirement discovered during Phase 2 verification:** frontend wallet history preserves `game_bet` correctly and consumes backend `game_loss`; legacy optimistic game notifications are deduplicated against backend settlement notifications.
- [✓] **Additional requirement discovered during Phase 2 verification:** final backend build/typecheck and Render production deployment were re-verified after the above fixes; frontend production deployments for the corresponding transaction/notification changes reached Vercel `READY`.
- [✓] **Additional requirement discovered during Phase 2 verification:** Colour Prediction publishes the authoritative winner at the start of the 6-second `SPINNING` phase so the frontend wheel can animate for the full 6 seconds before the `RESULT` phase.
- [✓] **Additional requirement discovered during Phase 2 verification:** Colour Prediction personal bet history is now backend-derived across rounds, replacing the frontend-only `betService` history path; placement, win, loss and refund states are retained after reload.
- [✓] **Additional requirement discovered during Phase 2 verification:** Colour Prediction normal settlements now create explicit `game_loss` ledger entries and backend win/loss notifications atomically; voided-round participants receive a backend void/refund notification.
- [✓] **Additional requirement discovered during Phase 2 verification:** the Colour Prediction void/refund popup is participant-only; spectators retain the existing non-participant popup, and result popups auto-close after 5 seconds without changing the other popup designs.
- [✓] **Additional requirement discovered during Phase 2 verification:** Colour Prediction's closing warning now begins at 15 seconds; `Bet Closed` appears only when the backend enters `SPINNING` at zero, and wallet/transaction/notification state is refreshed from backend settlement.
- [✓] **Verification:** backend `npm run build`/TypeScript compilation passed on Render for commit `9dc12bf0cba200d0c87e7ea32774a7260a28b913`, Prisma reported no pending migrations, Render marked the deployment `LIVE`, and the corresponding frontend Vercel deployment for commit `9fc1da58f3784a01e198de71ff388ccf96e39e66` reached `READY`.

# Phase 3 — Football AI [ ]
- [ ] Backend-authoritative VIP entitlement; client/query `isVip` cannot grant access.
- [ ] Free-user daily allowance, VIP access and exact UTC/day behavior.
- [ ] Provider freshness/fail-closed behavior.
- [ ] Durable prediction generation/publishing/scheduling.
- [ ] Admin/manual prediction authorization unified with user access rules.
- [ ] Football Hub points exactly-once.

# Phase 4 — Auction Marketplace [ ]
- [ ] Durable scheduler/locking across restart and multiple instances.
- [ ] Atomic bid concurrency, bid numbering and leader state.
- [ ] Reservation/debit/refund lifecycle and exactly-once settlement.
- [ ] Secure authenticated live/SSE updates.
- [ ] Claim/expiry/cancel/reward delivery reconciliation.

# Phase 5 — Referral, Affiliate & Ambassador [ ]
- [ ] Self-referral and circular-lineage protection.
- [ ] First-VIP reward exactly-once.
- [ ] Commission concurrency/idempotency.
- [ ] Correct wallet destinations.
- [ ] Ambassador application, approval, activity and distribution lifecycle.

# Phase 6 — Wallet, Ledger & Financial [ ]
- [ ] Exact monetary representation; remove Float from financial accounting.
- [ ] Real Kora collection and payout integration.
- [ ] Preserve canonical withdrawal UX.
- [ ] Durable crypto deposit monitoring.
- [ ] Actual crypto payout execution.
- [ ] No generated BZ/manual normal fiat deposit execution.
- [ ] Frontend cannot finalize financial state.
- [ ] Transfer idempotency and immutable ledger reconciliation.

# Phase 7 — Profile, Settings, Authentication & Identity [ ]
- [ ] `/users/me` sole identity source.
- [ ] Username cooldown enforced server-side.
- [ ] Auth refresh/retry behavior hardened.
- [ ] Payment-detail security and synchronization.

# Phase 8 — Real Phone Verification [ ]
- [ ] Real Contiguity OTP.
- [ ] Server-generated OTP, expiry, attempts, resend/rate limits and durable verification state.
- [ ] Reverify on phone change.

# Phase 9 — Real KYC / Identity Verification [ ]
- [ ] Didit authoritative integration.
- [ ] Ownership checks and durable KYC state.
- [ ] Private storage, signed access, retention/deletion/replacement.
- [ ] No sensitive KYC data in localStorage.

# Phase 10 — VIP & Verification-Gated Privileges [ ]
- [ ] Unified VIP entitlement.
- [ ] KYC `verified` prerequisite.
- [ ] Admin grants with required durations.
- [ ] Normalize `approved`/`verified` mismatch.

# Phase 11 — Promotions, Monthly Events, Notifications & Rewards [ ]
- [ ] Durable reward/notification semantics.
- [ ] Concurrent challenge distribution cannot double-pay.
- [ ] Promotion lifecycle reconciliation.

# Phase 12 — Entire Admin Panel & Configuration [ ]
- [ ] All admin sections and child-route permissions align.
- [ ] Role changes are Super Admin-only.
- [ ] KYC overrides explicit and audited.
- [ ] Configuration pages affect backend behavior.
- [ ] Analytics reconcile to ledger.
- [ ] No mock/local production authority.

# Phase 13 — Content, Translation & Localization [ ]
- [ ] Content/static pages publish lifecycle.
- [ ] Translation catalog and approval lifecycle.
- [ ] Language synchronization.

# Phase 14 — Security, Database, Runtime & Production Infrastructure [ ]
- [ ] RLS and database ownership/constraints.
- [ ] Exact money representation.
- [ ] Durable OTP, rate limits, upload/PII/logging controls.
- [ ] Session/replay/CORS/security hardening.
- [ ] Durable workers, locks and checkpoints; no process-local critical state.
- [ ] Render multi-instance recovery.
- [ ] Verify all integrations and Kora rail activation.
- [ ] Unsupported rails disabled.
- [ ] Durable auction/challenge/KYC/notification/crypto checkpoints.
- [ ] Audit duplicate frontend trees.

# Phase 15 — AI Developer Center [ ]
- [ ] Real project scanning and issue detection.
- [ ] Auto-fix generation, approval, verification and rollback.
- [ ] Integrations, CI/CD and monitoring.

# Phase 16 — Dead Code / Duplication / Legacy Cleanup [ ]
- [ ] Remove legacy wallet and local identity authority.
- [ ] Remove simulated OTP and local KYC authority.
- [ ] Remove duplicate/static game/lobby configuration.
- [ ] Remove obsolete Football paths.
- [ ] Remove dead admin/game code and obsolete DB fields.
- [ ] Remove duplicate payment paths.
- [ ] Remove root `app/` duplicate tree only after dependency verification against active `src/app/`.

# Phase 17 — Automated Testing, E2E & Final Sign-Off [ ]
- [ ] Backend and frontend test coverage.
- [ ] Full E2E flows.
- [ ] Payment E2E.
- [ ] Phone-gate tests.
- [ ] Provider replay/retry/restart tests.
- [ ] Crypto tests.
- [ ] Adversarial auth/concurrency/idempotency tests.
- [ ] Final P0/P1 gate and production sign-off.
