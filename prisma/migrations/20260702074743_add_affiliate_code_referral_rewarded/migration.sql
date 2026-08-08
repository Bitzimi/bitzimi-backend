-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "referral_code" TEXT NOT NULL,
    "affiliate_code" TEXT NOT NULL,
    "upline_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "suspended_at" DATETIME,
    "suspended_by" TEXT,
    CONSTRAINT "users_upline_id_fkey" FOREIGN KEY ("upline_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "full_name" TEXT,
    "avatar_url" TEXT,
    "phone_number" TEXT,
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "language_pref" TEXT NOT NULL DEFAULT 'en',
    "currency_pref" TEXT NOT NULL DEFAULT 'USD',
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" DATETIME,
    CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "security_pins" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "pin_hash" TEXT NOT NULL,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "security_pins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "kyc_submissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unverified',
    "country_code" TEXT,
    "id_type" TEXT,
    "full_name" TEXT,
    "date_of_birth" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "postal_code" TEXT,
    "front_doc_key" TEXT,
    "back_doc_key" TEXT,
    "selfie_key" TEXT,
    "poa_key" TEXT,
    "face_confidence" REAL,
    "address_match" BOOLEAN,
    "reviewed_by" TEXT,
    "reviewed_at" DATETIME,
    "rejection_reason" TEXT,
    "submitted_at" DATETIME,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "kyc_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "plan" TEXT NOT NULL DEFAULT 'monthly',
    "price" REAL NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" DATETIME NOT NULL,
    "cancelled_at" DATETIME,
    "payment_ref" TEXT,
    CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "vip_streaks" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "current_streak" INTEGER NOT NULL DEFAULT 0,
    "last_claim_date" DATETIME,
    "total_earned" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "vip_streaks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "withdrawal_limits" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "daily_used" REAL NOT NULL DEFAULT 0,
    "monthly_used" REAL NOT NULL DEFAULT 0,
    "last_daily_reset" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_monthly_reset" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "withdrawal_limits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "wallet_type" TEXT NOT NULL,
    "balance" REAL NOT NULL DEFAULT 0,
    "locked_amount" REAL NOT NULL DEFAULT 0,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "from_wallet" TEXT,
    "to_wallet" TEXT,
    "amount" REAL NOT NULL,
    "fee" REAL NOT NULL DEFAULT 0,
    "net_amount" REAL NOT NULL,
    "reference_id" TEXT,
    "reference_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "description" TEXT,
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "deposits" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "requested_amount" REAL NOT NULL,
    "memo_amount" REAL NOT NULL,
    "payment_method" TEXT NOT NULL,
    "payment_address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tx_hash" TEXT,
    "confirmed_by" TEXT,
    "expires_at" DATETIME NOT NULL,
    "confirmed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deposits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "fee" REAL NOT NULL,
    "net_amount" REAL NOT NULL,
    "destination" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "pin_verified" BOOLEAN NOT NULL DEFAULT false,
    "processed_by" TEXT,
    "rejection_reason" TEXT,
    "tx_hash" TEXT,
    "submitted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" DATETIME,
    CONSTRAINT "withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "advertiser_id" TEXT NOT NULL,
    "advertiser_name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "total_budget" REAL NOT NULL,
    "total_reward" REAL NOT NULL,
    "reward_per_slot" REAL NOT NULL,
    "total_slots" INTEGER NOT NULL,
    "completed_slots" INTEGER NOT NULL DEFAULT 0,
    "link" TEXT,
    "campaign_image_url" TEXT,
    "requirements" TEXT NOT NULL DEFAULT '[]',
    "proof_type" TEXT,
    "proof_instructions" TEXT,
    "expires_at" DATETIME,
    "approved_by" TEXT,
    "approved_at" DATETIME,
    "rejected_by" TEXT,
    "rejected_at" DATETIME,
    "rejection_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "tasks_advertiser_id_fkey" FOREIGN KEY ("advertiser_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task_reference_screenshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "slot" INTEGER NOT NULL DEFAULT 0,
    "uploaded_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_reference_screenshots_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task_proofs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_ai',
    "ai_confidence" REAL,
    "ai_analysis" TEXT,
    "ai_verdict" TEXT,
    "reward_paid" BOOLEAN NOT NULL DEFAULT false,
    "reward_amount" REAL,
    "processed_at" DATETIME,
    "submitted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_proofs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "task_proofs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task_proof_screenshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proof_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "slot" INTEGER NOT NULL DEFAULT 0,
    "uploaded_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_proof_screenshots_proof_id_fkey" FOREIGN KEY ("proof_id") REFERENCES "task_proofs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "admin_proof_reviews" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proof_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ai_confidence" REAL,
    "ai_analysis" TEXT,
    "decision" TEXT,
    "decision_note" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_proof_reviews_proof_id_fkey" FOREIGN KEY ("proof_id") REFERENCES "task_proofs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "referrer_id" TEXT NOT NULL,
    "referred_id" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "activated_at" DATETIME,
    "referral_rewarded" BOOLEAN NOT NULL DEFAULT false,
    "rewarded_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "referrals_referred_id_fkey" FOREIGN KEY ("referred_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "affiliate_commissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "beneficiary_id" TEXT NOT NULL,
    "source_user_id" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_ref_id" TEXT,
    "gross_amount" REAL NOT NULL,
    "rate" REAL NOT NULL,
    "commission" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'paid',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "affiliate_commissions_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "game_rounds" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "game_type" TEXT NOT NULL,
    "lobby_id" TEXT,
    "round_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "result_data" TEXT,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" DATETIME
);

