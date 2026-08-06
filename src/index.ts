import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config";
import { errorHandler } from "./middleware/errorHandler";
// 3H
import { validateProductionConfig } from "./security/productionCheck";
// 3A
import { authRoutes }            from "./modules/auth/auth.routes";
import { usersRoutes }            from "./modules/users/users.routes";
import { walletsRoutes }          from "./modules/wallets/wallets.routes";
// 3B
import { transactionsRoutes }     from "./modules/transactions/transactions.routes";
import { depositsRoutes }         from "./modules/deposits/deposits.routes";
import { withdrawalsRoutes }      from "./modules/withdrawals/withdrawals.routes";
// 3C
import { kycRoutes }              from "./modules/kyc/kyc.routes";
import { adminKycRoutes }         from "./modules/admin/kyc/admin.kyc.routes";
// 3D
import { tasksRoutes }            from "./modules/tasks/tasks.routes";
import { proofsRoutes }           from "./modules/tasks/proofs.routes";
import { adminTasksRoutes }       from "./modules/admin/tasks/admin.tasks.routes";
import { adminProofsRoutes }      from "./modules/admin/proofs/admin.proofs.routes";
// 3E
import { vipRoutes }              from "./modules/vip/vip.routes";
import { referralsRoutes }        from "./modules/referrals/referrals.routes";
import { affiliatesRoutes }       from "./modules/affiliates/affiliates.routes";
// 3F
import { gamesSharedRoutes }      from "./modules/games/games.routes";
import { colorGameRoutes }        from "./modules/games/colorGame/colorGame.routes";
import { spinBattleRoutes }       from "./modules/games/spinBattle/spinBattle.routes";
import { matchmakingRoutes }      from "./modules/games/matchmaking/matchmaking.routes";
import { diceRoyaleRoutes }       from "./modules/games/diceRoyale/diceRoyale.routes";
import { diceArenaRoutes }        from "./modules/games/diceArena/diceArena.routes";
import { provablyFairRoutes }     from "./modules/games/provablyFair.routes";
import { startColorGameLobbies }  from "./modules/games/colorGame/colorGame.service";
import { startSpinBattleLobbies } from "./modules/games/spinBattle/spinBattle.service";
import { startQueueCleanup }      from "./modules/games/matchmaking/matchmaking.service";
import { privateRoomRoutes }       from "./modules/games/privateRoom/privateRoom.routes";
import { cleanupExpiredRooms }     from "./modules/games/privateRoom/privateRoom.service";
// 3G
import { notificationsRoutes }    from "./modules/notifications/notifications.routes";
import { platformRoutes }         from "./modules/platform/platform.routes";
import { publicRoutes }           from "./modules/platform/public.routes";
import { adminStatsRoutes }       from "./modules/admin/stats/admin.stats.routes";
import { adminUsersRoutes }       from "./modules/admin/users/admin.users.routes";
import { adminDepositsRoutes }       from "./modules/admin/deposits/admin.deposits.routes";
import { adminWithdrawalsRoutes }    from "./modules/admin/withdrawals/admin.withdrawals.routes";
import { adminTransactionsRoutes }   from "./modules/admin/transactions/admin.transactions.routes";
// Phase 1 — Admin Foundation
import { adminConfigRoutes }      from "./modules/admin/config/admin.config.routes";
import { seedDefaultConfig, getConfigValue } from "./modules/admin/config/admin.config.service";
// Phase 5 — Game Management
import { adminGamesRoutes }       from "./modules/admin/games/admin.games.routes";
import { seedDefaultRooms }       from "./modules/admin/games/admin.games.service";
// Phase 7 — Referrals & Affiliates Admin
import { adminReferralsRoutes }   from "./modules/admin/referrals/admin.referrals.routes";
import { adminAffiliatesRoutes }  from "./modules/admin/affiliates/admin.affiliates.routes";
// Phase 8 — VIP Admin
import { adminVipRoutes }         from "./modules/admin/vip/admin.vip.routes";
import { maintenanceModeHook }    from "./middleware/maintenanceMode";
// Phase 9 — Notifications, Content, Static Pages, Platform Text
import { adminNotificationsRoutes } from "./modules/admin/notifications/admin.notifications.routes";
import { adminContentRoutes }       from "./modules/admin/content/admin.content.routes";
import { adminPagesRoutes }         from "./modules/admin/pages/admin.pages.routes";
import { adminTextRoutes }          from "./modules/admin/text/admin.text.routes";
import { seedDefaultText }          from "./modules/admin/text/admin.text.service";
import { seedDefaultPages }         from "./modules/admin/pages/admin.pages.service";
// Phase 10 — Analytics & Reports
import { adminAnalyticsRoutes }     from "./modules/admin/analytics/admin.analytics.routes";
// Phase 14 — AI Developer Center: Real Project Scanning
import { adminDeveloperRoutes }     from "./modules/admin/developer/admin.developer.routes";
// Phase 15 — Security & Audit
import { adminSecurityRoutes }      from "./modules/admin/security/admin.security.routes";
// Phase 16 — Football AI Hub
import { footballRoutes }           from "./modules/football/football.routes";
import { adminFootballRoutes }      from "./modules/football/admin.football.routes";
import { adminAiRoutes }            from "./modules/football/admin.ai.routes";
// Phase 20 — Ambassador Program + Monthly Challenge
import { ambassadorsRoutes, adminAmbassadorsRoutes } from "./modules/ambassadors/ambassadors.routes";
import { challengesRoutes, adminChallengesRoutes }   from "./modules/challenges/challenges.routes";
// Phase 21 — Featured Promotion & Platform Announcement System
import { promotionsRoutes }          from "./modules/promotions/promotions.routes";
import { adminPromotionsRoutes }     from "./modules/promotions/admin.promotions.routes";
import { seedDefaultFeaturedPricing, runScheduledPromotions } from "./modules/promotions/promotions.service";
// Phase 23.3 — Currency Management
import { adminCurrencyRoutes }       from "./modules/admin/currency/admin.currency.routes";
import { seedDefaultCurrencies, listEnabledCurrencies, getDefaultCurrency } from "./modules/admin/currency/admin.currency.service";
// Phase 24.2 — Globalisation & Platform Control
import { adminLanguageRoutes }       from "./modules/admin/language/admin.language.routes";
import { seedDefaultLanguages, listEnabledLanguages } from "./modules/admin/language/admin.language.service";
import { adminTranslationRoutes }    from "./modules/admin/translation/admin.translation.routes";
import { seedDefaultTranslationKeys, getTranslationsForLanguage } from "./modules/admin/translation/admin.translation.service";
import { adminFeaturesRoutes }       from "./modules/admin/features/admin.features.routes";
import { getBranding }               from "./modules/admin/branding/admin.branding.service";
// Phase 22 — Auction Marketplace
import { auctionsRoutes }            from "./modules/auctions/auctions.routes";
import { adminAuctionsRoutes }       from "./modules/auctions/admin.auctions.routes";
import { runAuctionScheduler }       from "./modules/auctions/auctions.service";
// Phase 28 — Admin Wallet Management
import { adminWalletsRoutes }        from "./modules/admin/wallets/admin.wallets.routes";
// Jobs
import { startWithdrawalLimitResetJob } from "./jobs/withdrawalLimitReset";
import { startScreenshotRetentionJob }  from "./jobs/screenshotRetention";
import { startAuditLogRetentionJob }    from "./jobs/auditLogRetention";
import { startStreakReminderJob }        from "./jobs/streakReminder";
import { startCryptoDepositMonitor }     from "./jobs/cryptoDepositMonitor";
import { startCommissionJobWorker }      from "./jobs/commissionJob";
import { startAiAnalysisWorker }         from "./jobs/aiAnalysisWorker";
import { startFootballSyncWorker }       from "./jobs/footballSyncWorker";
import { startAutoPublishWorker }        from "./jobs/autoPublishWorker";

