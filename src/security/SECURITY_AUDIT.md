# Bitzimi Platform — Security Audit Report
# Phase 3H — Production Security Assessment

Generated: Phase 3H implementation
Status: Pre-deployment review

---

## 1. AUTHENTICATION & SESSION SECURITY

| Control | Status | Implementation |
|---------|--------|---------------|
| Password hashing | ✅ bcrypt cost 12 | `utils/hash.ts` `hashPassword()` |
| PIN hashing | ✅ bcrypt cost 10 | `utils/hash.ts` `hashPin()` |
| JWT access token | ✅ 15-minute TTL, signed | `utils/jwt.ts` `signAccessToken()` |
| JWT refresh token | ✅ 7-day TTL, rotated on use | `modules/auth/auth.service.ts` `refreshTokens()` |
| Refresh token storage | ✅ SHA-256 hash in DB, never raw | `auth_tokens.tokenHash` |
| Token revocation | ✅ `revokedAt` timestamp in DB | `logoutUser()` sets `revokedAt` |
| Constant-time password check | ✅ Dummy bcrypt on unknown email | Prevents user enumeration timing |
| Account lockout | ✅ 5 failures → 15-min lockout | `modules/auth/authAttempts.ts` |
| Suspended account check | ✅ Login blocked if `suspendedAt` set | `loginUser()` |
| Security PIN (withdrawal) | ✅ One-time UUID token, 5-min TTL | `modules/withdrawals/pinTokens.ts` |

---

## 2. API SECURITY

| Control | Status | Implementation |
|---------|--------|---------------|
| Input validation | ✅ Zod schemas on every endpoint | All route handlers |
| SQL injection | ✅ Prisma parameterized queries | No raw SQL with user input |
| Body size limit | ✅ 1 MB max payload | `Fastify({ bodyLimit: 1MB })` |
| CORS | ✅ Explicit origin whitelist | `CORS_ORIGINS` env var |
| Security headers | ✅ Helmet with CSP, HSTS, X-Frame | `index.ts` helmet config |
| Content-Security-Policy | ✅ Strict: default-src 'self' | Production mode |
| HSTS | ✅ max-age=31536000, includeSubdomains | Production mode |
| X-Frame-Options | ✅ DENY | Helmet xFrameOptions |
| X-Content-Type-Options | ✅ nosniff | Helmet xContentTypeOptions |

---

## 3. RATE LIMITING

| Endpoint Group | Limit | Window | Key |
|---------------|-------|--------|-----|
| Auth (login/register) | 5 req | 1 min | Per IP |
| Financial (deposits/withdrawals) | 10 req | 1 min | Per user+IP |
| Games (bets, polls) | 30 req | 1 min | Per user+IP |
| Admin | 60 req | 1 min | Per user+IP |
| Global fallback | 200 req | 1 min | Per user+IP |

---

## 4. FINANCIAL SECURITY

| Control | Status | Implementation |
|---------|--------|---------------|
| Withdrawal limit enforcement | ✅ Server-side | `modules/withdrawals/limits.ts` |
| Atomic wallet deduction | ✅ Prisma `$transaction` | All debit operations |
| Race condition prevention | ✅ DB-level guards | Pending join Sets + transaction checks |
| Settlement idempotency | ✅ `updateMany` guards | All game settlement functions |
| Withdrawal PIN required | ✅ One-time token consumed | `modules/withdrawals/pinTokens.ts` |
| Deposit memo uniqueness | ✅ Collision detection, 100 retries | `deposits.service.ts` |
| 7% withdrawal fee | ✅ Server-calculated | `withdrawals.service.ts` |

---

## 5. GAME INTEGRITY

| Control | Status | Implementation |
|---------|--------|---------------|
| CSPRNG for results | ✅ `crypto.randomBytes()` / `randomInt()` | All game services |
| Color Game result sealing | ✅ Sealed in DB until SPIN phase | `colorGame.service.ts` |
| No client-predictable seeds | ✅ Math.sin() removed, CSPRNG only | Phase 3F correction |
| Settlement runs once | ✅ DB status guard (`updateMany`) | SpinBattle, DiceRoyale, DiceArena |
| Anti-double-bet | ✅ Atomic check inside `$transaction` | `colorGame.service.ts` `placeBet()` |
| Anti-double-join | ✅ Pending Set + DB check | Royale, Arena, SpinBattle join functions |
| No bots / fake players | ✅ All games require real platform users | Phase 3F correction |

