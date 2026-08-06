// Validate PORT at module load time — fail fast rather than silently binding to NaN
const _rawPort = parseInt(process.env.PORT ?? "3001", 10);
if (isNaN(_rawPort) || _rawPort < 1 || _rawPort > 65535) {
  throw new Error(`Invalid PORT: "${process.env.PORT}" — must be an integer between 1 and 65535`);
}

export const config = {
  env: (process.env.NODE_ENV ?? "development") as "development" | "production" | "test",
  port: _rawPort,
  host: process.env.HOST ?? "0.0.0.0",
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? "dev_access_secret",
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? "dev_refresh_secret",
    accessExpiresIn: "15m" as const,
    refreshExpiresIn: "7d" as const,
    refreshExpiresInSecs: 7 * 24 * 60 * 60,
  },
  bcrypt: { passwordRounds: 12, pinRounds: 10 },
  cors: { origins: (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(",") },
  withdrawalLimits: {
    free:     { daily: 100,    monthly: 1_000   },
    verified: { daily: 1_000,  monthly: 10_000  },
    vip:      { daily: 10_000, monthly: 100_000 },
  } as const,

  // ── Crypto deposit configuration ─────────────────────────────────────────────
  // Set CRYPTO_DEPOSIT_ADDRESS, ANKR_BSC_RPC_ENDPOINT, CRYPTO_NETWORK in .env
  // Frontend NEVER receives the RPC endpoint; it only receives the deposit address
  // through an authenticated API response.
  crypto: {
    depositAddress:         process.env.CRYPTO_DEPOSIT_ADDRESS ?? "",
    network:                process.env.CRYPTO_NETWORK ?? "BEP20",
    ankrRpcEndpoint:        process.env.ANKR_BSC_RPC_ENDPOINT ?? "",
    usdtContractAddress:    process.env.USDT_CONTRACT_ADDRESS ?? "0x55d398326f99059ff775485246999027b3197955",
    confirmationsRequired:  parseInt(process.env.CRYPTO_CONFIRMATIONS ?? "3", 10),
    minimumDeposit:         parseFloat(process.env.CRYPTO_MIN_DEPOSIT ?? "5"),
    monitorEnabled:         process.env.CRYPTO_MONITOR_ENABLED === "true",
  },

  // ── Withdrawal signing (future implementation) ────────────────────────────────
  // Set WITHDRAWAL_PRIVATE_KEY and WITHDRAWAL_WALLET_ADDRESS in .env when ready.
  // Backend is structured so setting these env vars activates on-chain withdrawals
  // without any frontend or service-layer code changes.
  withdrawalSigning: {
    privateKey:     process.env.WITHDRAWAL_PRIVATE_KEY ?? "",
    walletAddress:  process.env.WITHDRAWAL_WALLET_ADDRESS ?? "",
    enabled:        !!(process.env.WITHDRAWAL_PRIVATE_KEY && process.env.WITHDRAWAL_WALLET_ADDRESS),
  },

  // ── Banking / payment provider (future) ──────────────────────────────────────
  // Set PAYMENT_PROVIDER=paystack or flutterwave and the corresponding keys.
  // Admin panel can toggle bankDepositsEnabled / bankWithdrawalsEnabled independently.
  banking: {
    provider:                   (process.env.PAYMENT_PROVIDER ?? "") as "" | "paystack" | "flutterwave",
    paystackSecretKey:          process.env.PAYSTACK_SECRET_KEY ?? "",
    paystackPublicKey:          process.env.PAYSTACK_PUBLIC_KEY ?? "",
    flutterwaveSecretKey:       process.env.FLUTTERWAVE_SECRET_KEY ?? "",
    flutterwavePublicKey:       process.env.FLUTTERWAVE_PUBLIC_KEY ?? "",
    webhookSecret:              process.env.WEBHOOK_SECRET ?? "",
    bankDepositsEnabled:        process.env.BANK_DEPOSITS_ENABLED === "true",
    bankWithdrawalsEnabled:     process.env.BANK_WITHDRAWALS_ENABLED === "true",

    // ── Receiving bank account (served to frontend through authenticated API only) ──
    // These are the platform's deposit-receiving bank account details for NGN transfers.
    // Treated identically to CRYPTO_DEPOSIT_ADDRESS — never hardcode in frontend.
    receivingBankName:          process.env.BANK_RECEIVING_NAME ?? "",
    receivingBankAccountName:   process.env.BANK_RECEIVING_ACCOUNT_NAME ?? "",
    receivingBankAccountNumber: process.env.BANK_RECEIVING_ACCOUNT_NUMBER ?? "",
    minimumBankDepositNGN:      parseFloat(process.env.BANK_MIN_DEPOSIT_NGN ?? "5000"),
  },

  // ── Withdrawal fees (fixed, not percentage) ────────────────────────────────────
  // Bank fee: ₦1,500 NGN — converted to USD at runtime via Currency Management (admin-managed rate).
  // Crypto fee: $1 USD flat.
  withdrawalFees: {
    bankNGN:   parseFloat(process.env.BANK_WITHDRAWAL_FEE_NGN  ?? "1500"),
    cryptoUSD: parseFloat(process.env.CRYPTO_WITHDRAWAL_FEE_USD ?? "1"),
  },

  // ── Withdrawal minimums ────────────────────────────────────────────────────────
  // Both methods enforce a $7 USD floor (gross amount requested, before fee).
  withdrawalMinimumUSD: parseFloat(process.env.WITHDRAWAL_MIN_USD ?? "7"),

  // platformFeeRate removed — PLATFORM_FEE_RATE = 0.10 is the authoritative source in games/settlement.ts
  // vipPrice removed — read at runtime from SystemConfig key "platform.vip_price_usd" (vip.service.ts)

  // ── Email / SMTP ─────────────────────────────────────────────────────────────
  // When EMAIL_HOST is unset the email service falls back to console output.
  email: {
    host:        process.env.EMAIL_HOST ?? "",
    port:        parseInt(process.env.EMAIL_PORT ?? "587", 10),
    secure:      process.env.EMAIL_SECURE === "true",
    user:        process.env.EMAIL_USER ?? "",
    pass:        process.env.EMAIL_PASS ?? "",
    from:        process.env.EMAIL_FROM ?? "BitZimi <noreply@bitzimi.com>",
    frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
  },
};
