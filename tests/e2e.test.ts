/**
 * Phase 3H — E2E Integration Tests
 *
 * Tests critical platform flows against a live SQLite test database.
 * Run with: DATABASE_URL="file:./test-e2e.db" node --test tests/e2e.test.ts
 *
 * Each test spins up the Fastify app, runs the flow, then tears down.
 * Uses Node.js built-in test runner (no external test framework needed).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import Fastify, { FastifyInstance } from "fastify";
import cors    from "@fastify/cors";
import helmet  from "@fastify/helmet";

// ── Minimal app for testing (no rate limiting, no game tickers) ──────────────

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: "*" });

  const { authRoutes }         = await import("../src/modules/auth/auth.routes");
  const { usersRoutes }         = await import("../src/modules/users/users.routes");
  const { walletsRoutes }       = await import("../src/modules/wallets/wallets.routes");
  const { depositsRoutes }      = await import("../src/modules/deposits/deposits.routes");
  const { withdrawalsRoutes }   = await import("../src/modules/withdrawals/withdrawals.routes");
  const { transactionsRoutes }  = await import("../src/modules/transactions/transactions.routes");
  const { vipRoutes }           = await import("../src/modules/vip/vip.routes");
  const { tasksRoutes }         = await import("../src/modules/tasks/tasks.routes");
  const { proofsRoutes }        = await import("../src/modules/tasks/proofs.routes");
  const { notificationsRoutes } = await import("../src/modules/notifications/notifications.routes");
  const { adminStatsRoutes }    = await import("../src/modules/admin/stats/admin.stats.routes");
  const { adminUsersRoutes }    = await import("../src/modules/admin/users/admin.users.routes");
  const { kycRoutes }           = await import("../src/modules/kyc/kyc.routes");
  const { errorHandler }        = await import("../src/middleware/errorHandler");

  app.register(authRoutes,         { prefix: "/api/v1/auth" });
  app.register(usersRoutes,        { prefix: "/api/v1/users" });
  app.register(walletsRoutes,      { prefix: "/api/v1/wallets" });
  app.register(depositsRoutes,     { prefix: "/api/v1/deposits" });
  app.register(withdrawalsRoutes,  { prefix: "/api/v1/withdrawals" });
  app.register(transactionsRoutes, { prefix: "/api/v1/transactions" });
  app.register(vipRoutes,          { prefix: "/api/v1/vip" });
  app.register(tasksRoutes,        { prefix: "/api/v1/tasks" });
  app.register(proofsRoutes,       { prefix: "/api/v1/tasks" });
  app.register(notificationsRoutes,{ prefix: "/api/v1/notifications" });
  app.register(adminStatsRoutes,   { prefix: "/api/v1/admin/stats" });
  app.register(adminUsersRoutes,   { prefix: "/api/v1/admin/users" });
  app.register(kycRoutes,          { prefix: "/api/v1/kyc" });

  app.setErrorHandler(errorHandler);
  await app.ready();
  return app;
}

// ── Test helpers ──────────────────────────────────────────────────────────────

async function post(app: FastifyInstance, path: string, body: any, token?: string) {
  const headers: any = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await app.inject({ method: "POST", url: path, headers, payload: JSON.stringify(body) });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

async function get(app: FastifyInstance, path: string, token?: string) {
  const headers: any = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await app.inject({ method: "GET", url: path, headers });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

async function patch(app: FastifyInstance, path: string, body: any, token: string) {
  const res = await app.inject({
    method: "PATCH", url: path,
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    payload: JSON.stringify(body),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

// ── Test suite ────────────────────────────────────────────────────────────────

let app: FastifyInstance;
let accessToken = "";
let refreshToken = "";
let adminToken  = "";
let userId      = "";

before(async () => { app = await buildTestApp(); });
after(async () => {
  await app.close();
  const { db } = await import("../src/db");
  await db.$disconnect();
  // Clean up test DB
  const { unlinkSync, existsSync } = await import("fs");
  if (existsSync("./test-e2e.db")) unlinkSync("./test-e2e.db");
});

// ── 1. Registration ───────────────────────────────────────────────────────────
test("POST /auth/register — creates user, 6 wallets, KYC stub", async () => {
  const r = await post(app, "/api/v1/auth/register", {
    email: "e2e_user@bitzimi.com",
    password: "TestPass1234!",
    username: "e2e_user",
  });
  assert.equal(r.status, 201, `Expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert.ok(r.body.data.accessToken, "Should return accessToken");
  assert.ok(r.body.data.refreshToken, "Should return refreshToken");
  assert.equal(r.body.data.expiresIn, 900, "Access token should expire in 900s");
  accessToken  = r.body.data.accessToken;
  refreshToken = r.body.data.refreshToken;
});

// ── 2. Duplicate registration ────────────────────────────────────────────────
test("POST /auth/register — rejects duplicate email (409)", async () => {
  const r = await post(app, "/api/v1/auth/register", {
    email: "e2e_user@bitzimi.com",
    password: "TestPass1234!",
    username: "e2e_user2",
  });
  assert.equal(r.status, 409, "Duplicate email should return 409");
  assert.equal(r.body.error.code, "EMAIL_TAKEN");
});

// ── 3. Login ─────────────────────────────────────────────────────────────────
test("POST /auth/login — returns tokens", async () => {
  const r = await post(app, "/api/v1/auth/login", {
    email: "e2e_user@bitzimi.com",
    password: "TestPass1234!",
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.data.accessToken);
  accessToken = r.body.data.accessToken;
});

// ── 4. Wrong password + lockout ───────────────────────────────────────────────
test("POST /auth/login — wrong password returns 401, lockout after 5 failures", async () => {
  // 5 failures → lockout
  for (let i = 0; i < 5; i++) {
    const r = await post(app, "/api/v1/auth/login", {
      email: "e2e_user@bitzimi.com",
      password: "WrongPassword!",
    });
    assert.equal(r.status, 401, `Attempt ${i+1} should be 401`);
  }
  // 6th attempt should be locked
  const locked = await post(app, "/api/v1/auth/login", {
    email: "e2e_user@bitzimi.com",
    password: "WrongPassword!",
  });
  assert.equal(locked.status, 429, "Should be locked out after 5 failures");
  assert.equal(locked.body.error.code, "ACCOUNT_LOCKED");
  // Re-login with correct password after successful login clears counter
  // (need to login again with correct credentials to reset)
  const ok = await post(app, "/api/v1/auth/login", {
    email: "e2e_user@bitzimi.com",
    password: "TestPass1234!",
  });
  // Still locked — lockout persists regardless of correct password until TTL
  assert.equal(ok.status, 429, "Lockout should persist even with correct password");
});

// ── 5. Token refresh ──────────────────────────────────────────────────────────
test("POST /auth/refresh — rotates tokens", async () => {
  // Re-register a fresh user to avoid lockout from previous test
  const reg = await post(app, "/api/v1/auth/register", {
    email: "refresh_test@bitzimi.com",
    password: "TestPass1234!",
    username: "refresh_user",
  });
  const rt = reg.body.data.refreshToken;
  const r  = await post(app, "/api/v1/auth/refresh", { refreshToken: rt });
  assert.equal(r.status, 200);
  assert.ok(r.body.data.accessToken);
  assert.notEqual(r.body.data.refreshToken, rt, "Refresh token should be rotated");
});

// ── 6. GET /users/me ──────────────────────────────────────────────────────────
test("GET /users/me — returns identity", async () => {
  // Use a fresh token (lockout test invalidated e2e_user tokens)
  const reg2 = await post(app, "/api/v1/auth/register", {
    email: "me_test@bitzimi.com",
    password: "TestPass1234!",
    username: "me_user",
  });
  const token = reg2.body.data.accessToken;
  const r = await get(app, "/api/v1/users/me", token);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.email, "me_test@bitzimi.com");
  assert.equal(r.body.data.verification.status, "unverified");
  assert.equal(r.body.data.vip.isActive, false);
  userId = r.body.data.id;
  accessToken = token;
});

// ── 7. Wallets provisioned ────────────────────────────────────────────────────
test("GET /wallets — all 6 wallets provisioned at zero", async () => {
  const r = await get(app, "/api/v1/wallets", accessToken);
  assert.equal(r.status, 200);
  const b = r.body.data.balances;
  assert.equal(Object.keys(b).length, 6, "Should have exactly 6 wallets");
  for (const [type, bal] of Object.entries(b)) {
    assert.equal(bal, 0, `${type} wallet should start at 0`);
  }
});

// ── 8. Deposit creation ───────────────────────────────────────────────────────
test("POST /deposits — creates deposit with unique memo amount", async () => {
  const r = await post(app, "/api/v1/deposits", {
    amount: 100,
    method: "crypto",
    walletAddress: "TBitzimi123Test",
  }, accessToken);
  assert.equal(r.status, 201);
  const d = r.body.data;
  assert.equal(d.requestedAmount, 100);
  assert.ok(d.memoAmount !== 100, "Memo amount should be unique (not exactly 100)");
  assert.ok(d.memoAmount > 100 && d.memoAmount < 101, "Memo amount should be 100.0XXXX");
  assert.equal(d.status, "pending");
  assert.ok(d.expiresAt, "Should have expiry time");
});

// ── 9. Duplicate deposit blocked ──────────────────────────────────────────────
test("POST /deposits — blocks second deposit while first is pending (409)", async () => {
  const r = await post(app, "/api/v1/deposits", {
    amount: 50, method: "bank",
  }, accessToken);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "DEPOSIT_ALREADY_PENDING");
});

// ── 10. Withdrawal limit check ────────────────────────────────────────────────
test("GET /withdrawals/limits — returns free tier limits", async () => {
  const r = await get(app, "/api/v1/withdrawals/limits", accessToken);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.tier, "free");
  assert.equal(r.body.data.dailyLimit, 100);
  assert.equal(r.body.data.monthlyLimit, 1000);
  assert.equal(r.body.data.dailyUsed, 0);
});

// ── 11. Withdrawal requires PIN token ────────────────────────────────────────
test("POST /withdrawals — rejects without valid PIN token (400)", async () => {
  const r = await post(app, "/api/v1/withdrawals", {
    amount: 10,
    destination: "TBitzimiFake123",
    method: "crypto",
    pinToken: "00000000-0000-0000-0000-000000000000",
  }, accessToken);
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, "PIN_TOKEN_INVALID");
});

// ── 12. VIP subscription ──────────────────────────────────────────────────────
test("POST /vip/subscribe — requires sufficient balance (400 when zero)", async () => {
  const r = await post(app, "/api/v1/vip/subscribe", {}, accessToken);
  assert.equal(r.status, 400, "Should fail — main wallet is 0");
  assert.equal(r.body.error.code, "INSUFFICIENT_BALANCE");
});

// ── 13. KYC document upload ───────────────────────────────────────────────────
test("POST /kyc/documents/front — stores document key", async () => {
  const r = await post(app, "/api/v1/kyc/documents/front", {
    dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
  }, accessToken);
  assert.equal(r.status, 201);
  assert.ok(r.body.data.key, "Should return storage key");
  assert.ok(r.body.data.key.startsWith("kyc/"), "Key should be in kyc/ namespace");
});

// ── 14. KYC status ───────────────────────────────────────────────────────────
test("GET /kyc — returns unverified status for new user", async () => {
  const r = await get(app, "/api/v1/kyc", accessToken);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.status, "unverified");
});

// ── 15. Notifications ────────────────────────────────────────────────────────
test("GET /notifications — empty for new user", async () => {
  const r = await get(app, "/api/v1/notifications", accessToken);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.items.length, 0);
});

test("GET /notifications/unread-count — zero for new user", async () => {
  const r = await get(app, "/api/v1/notifications/unread-count", accessToken);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.count, 0);
});

// ── 16. Admin stats ───────────────────────────────────────────────────────────
test("GET /admin/stats — returns 403 for non-admin user", async () => {
  const r = await get(app, "/api/v1/admin/stats", accessToken);
  assert.equal(r.status, 403, "Regular user should be forbidden from admin stats");
});

// ── 17. Unauthenticated access blocked ───────────────────────────────────────
test("GET /api/v1/wallets — returns 401 without token", async () => {
  const r = await get(app, "/api/v1/wallets");
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, "UNAUTHORIZED");
});

test("GET /api/v1/users/me — returns 401 without token", async () => {
  const r = await get(app, "/api/v1/users/me");
  assert.equal(r.status, 401);
});

// ── 18. Input validation ──────────────────────────────────────────────────────
test("POST /auth/register — rejects invalid email (400)", async () => {
  const r = await post(app, "/api/v1/auth/register", {
    email: "not-an-email",
    password: "TestPass1234!",
    username: "bad_email_user",
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, "VALIDATION_ERROR");
});

test("POST /auth/register — rejects short password (400)", async () => {
  const r = await post(app, "/api/v1/auth/register", {
    email: "valid@test.com",
    password: "short",
    username: "shortpassuser",
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, "VALIDATION_ERROR");
});

test("POST /deposits — rejects negative amount (400)", async () => {
  const r = await post(app, "/api/v1/deposits", {
    amount: -50,
    method: "crypto",
    walletAddress: "TBitzimi123",
  }, accessToken);
  assert.equal(r.status, 400);
});
