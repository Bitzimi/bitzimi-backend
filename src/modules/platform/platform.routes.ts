/**
 * Platform configuration endpoint.
 *
 * GET /api/v1/platform/config — authenticated users only.
 *
 * Returns ONLY what the frontend needs to know about platform capabilities:
 *   - cryptoDepositsAvailable: whether the deposit address is configured
 *   - bankDepositsEnabled: controlled by BANK_DEPOSITS_ENABLED env var
 *   - bankWithdrawalsEnabled: controlled by BANK_WITHDRAWALS_ENABLED env var
 *   - cryptoNetwork: the configured network name (BEP20, etc.)
 *   - minimumCryptoDeposit: minimum deposit in USD
 *
 * Never exposes: RPC endpoints, private keys, wallet addresses, provider credentials.
 * The deposit wallet address is served through GET /api/v1/deposits/crypto-info only.
 */
import { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/authenticate";
import { config } from "../../config";
import { db } from "../../db";
import { listConfig, getFeatureAccessLevel, canAccessFeature, getConfigValue, type FeatureAccessLevel } from "../admin/config/admin.config.service";
import { getNGNToUSDRate } from "../admin/currency/admin.currency.service";

export async function platformRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/platform/config
  // Returns ONLY what the frontend needs — never exposes secrets, private keys, or RPC endpoints.
  app.get("/config", async (_req, reply) => {
    const bankConfigured = !!(
      config.banking.receivingBankName &&
      config.banking.receivingBankAccountName &&
      config.banking.receivingBankAccountNumber
    );

    // Feature flags layer on top of environment configuration.
    // Both the env var AND the SystemConfig feature flag must permit the feature.
    const [flagBankDeposits, flagBankWithdrawals, flagCryptoDeposits, flagCryptoWithdrawals] = await Promise.all([
      getConfigValue<boolean>("feature.bank_deposits",      false),
      getConfigValue<boolean>("feature.bank_withdrawals",   false),
      getConfigValue<boolean>("feature.crypto_deposits",    true),
      getConfigValue<boolean>("feature.crypto_withdrawals", true),
    ]);

    const bankDepositsEnabled    = config.banking.bankDepositsEnabled    && bankConfigured && flagBankDeposits;
    const bankWithdrawalsEnabled = config.banking.bankWithdrawalsEnabled && flagBankWithdrawals;
    const cryptoDepositsAvailable = !!config.crypto.depositAddress       && flagCryptoDeposits;
    const cryptoWithdrawalsEnabled = flagCryptoWithdrawals;

    return reply.send({
      data: {
        // ── Crypto ─────────────────────────────────────────────────────────────
        // minimumCryptoDeposit comes from SystemConfig (deposit.crypto_minimum_usd),
        // falling back to env var CRYPTO_MIN_DEPOSIT. Admin changes take effect immediately.
        cryptoDepositsAvailable,
        cryptoWithdrawalsEnabled,
        cryptoNetwork:            config.crypto.network,
        minimumCryptoDeposit:     await getConfigValue<number>("deposit.crypto_minimum_usd", config.crypto.minimumDeposit),
        confirmationsRequired:    config.crypto.confirmationsRequired,

        // ── Banking ────────────────────────────────────────────────────────────
        // Both the feature flag AND actual env/bank details must be configured
        bankDepositsEnabled,
        bankWithdrawalsEnabled,
        bankingProviderActive:    !!config.banking.provider && (
          (config.banking.provider === "paystack" && !!config.banking.paystackSecretKey) ||
          (config.banking.provider === "flutterwave" && !!config.banking.flutterwaveSecretKey)
        ),

        // ── Bank receiving account (only included when banking deposits are enabled) ────
        // ngnToUsdRate comes from Currency Management (admin-managed), not config.ts
        bankReceivingAccount: bankDepositsEnabled ? {
          bankName:      config.banking.receivingBankName,
          accountName:   config.banking.receivingBankAccountName,
          accountNumber: config.banking.receivingBankAccountNumber,
          ngnToUsdRate:  await getNGNToUSDRate(),
          minimumNGN:    await getConfigValue<number>("deposit.bank_minimum_ngn", config.banking.minimumBankDepositNGN),
        } : null,
      },
    });
  });

  // GET /api/v1/platform/features
  // Returns which features the authenticated user can access, based on:
  //   1. The feature's configured access level (SystemConfig: feature.access.*)
  //   2. The user's role and VIP subscription status
  //
  // Response: { featureName: boolean } — true means accessible, false means gated.
  // Backend is authoritative; frontend MUST NOT grant access beyond what this returns.
  app.get("/features", async (req, reply) => {
    const userId = req.user.sub;
    const role   = req.user.role;

    // Check VIP status (active subscription required)
    const now = new Date();
    const sub = await db.subscription.findUnique({
      where:  { userId },
      select: { isActive: true, endsAt: true },
    });
    const isVip = !!(sub?.isActive && sub.endsAt > now);

    // Read all feature.access.* keys from SystemConfig
    const allConfig = await listConfig();
    const accessEntries = allConfig.filter(c => c.key.startsWith("feature.access."));

    const features: Record<string, boolean> = {};
    for (const entry of accessEntries) {
      const featureName = entry.key.replace("feature.access.", "");
      const level = (entry.value as FeatureAccessLevel) ?? "all";
      features[featureName] = canAccessFeature(level, role, isVip);
    }

    // Also include the boolean feature flags so the frontend has one unified endpoint
    const boolFlags = allConfig.filter(c =>
      c.key.startsWith("feature.") && !c.key.startsWith("feature.access.")
    );
    const flags: Record<string, boolean> = {};
    for (const entry of boolFlags) {
      const flagName = entry.key.replace("feature.", "");
      flags[flagName] = !!entry.value;
    }

    return reply.send({ data: { access: features, flags } });
  });

  // GET /api/v1/platform/text
  // Returns all platform text as a flat { key: value } map.
  // Authenticated — text may contain user-personalised hints.
  app.get("/text", async (_req, reply) => {
    const rows = await db.systemConfig.findMany({
      where: { key: { startsWith: "text." } },
      select: { key: true, value: true },
    });
    const text: Record<string, string> = {};
    for (const r of rows) {
      try {
        const parsed = JSON.parse(r.value);
        text[r.key] = typeof parsed === "string" ? parsed : r.value;
      } catch {
        text[r.key] = r.value;
      }
    }
    return reply.send({ data: { text } });
  });
}