-- CreateTable
CREATE TABLE "game_bets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "round_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "bet_data" TEXT NOT NULL,
    "outcome" TEXT,
    "payout" REAL,
    "platform_fee" REAL,
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "placed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" DATETIME,
    CONSTRAINT "game_bets_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "game_rounds" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "game_bets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "game_stats" (
    "user_id" TEXT NOT NULL,
    "game_type" TEXT NOT NULL,
    "total_games" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "total_wagered" REAL NOT NULL DEFAULT 0,
    "total_won" REAL NOT NULL DEFAULT 0,
    "updated_at" DATETIME NOT NULL,

    PRIMARY KEY ("user_id", "game_type"),
    CONSTRAINT "game_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "matchmaking_queues" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "game_type" TEXT NOT NULL,
    "stake" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "match_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME NOT NULL,
    CONSTRAINT "matchmaking_queues_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "matchmaking_queues_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "pvp_matches" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pvp_matches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "game_type" TEXT NOT NULL,
    "stake" REAL NOT NULL,
    "player1_id" TEXT NOT NULL,
    "player2_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "winner_id" TEXT,
    "result_data" TEXT,
    "signal_sent_at" DATETIME,
    "player1_tap_ms" INTEGER,
    "player2_tap_ms" INTEGER,
    "player1_ready" BOOLEAN NOT NULL DEFAULT false,
    "player2_ready" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" DATETIME,
    CONSTRAINT "pvp_matches_player1_id_fkey" FOREIGN KEY ("player1_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pvp_matches_player2_id_fkey" FOREIGN KEY ("player2_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "dice_rounds" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "game_type" TEXT NOT NULL,
    "stake" REAL NOT NULL,
    "round_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "max_players" INTEGER NOT NULL,
    "min_players_to_start" INTEGER NOT NULL,
    "player_ids" TEXT NOT NULL DEFAULT '[]',
    "result_data" TEXT,
    "countdown_started_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" DATETIME
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "ip_address" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- CreateIndex
CREATE UNIQUE INDEX "users_affiliate_code_key" ON "users"("affiliate_code");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_username_key" ON "user_profiles"("username");

-- CreateIndex
CREATE INDEX "auth_tokens_user_id_idx" ON "auth_tokens"("user_id");

-- CreateIndex
CREATE INDEX "auth_tokens_token_hash_idx" ON "auth_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_submissions_user_id_key" ON "kyc_submissions"("user_id");

-- CreateIndex
CREATE INDEX "wallets_user_id_idx" ON "wallets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_wallet_type_key" ON "wallets"("user_id", "wallet_type");

-- CreateIndex
CREATE INDEX "transactions_user_id_idx" ON "transactions"("user_id");

-- CreateIndex
CREATE INDEX "deposits_user_id_idx" ON "deposits"("user_id");

-- CreateIndex
CREATE INDEX "withdrawals_user_id_idx" ON "withdrawals"("user_id");

-- CreateIndex
CREATE INDEX "tasks_status_created_at_idx" ON "tasks"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "tasks_advertiser_id_idx" ON "tasks"("advertiser_id");

-- CreateIndex
CREATE INDEX "task_proofs_status_idx" ON "task_proofs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "task_proofs_task_id_user_id_key" ON "task_proofs"("task_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_proof_reviews_proof_id_key" ON "admin_proof_reviews"("proof_id");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referred_id_key" ON "referrals"("referred_id");

-- CreateIndex
CREATE INDEX "referrals_referrer_id_idx" ON "referrals"("referrer_id");

-- CreateIndex
CREATE INDEX "affiliate_commissions_beneficiary_id_idx" ON "affiliate_commissions"("beneficiary_id");

-- CreateIndex
CREATE INDEX "affiliate_commissions_source_user_id_idx" ON "affiliate_commissions"("source_user_id");

-- CreateIndex
CREATE INDEX "game_rounds_game_type_lobby_id_status_idx" ON "game_rounds"("game_type", "lobby_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "game_rounds_game_type_lobby_id_round_number_key" ON "game_rounds"("game_type", "lobby_id", "round_number");

-- CreateIndex
CREATE INDEX "game_bets_round_id_idx" ON "game_bets"("round_id");

-- CreateIndex
CREATE INDEX "game_bets_user_id_idx" ON "game_bets"("user_id");

-- CreateIndex
CREATE INDEX "matchmaking_queues_game_type_stake_status_idx" ON "matchmaking_queues"("game_type", "stake", "status");

-- CreateIndex
CREATE INDEX "dice_rounds_game_type_stake_status_idx" ON "dice_rounds"("game_type", "stake", "status");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_idx" ON "notifications"("user_id", "read");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log"("actor_id");
