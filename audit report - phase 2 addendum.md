# BitZimi — Phase 2 Games Center Audit Addendum

**Date:** 2026-09-06  
**Scope:** Phase 2 of `completion road map v2.md`  
**Repositories:** `Bitzimi/bitzimi-backend`, `Bitzimi/bitzimi-frontend`

## Phase 2 audit and implementation results

### 1. Backend authority
All seven game families were traced to backend round/match state and server settlement paths. The active frontend game pages consume backend round/results rather than authorizing wallet debits, payouts or settlement locally.

### 2. Colour Prediction
The backend round lifecycle remains the authority for betting, result generation and settlement. A database settlement guard was added so a concurrently running settlement cannot mutate an already-settled `game_bet`; a losing concurrent settlement therefore rolls back its wallet/ledger work. Void rounds remain full-refund/no-commission rounds.

### 3. Coin Flip
Immediate match funding is now performed atomically with `PvpMatch` creation. If settlement is interrupted, the recovery loop finds active unresolved Coin Flip matches and retries settlement. Finalized PVP matches are protected against duplicate final mutation. Final settlement now records both the winner `game_win` ledger entry and loser `game_loss` ledger entry and creates backend-authoritative win/loss notifications atomically.

### 4. Dice Clash
The server determines both dice rolls. **The higher number wins.** Equal rolls use the deterministic tie-break path. Immediate match funding is atomic and settlement is guarded against duplicate finalization. Final settlement now records both winner/loss financial-history rows and backend win/loss notifications.

### 5. Dice Royale
The server derives every player's die result, selects the **highest number** as winner and uses deterministic tie-break rolls when required. Player-list updates are protected against concurrent last-write-wins loss by a DB trigger that merges concurrent player IDs and rejects the transaction when the six-player cap would be exceeded.

### 6. Dice Arena
The server derives every player's die result, ranks by **highest number**, and pays the top two players according to the configured 60/40 prize split. The same durable player-list merge/cap protection and finalized-round settlement guard apply.

### 7. Spin Battle
Winner selection was corrected to use the actual locked stake of each player as the probability weight. The selection uses deterministic HMAC-derived 64-bit rejection sampling to avoid modulo bias. The exact player IDs and stake weights used for settlement are persisted in `resultData`, allowing the Provably Fair verification path to recompute the winner independently.

### 8. Reaction Tap
Reaction Tap remains outside Provably Fair by business rule. Match state, readiness, signal timestamp and taps are stored in the database. Timeout processing is database-state driven through the matchmaking recovery loop rather than relying on a single process-local timeout callback. Final settlement now records winner/loss history and backend-authoritative notifications; void/refund outcomes remain atomic.

### 9. Matchmaking
Queue entries have a durable uniqueness guard for one waiting user/game/stake combination. Opponent claims remain conditional on `status = waiting`. **The queue is now lease-based:** waiting entries expire after 15 seconds unless the authenticated player continues polling; queue polling renews the lease, and expired entries are never reused. This prevents a kicked/disconnected player from being matched later. Match creation and both stake debits execute in one database transaction. Active immediate matches are retried by the recovery loop after restart/interruption.

### 10. Game rate limiting
The previous games scope used a 30/minute default-IP bucket. Because two legitimate users on the same mobile/Wi-Fi NAT shared that bucket, normal game polling could return `RATE_LIMITED` and the frontend could interpret the failure as being kicked. The games scope is now 120 requests/minute per authenticated authorization key, while the global ceiling remains 200/minute per authenticated key. This separates users sharing an IP and provides sufficient capacity for game polling.

### 11. Private rooms
Guest joins use row locking. Match starts/rematches claim the room with a durable `starting` state before funding the match, preventing concurrent start requests from creating duplicate funded matches.

### 12. Wallet transaction history and notifications
The active frontend transaction context now preserves backend `game_bet` as `game_bet` instead of incorrectly mapping it to `game_loss`, and consumes backend `game_loss` rows created by PvP settlement. The notification context checks the backend before adding legacy optimistic game notifications so the same authoritative game result is not displayed twice.

### 13. Frontend authority
The active `src/app/` game pages use backend round/result data for gameplay outcomes. Remaining localStorage game utilities found by the audit are legacy/display-cache candidates and remain explicitly excluded from financial authority; their final removal belongs to Phase 16 after dependency verification.

### 14. Phase 1 audit correction discovered during Phase 2
The production build exposed a syntax regression in `src/modules/admin/proofs/admin.proofs.service.ts` from the Phase 1 implementation. It was corrected, and the backend successfully reached the Render runtime after the correction.

## Verification

- Backend TypeScript compilation passed on the final corrected deployment path.
- Render build for commit `c61d089da8e4dd330e8db023459ea16766944e40` completed successfully and the service reached live runtime startup.
- Render runtime logs confirmed production configuration validation, game lobby startup, background worker startup and server listening on port 10000.
- Supabase production inspection confirmed there are currently no waiting matchmaking queue entries after the lease cleanup behavior is active.
- Frontend deployments for commits `8437a76aaf440acc5117a09f8ae34b35ed89c16e` and `faa3cfbc7915b6c10e5ac5d7b8ba41599fdaf879` reached Vercel `READY` production state.
- Phase 2 roadmap items and the newly verified matchmaking/rate-limit/history requirements were reconciled in `completion road map v2.md`.

## Remaining work intentionally outside Phase 2

The audit still contains P0/P1 findings for phone OTP, Didit KYC, VIP gating, exact money representation, real Kora payments, crypto payout, Football AI, auctions, admin authorization, RLS, durable infrastructure and final E2E/security testing. Those remain in their designated later roadmap phases and were not pulled into Phase 2 arbitrarily.