// ── Phase 3H: validate production config before accepting any traffic ─────────
validateProductionConfig();

const app = Fastify({
  logger:    { level: config.env === "production" ? "info" : "warn" },
  bodyLimit: 1 * 1024 * 1024,  // 3H: 1 MB max payload
});

async function bootstrap() {
  // ── 3H: Hardened security headers ───────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'", "'unsafe-inline'"],
        imgSrc:     ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        frameSrc:   ["'none'"],
        objectSrc:  ["'none'"],
        upgradeInsecureRequests: config.env === "production" ? [] : null,
      },
    },
    hsts: config.env === "production"
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
    xFrameOptions:       { action: "deny" },
    xContentTypeOptions: true,
    referrerPolicy:      { policy: "strict-origin-when-cross-origin" },
  });

  await app.register(cors, {
    origin:      config.cors.origins,
    credentials: true,
    methods:     ["GET","POST","PATCH","PUT","DELETE","OPTIONS"],
  });

  // ── 3H: Global ceiling — individual route groups have tighter limits ─────────
  await app.register(rateLimit, {
    global:      true,
    max:         200,
    timeWindow:  "1 minute",
    keyGenerator: (req) => `${req.ip}:${(req.headers.authorization ?? "anon").slice(0, 20)}`,
    errorResponseBuilder: () => ({ error: { code: "RATE_LIMITED", message: "Too many requests — please slow down" } }),
  });

  app.get("/health", async () => ({ status: "ok", phase: "3H", env: config.env, timestamp: new Date().toISOString() }));

  // ── 3A — Auth: tightest limit (5/min per IP — brute-force protection) ────────
  app.register(async (scope) => {
    await scope.register(rateLimit, { max: 5, timeWindow: "1 minute", keyGenerator: (r) => r.ip });
    scope.register(authRoutes, { prefix: "/api/v1/auth" });
  });

  // ── 3A — Users / Wallets ──────────────────────────────────────────────────────
  app.register(usersRoutes,   { prefix: "/api/v1/users" });
  app.register(walletsRoutes, { prefix: "/api/v1/wallets" });

  // ── 3B — Financial: 10/min per user ──────────────────────────────────────────
  app.register(async (scope) => {
    await scope.register(rateLimit, { max: 10, timeWindow: "1 minute" });
    scope.register(transactionsRoutes, { prefix: "/api/v1/transactions" });
    scope.register(depositsRoutes,     { prefix: "/api/v1/deposits" });
    scope.register(withdrawalsRoutes,  { prefix: "/api/v1/withdrawals" });
  });

  // ── 3C — KYC ──────────────────────────────────────────────────────────────────
  app.register(kycRoutes, { prefix: "/api/v1/kyc" });

  // ── 3D — Tasks / Proofs ───────────────────────────────────────────────────────
  app.register(tasksRoutes,  { prefix: "/api/v1/tasks" });
  app.register(proofsRoutes, { prefix: "/api/v1/tasks" });

  // ── 3E — VIP / Referrals / Affiliates ────────────────────────────────────────
  app.register(vipRoutes,        { prefix: "/api/v1/vip" });
  app.register(referralsRoutes,  { prefix: "/api/v1/referrals" });
  app.register(affiliatesRoutes, { prefix: "/api/v1/affiliates" });

  // ── 3F — Games: 30/min per user (frequent polling during rounds) ──────────────
  app.register(async (scope) => {
    await scope.register(rateLimit, { max: 30, timeWindow: "1 minute" });
    scope.register(gamesSharedRoutes, { prefix: "/api/v1/games" });
    scope.register(colorGameRoutes,   { prefix: "/api/v1/games/color" });
    scope.register(spinBattleRoutes,  { prefix: "/api/v1/games/spin" });
    scope.register(matchmakingRoutes,  { prefix: "/api/v1/games" });
    scope.register(privateRoomRoutes,  { prefix: "/api/v1/games" });
    scope.register(diceRoyaleRoutes,   { prefix: "/api/v1/games/dice-royale" });
    scope.register(diceArenaRoutes,   { prefix: "/api/v1/games/dice-arena" });
    scope.register(provablyFairRoutes, { prefix: "/api/v1/games/fairness" });
  });

  // ── 3G — Notifications ────────────────────────────────────────────────────────
  app.register(notificationsRoutes, { prefix: "/api/v1/notifications" });

  // ── Phase 16 — Football AI Hub (authenticated users) ─────────────────────────
  app.register(footballRoutes, { prefix: "/api/v1/football" });

  // ── Phase 20 — Ambassador Program (authenticated users) ──────────────────────
  app.register(ambassadorsRoutes, { prefix: "/api/v1/ambassadors" });

  // ── Phase 20 — Monthly Referral Challenge (authenticated users) ───────────────
  app.register(challengesRoutes, { prefix: "/api/v1/challenges" });

  // ── Phase 21 — Featured Promotions & Announcements (authenticated users) ──────
  app.register(promotionsRoutes, { prefix: "/api/v1/promotions" });

  // ── Phase 22 — Auction Marketplace (authenticated users) ─────────────────────
  app.register(auctionsRoutes, { prefix: "/api/v1/auctions" });

  // ── Platform config (authenticated users) ────────────────────────────────────
  app.register(platformRoutes, { prefix: "/api/v1/platform" });

  // ── Public stats (no auth required — landing page) ───────────────────────────
  app.register(publicRoutes, { prefix: "/api/v1/public" });

  // ── Phase 1: maintenance mode hook (global — runs before every route) ─────────
  // Admin users (role != "user") always bypass. Certain paths always allowed.
  app.addHook("onRequest", maintenanceModeHook);

  // ── 3G — Admin: 60/min per user ───────────────────────────────────────────────
  app.register(async (scope) => {
    await scope.register(rateLimit, { max: 60, timeWindow: "1 minute" });
    scope.register(adminKycRoutes,      { prefix: "/api/v1/admin/kyc" });
    scope.register(adminTasksRoutes,    { prefix: "/api/v1/admin/tasks" });
    scope.register(adminProofsRoutes,   { prefix: "/api/v1/admin/proofs" });
    scope.register(adminStatsRoutes,    { prefix: "/api/v1/admin/stats" });
    scope.register(adminUsersRoutes,    { prefix: "/api/v1/admin/users" });
    scope.register(adminDepositsRoutes,     { prefix: "/api/v1/admin/deposits" });
    scope.register(adminWithdrawalsRoutes,  { prefix: "/api/v1/admin/withdrawals" });
    scope.register(adminTransactionsRoutes, { prefix: "/api/v1/admin/transactions" });
    // Phase 1 — system configuration API
    scope.register(adminConfigRoutes,   { prefix: "/api/v1/admin/config" });
    // Phase 5 — game management API
    scope.register(adminGamesRoutes,    { prefix: "/api/v1/admin/games" });
    // Phase 7 — referrals & affiliates admin
    scope.register(adminReferralsRoutes,  { prefix: "/api/v1/admin/referrals" });
    scope.register(adminAffiliatesRoutes, { prefix: "/api/v1/admin/affiliates" });
    // Phase 8 — VIP admin
    scope.register(adminVipRoutes,        { prefix: "/api/v1/admin/vip" });
    // Phase 9 — Notifications, Content, Static Pages, Platform Text
    scope.register(adminNotificationsRoutes, { prefix: "/api/v1/admin/notifications" });
    scope.register(adminContentRoutes,       { prefix: "/api/v1/admin/content" });
    scope.register(adminPagesRoutes,         { prefix: "/api/v1/admin/pages" });
    scope.register(adminTextRoutes,          { prefix: "/api/v1/admin/text" });
    // Phase 10 — Analytics & Reports
    scope.register(adminAnalyticsRoutes,     { prefix: "/api/v1/admin/analytics" });
    // Phase 14 — AI Developer Center: Real Project Scanning
    scope.register(adminDeveloperRoutes,     { prefix: "/api/v1/admin/developer" });
    // Phase 15 — Security & Audit
    scope.register(adminSecurityRoutes,      { prefix: "/api/v1/admin/security" });
    // Phase 16 — Football AI Hub Admin
    scope.register(adminFootballRoutes,      { prefix: "/api/v1/admin/football" });
    // Phase 17.1 — AI Intelligence Foundation
    scope.register(adminAiRoutes,            { prefix: "/api/v1/admin/ai" });
    // Phase 20 — Ambassador Program Admin
    scope.register(adminAmbassadorsRoutes,   { prefix: "/api/v1/admin/ambassadors" });
    // Phase 20 — Monthly Challenge Admin
    scope.register(adminChallengesRoutes,    { prefix: "/api/v1/admin/challenges" });
    // Phase 21 — Featured Promotion Admin
    scope.register(adminPromotionsRoutes,    { prefix: "/api/v1/admin/promotions" });
    // Phase 22 — Auction Marketplace Admin
    scope.register(adminAuctionsRoutes,      { prefix: "/api/v1/admin/auctions" });
    // Phase 28 — Admin Wallet Management
    scope.register(adminWalletsRoutes,       { prefix: "/api/v1/admin/wallets" });
    // Phase 23.3 — Currency Management Admin
    scope.register(adminCurrencyRoutes,      { prefix: "/api/v1/admin/currency" });
    // Phase 24.2 — Language & Translation Management Admin
    scope.register(adminLanguageRoutes,      { prefix: "/api/v1/admin/language" });
    scope.register(adminTranslationRoutes,   { prefix: "/api/v1/admin/translation" });
    // Phase 24.2 — Feature Management Admin
    scope.register(adminFeaturesRoutes,      { prefix: "/api/v1/admin/features" });
  });

  // ── Phase 24.2 — Public globalisation endpoints (no auth required) ───────────
  app.get("/api/v1/languages", async (_req, reply) => {
    return reply.send({ data: await listEnabledLanguages() });
  });
  app.get("/api/v1/translations/:code", async (req, reply) => {
    const { code } = req.params as { code: string };
    const bundle = await getTranslationsForLanguage(code);
    return reply.send({ data: bundle });
  });
  app.get("/api/v1/platform/branding", async (_req, reply) => {
    return reply.send({ data: await getBranding() });
  });

  // Public currency endpoints (no auth required — used by SettingsContext)
  // /default MUST be registered before the bare /currencies route so Fastify
  // does not match "default" as a dynamic segment of the parent route.
  app.get("/api/v1/currencies/default", async (_req, reply) => {
    return reply.send({ data: await getDefaultCurrency() });
  });
  app.get("/api/v1/currencies", async (_req, reply) => {
    return reply.send({ data: await listEnabledCurrencies() });
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({ error: { code: "NOT_FOUND", message: `${req.method} ${req.url} not found` } })
  );

  // ── Phase 1: seed default platform configuration (idempotent, never overwrites) ─
  await seedDefaultConfig();
  // ── Phase 23.3: seed default currencies (idempotent — skips if table is populated) ─
  await seedDefaultCurrencies();
  await seedDefaultRooms();
  // ── Phase 21: seed featured placement pricing (idempotent — skips existing rows) ─
  await seedDefaultFeaturedPricing();
  // ── Phase 9: seed text defaults and static pages ─────────────────────────────
  await seedDefaultText();
  await seedDefaultPages();
  // ── Phase 24.2: seed languages and translation keys ──────────────────────────
  await seedDefaultLanguages();
  await seedDefaultTranslationKeys();

  // ── system.debug_mode: elevate log level when enabled in SystemConfig ────────
  const debugMode = await getConfigValue<boolean>("system.debug_mode", false);
  if (debugMode) app.log.level = "debug";

  // ── Background jobs ──────────────────────────────────────────────────────────
  startWithdrawalLimitResetJob();
  startScreenshotRetentionJob();
  startAuditLogRetentionJob();
  startStreakReminderJob();
  await startColorGameLobbies();
  await startSpinBattleLobbies();
  startQueueCleanup();
  setInterval(() => cleanupExpiredRooms(), 60_000); // clean up expired private rooms
  startCryptoDepositMonitor();
  startCommissionJobWorker();
  startAiAnalysisWorker();
  startFootballSyncWorker();
  startAutoPublishWorker();
  // Phase 21 — promotion scheduler: auto-activate/expire scheduled promotions
  setInterval(() => { runScheduledPromotions().catch(() => {}); }, 60_000);
  // Phase 22 — auction scheduler: auto-launch upcoming + auto-end expired auctions
  setInterval(() => { runAuctionScheduler().catch(() => {}); }, 30_000);

  await app.listen({ port: config.port, host: config.host });
  console.log(`Bitzimi backend (Phase 3H) — ${config.host}:${config.port}`);

  // ── Graceful shutdown (Phase 3H) ─────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`[Shutdown] ${signal} received — closing server gracefully`);
    await app.close();
    console.log("[Shutdown] Server closed. Exiting.");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM")); // Docker / K8s stop signal
  process.on("SIGINT",  () => shutdown("SIGINT"));  // Ctrl+C in development
}

bootstrap().catch(err => { console.error("Startup failed:", err); process.exit(1); });