---

## 6. DATA SECURITY

| Control | Status | Implementation |
|---------|--------|---------------|
| KYC document storage | ✅ Local (dev) / S3 (prod) | `modules/kyc/storage.ts` |
| KYC documents not in DB | ✅ Only storage keys stored | `kyc_submissions` table |
| Proof screenshots | ✅ Storage key only, periodic deletion | `jobs/screenshotRetention.ts` |
| Audit logging | ✅ All admin mutations logged | `middleware/auditLog.ts` |
| Admin RBAC | ✅ 5 roles, 28 permissions, per-endpoint | `admin.middleware.ts` |

---

## 7. KNOWN LIMITATIONS & FUTURE WORK

### 7.1 Claude API Key Exposure
**Risk:** `VITE_ANTHROPIC_API_KEY` in frontend bundle exposes the key to all users.
**Current state:** Backend proxy implemented in `modules/ai/claudeVision.ts` using `ANTHROPIC_API_KEY` (server-side, no VITE_ prefix). Frontend `taskVerificationService.ts` has `TODO(backend)` comments.
**Action required:** Remove `VITE_ANTHROPIC_API_KEY` from Vite config and frontend .env before production deployment.

### 7.2 In-Memory State (Single Instance)
**Risk:** All in-memory Maps (game rounds, rate limit counters, PIN tokens, lockout records) are lost on server restart and are not shared across multiple instances.
**Current state:** Acceptable for single-instance deployment.
**Future:** Migrate to Redis for horizontal scaling and persistence.
Affected: `colorGame.service.ts`, `spinBattle.service.ts`, `diceRoyale.service.ts`, `diceArena.service.ts`, `modules/withdrawals/pinTokens.ts`, `modules/auth/authAttempts.ts`.

### 7.3 Background Jobs (setInterval vs BullMQ)
**Risk:** `setInterval`-based jobs (withdrawal limit reset, screenshot retention, streak reminder, queue cleanup) fire at process level. On crash, in-flight jobs are lost. No retry or dead-letter queue.
**Current state:** All jobs have been marked with `TODO(phase-3h)` comments.
**Future:** Replace with BullMQ repeatable jobs backed by Redis.

### 7.4 WebSocket (Real-Time Game State)
**Risk:** Clients currently poll REST endpoints for game state. Under load, polling creates significant request volume.
**Current state:** All game routes include `TODO(phase-3h)` comments for WebSocket migration.
**Future:** Implement Fastify WS plugin with per-lobby channels for Color Game and SpinBattle, and per-match channels for 1v1 games.

### 7.5 TOTP 2FA Secret Storage
**Risk:** TOTP secrets are stored in plain text in `two_factor_settings.secret`.
**Future:** Encrypt at rest using AES-256-GCM with a server-side master key.

### 7.6 KYC Document Review (AWS Integration)
**Risk:** `KYC_VERIFY_MODE=manual` by default — all KYC submissions go to admin queue without automated face/address verification.
**Future:** Set `KYC_VERIFY_MODE=aws` and wire AWS Rekognition + Textract credentials.

### 7.7 Football Bet Slip Wallet Integration
**Risk:** Football prediction bet slips do not deduct from the main wallet (confirmed gap from audit). Football is currently prediction-only.
**Status:** Documented. Not in scope for Phase 3 backend.

---

## 8. PRE-PRODUCTION CHECKLIST

- [ ] Rotate JWT secrets (generate 64-byte hex strings)
- [ ] Set `NODE_ENV=production`
- [ ] Configure `DATABASE_URL` pointing to production PostgreSQL
- [ ] Set `CORS_ORIGINS` to production frontend URL only
- [ ] Set `ANTHROPIC_API_KEY` (server-side, no VITE_ prefix)
- [ ] Set `KYC_VERIFY_MODE=aws` with AWS credentials
- [ ] Set `STORAGE_BACKEND=s3` with S3 bucket + credentials
- [ ] Configure SMTP credentials for email notifications
- [ ] Enable HTTPS / TLS termination at load balancer
- [ ] Set up database connection pooling (PgBouncer or Prisma's built-in)
- [ ] Configure log aggregation (CloudWatch, DataDog, or similar)
- [ ] Set up uptime monitoring on `/health` endpoint
- [ ] Run `prisma migrate deploy` (not `db push`) in production
- [ ] Remove `VITE_ANTHROPIC_API_KEY` from all environments

---

Audit completed by: Automated Phase 3H implementation
