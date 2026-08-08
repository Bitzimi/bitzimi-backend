-- Bitzimi — Initial PostgreSQL Schema
-- Generated from schema.prisma (provider: postgresql)
-- All monetary Float fields use DOUBLE PRECISION (application-level precision responsibility).
-- JSON data is stored as TEXT (matches Prisma String → TEXT mapping).
-- Autoincrement uses SERIAL (Prisma default for PostgreSQL).

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "referral_code" TEXT NOT NULL,
    "affiliate_code" TEXT NOT NULL,
    "upline_id" TEXT,
    "program_level" TEXT NOT NULL DEFAULT 'referral',
    "ambassador_code" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "suspended_at" TIMESTAMP(3),
    "suspended_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "user_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "full_name" TEXT,
    "avatar_url" TEXT,
    "phone_number" TEXT,
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "language_pref" TEXT NOT NULL DEFAULT 'en',
    "currency_pref" TEXT NOT NULL DEFAULT 'USD',
    "theme_pref" TEXT NOT NULL DEFAULT 'dark',
    "usdt_address" TEXT,
    "bank_account_name" TEXT,
    "bank_account_number" TEXT,
    "bank_name" TEXT,
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "two_factor_secret" TEXT,
    "address_street" TEXT,
    "address_city" TEXT,
    "address_state" TEXT,
    "address_country" TEXT,
    "address_postal_code" TEXT,
    "address_locked_by_verification" BOOLEAN NOT NULL DEFAULT false,
    "last_username_edit" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "last_seen_at" TIMESTAMP(3),

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_pins" (
    "user_id" TEXT NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_pins_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "kyc_submissions" (
    "id" TEXT NOT NULL,
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
    "face_confidence" DOUBLE PRECISION,
    "address_match" BOOLEAN,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "submitted_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "user_id" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'monthly',
    "price" DOUBLE PRECISION NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "payment_ref" TEXT,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "vip_streaks" (
    "user_id" TEXT NOT NULL,
    "current_streak" INTEGER NOT NULL DEFAULT 0,
    "last_claim_date" TIMESTAMP(3),
    "total_earned" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "vip_streaks_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "withdrawal_limits" (
    "user_id" TEXT NOT NULL,
    "daily_used" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthly_used" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "last_daily_reset" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_monthly_reset" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawal_limits_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_type" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "locked_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "is_frozen" BOOLEAN NOT NULL DEFAULT false,
    "frozen_at" TIMESTAMP(3),
    "frozen_by" TEXT,
    "frozen_reason" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "from_wallet" TEXT,
    "to_wallet" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "net_amount" DOUBLE PRECISION NOT NULL,
    "reference_id" TEXT,
    "reference_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "description" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "requested_amount" DOUBLE PRECISION NOT NULL,
    "memo_amount" DOUBLE PRECISION NOT NULL,
    "payment_method" TEXT NOT NULL,
    "payment_address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tx_hash" TEXT,
    "confirmed_by" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "fee" DOUBLE PRECISION NOT NULL,
    "net_amount" DOUBLE PRECISION NOT NULL,
    "destination" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "pin_verified" BOOLEAN NOT NULL DEFAULT false,
    "processed_by" TEXT,
    "rejection_reason" TEXT,
    "tx_hash" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "advertiser_id" TEXT NOT NULL,
    "advertiser_name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "total_budget" DOUBLE PRECISION NOT NULL,
    "total_reward" DOUBLE PRECISION NOT NULL,
    "reward_per_slot" DOUBLE PRECISION NOT NULL,
    "total_slots" INTEGER NOT NULL,
    "completed_slots" INTEGER NOT NULL DEFAULT 0,
    "link" TEXT,
    "campaign_image_url" TEXT,
    "requirements" TEXT NOT NULL DEFAULT '[]',
    "proof_type" TEXT,
    "proof_instructions" TEXT,
    "expires_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_reference_screenshots" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "slot" INTEGER NOT NULL DEFAULT 0,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_reference_screenshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_proofs" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_ai',
    "ai_confidence" DOUBLE PRECISION,
    "ai_analysis" TEXT,
    "ai_verdict" TEXT,
    "reward_paid" BOOLEAN NOT NULL DEFAULT false,
    "reward_amount" DOUBLE PRECISION,
    "processed_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_proof_screenshots" (
    "id" TEXT NOT NULL,
    "proof_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "slot" INTEGER NOT NULL DEFAULT 0,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_proof_screenshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_proof_reviews" (
    "id" TEXT NOT NULL,
    "proof_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ai_confidence" DOUBLE PRECISION,
    "ai_analysis" TEXT,
    "decision" TEXT,
    "decision_note" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_proof_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "referrer_id" TEXT NOT NULL,
    "referred_id" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "activated_at" TIMESTAMP(3),
    "referral_rewarded" BOOLEAN NOT NULL DEFAULT false,
    "rewarded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_commissions" (
    "id" TEXT NOT NULL,
    "beneficiary_id" TEXT NOT NULL,
    "source_user_id" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_ref_id" TEXT,
    "gross_amount" DOUBLE PRECISION NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "commission" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'paid',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_applications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "full_name" TEXT NOT NULL,
    "social_platform" TEXT NOT NULL,
    "social_link" TEXT NOT NULL,
    "social_username" TEXT NOT NULL,
    "total_members" INTEGER NOT NULL,
    "screenshot_key" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_jobs" (
    "id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "commission_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_rounds" (
    "id" TEXT NOT NULL,
    "game_type" TEXT NOT NULL,
    "lobby_id" TEXT,
    "round_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "result_data" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),
    "server_seed" TEXT,
    "server_seed_hash" TEXT,
    "client_seed" TEXT,
    "nonce" INTEGER,
    "daily_round_number" INTEGER,
    "verification_id" TEXT,

    CONSTRAINT "game_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_bets" (
    "id" TEXT NOT NULL,
    "round_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "bet_data" TEXT NOT NULL,
    "outcome" TEXT,
    "payout" DOUBLE PRECISION,
    "platform_fee" DOUBLE PRECISION,
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "game_bets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_stats" (
    "user_id" TEXT NOT NULL,
    "game_type" TEXT NOT NULL,
    "total_games" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "total_wagered" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_won" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_stats_pkey" PRIMARY KEY ("user_id","game_type")
);

-- CreateTable
CREATE TABLE "matchmaking_queues" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "game_type" TEXT NOT NULL,
    "stake" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "match_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matchmaking_queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pvp_matches" (
    "id" TEXT NOT NULL,
    "game_type" TEXT NOT NULL,
    "stake" DOUBLE PRECISION NOT NULL,
    "player1_id" TEXT NOT NULL,
    "player2_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "winner_id" TEXT,
    "result_data" TEXT,
    "signal_sent_at" TIMESTAMP(3),
    "player1_tap_ms" INTEGER,
    "player2_tap_ms" INTEGER,
    "player1_ready" BOOLEAN NOT NULL DEFAULT false,
    "player2_ready" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),
    "server_seed" TEXT,
    "server_seed_hash" TEXT,
    "client_seed" TEXT,
    "nonce" INTEGER,
    "verification_id" TEXT,

    CONSTRAINT "pvp_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "private_rooms" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "game_type" TEXT NOT NULL,
    "stake" DOUBLE PRECISION NOT NULL,
    "host_id" TEXT NOT NULL,
    "guest_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "current_match_id" TEXT,
    "rematch_host_ready" BOOLEAN NOT NULL DEFAULT false,
    "rematch_guest_ready" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "private_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dice_rounds" (
    "id" TEXT NOT NULL,
    "game_type" TEXT NOT NULL,
    "stake" DOUBLE PRECISION NOT NULL,
    "round_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "max_players" INTEGER NOT NULL,
    "min_players_to_start" INTEGER NOT NULL,
    "player_ids" TEXT NOT NULL DEFAULT '[]',
    "result_data" TEXT,
    "countdown_started_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),
    "server_seed" TEXT,
    "server_seed_hash" TEXT,
    "client_seed" TEXT,
    "nonce" INTEGER,
    "verification_id" TEXT,

    CONSTRAINT "dice_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "email" TEXT NOT NULL,
    "fail_count" INTEGER NOT NULL DEFAULT 0,
    "window_start" TIMESTAMP(3) NOT NULL,
    "locked_until" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" TEXT,
    "previous_value" TEXT,
    "new_value" TEXT,
    "http_status" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "actor_id" TEXT,
    "target_id" TEXT,
    "target_type" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "description" TEXT NOT NULL,
    "metadata" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_history" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "email" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "device_type" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "failure_reason" TEXT,
    "session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ip_blocks" (
    "id" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ip_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_alerts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "severity" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fraud_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_posts" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "excerpt" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "static_pages" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "static_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "football_leagues" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "logo_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "external_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "football_leagues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "football_matches" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "home_team" TEXT NOT NULL,
    "away_team" TEXT NOT NULL,
    "kickoff_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "venue" TEXT,
    "home_score" INTEGER,
    "away_score" INTEGER,
    "external_id" TEXT,
    "synced_from" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "football_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "football_predictions" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "prediction" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "risk_level" TEXT NOT NULL DEFAULT 'medium',
    "is_vip" BOOLEAN NOT NULL DEFAULT false,
    "analysis" TEXT,
    "reasoning" TEXT,
    "published_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "football_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prediction_results" (
    "id" TEXT NOT NULL,
    "prediction_id" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL,
    "settled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_by" TEXT NOT NULL,

    CONSTRAINT "prediction_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_prediction_views" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "prediction_id" TEXT NOT NULL,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_prediction_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_engine_configs" (
    "id" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "model_version" TEXT NOT NULL DEFAULT '1.0.0',
    "feature_weights" TEXT NOT NULL DEFAULT '{}',
    "min_confidence" INTEGER NOT NULL DEFAULT 60,
    "high_confidence" INTEGER NOT NULL DEFAULT 80,
    "max_queue_size" INTEGER NOT NULL DEFAULT 100,
    "analysis_timeout_ms" INTEGER NOT NULL DEFAULT 30000,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "ai_engine_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_engine_status" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "health" TEXT NOT NULL DEFAULT 'unknown',
    "last_run_at" TIMESTAMP(3),
    "last_error_at" TIMESTAMP(3),
    "last_error" TEXT,
    "analysis_count" INTEGER NOT NULL DEFAULT 0,
    "queue_depth" INTEGER NOT NULL DEFAULT 0,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_engine_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_versions" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "changelog" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "deployed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "ai_model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_match_analyses" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "features" TEXT,
    "confidence_data" TEXT,
    "reasoning" TEXT,
    "analysis" TEXT,
    "suggested_market" TEXT,
    "suggested_prediction" TEXT,
    "suggested_confidence" INTEGER,
    "suggested_risk_level" TEXT,
    "suggested_is_vip" BOOLEAN NOT NULL DEFAULT false,
    "model_version" TEXT,
    "processing_ms" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_match_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_prediction_queues" (
    "id" TEXT NOT NULL,
    "match_id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "scheduled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "error" TEXT,
    "queued_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_prediction_queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "api_key" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 5,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "health_status" TEXT NOT NULL DEFAULT 'unknown',
    "last_checked_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "avg_latency_ms" INTEGER NOT NULL DEFAULT 0,
    "daily_quota" INTEGER NOT NULL DEFAULT 0,
    "quota_used" INTEGER NOT NULL DEFAULT 0,
    "quota_reset_at" TIMESTAMP(3),
    "rate_limit" INTEGER NOT NULL DEFAULT 60,
    "config" TEXT NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_sync_logs" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "sync_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "records_in" INTEGER NOT NULL DEFAULT 0,
    "records_new" INTEGER NOT NULL DEFAULT 0,
    "records_updated" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "provider_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_league_mappings" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "external_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_league_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_publish_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "auto_publish" BOOLEAN NOT NULL DEFAULT false,
    "auto_publish_mode" TEXT NOT NULL DEFAULT 'manual',
    "hours_before_kickoff" INTEGER NOT NULL DEFAULT 3,
    "min_confidence_to_publish" INTEGER NOT NULL DEFAULT 70,
    "publish_vip_only" BOOLEAN NOT NULL DEFAULT false,
    "require_admin_approval" BOOLEAN NOT NULL DEFAULT true,
    "auto_queue_new_matches" BOOLEAN NOT NULL DEFAULT false,
    "queue_hours_ahead" INTEGER NOT NULL DEFAULT 48,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "ai_publish_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_drift_alerts" (
    "id" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metric" TEXT,
    "threshold" DOUBLE PRECISION,
    "current_value" DOUBLE PRECISION,
    "baseline_value" DOUBLE PRECISION,
    "league_id" TEXT,
    "market" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "is_resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "ai_drift_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_league_weights" (
    "id" TEXT NOT NULL,
    "league_id" TEXT,
    "market" TEXT,
    "weights" TEXT NOT NULL DEFAULT '{}',
    "sample_size" INTEGER NOT NULL DEFAULT 0,
    "accuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_league_weights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_monitoring_logs" (
    "id" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '{}',
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_monitoring_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_learning_metrics" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "total_predictions" INTEGER NOT NULL DEFAULT 0,
    "correct_predictions" INTEGER NOT NULL DEFAULT 0,
    "accuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "market_breakdown" TEXT,
    "calibration_data" TEXT,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_learning_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ambassador_applications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "username" TEXT NOT NULL,
    "bio" TEXT,
    "social_links" TEXT NOT NULL DEFAULT '[]',
    "rejection_reason" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ambassador_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ambassador_activity_scores" (
    "user_id" TEXT NOT NULL,
    "game_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deposit_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vip_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "task_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "football_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "other_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "composite_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ambassador_activity_scores_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "ambassador_reward_pools" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "total_pool" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "distributed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ambassador_reward_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ambassador_pool_distributions" (
    "id" TEXT NOT NULL,
    "pool_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "share" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ambassador_pool_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_challenges" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "period" TEXT NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "referral_pool" DOUBLE PRECISION NOT NULL DEFAULT 200,
    "referral_top_n" INTEGER NOT NULL DEFAULT 50,
    "affiliate_pool" DOUBLE PRECISION NOT NULL DEFAULT 350,
    "affiliate_top_n" INTEGER NOT NULL DEFAULT 10,
    "ambassador_pool" DOUBLE PRECISION NOT NULL DEFAULT 400,
    "ambassador_top_n" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_entries" (
    "id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "referrer_id" TEXT NOT NULL,
    "referred_id" TEXT NOT NULL,
    "qualified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_rewards" (
    "id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "football_hub_daily_claims" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "claim_date" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 25,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "football_hub_daily_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "football_points_balances" (
    "user_id" TEXT NOT NULL,
    "total_points" INTEGER NOT NULL DEFAULT 0,
    "current_points" INTEGER NOT NULL DEFAULT 0,
    "total_converted" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "football_points_balances_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "vip_grants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "granted_by" TEXT NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "reason" TEXT,
    "challenge_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_until" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vip_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "cta_label" TEXT,
    "cta_url" TEXT,
    "image_url" TEXT,
    "badge_label" TEXT,
    "badge_color" TEXT,
    "accent_color" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "task_id" TEXT,
    "created_by" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_placements" (
    "id" TEXT NOT NULL,
    "promotion_id" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "promotion_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_schedules" (
    "id" TEXT NOT NULL,
    "promotion_id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "auto_activate" BOOLEAN NOT NULL DEFAULT true,
    "auto_expire" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "promotion_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "featured_requests" (
    "id" TEXT NOT NULL,
    "promotion_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_marketplace',
    "refunded_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "featured_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "featured_pricing" (
    "id" TEXT NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "featured_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "featured_revenue" (
    "id" TEXT NOT NULL,
    "featured_req_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "refunded" BOOLEAN NOT NULL DEFAULT false,
    "refunded_at" TIMESTAMP(3),
    "refunded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "featured_revenue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_event_links" (
    "id" TEXT NOT NULL,
    "promotion_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_id" TEXT,
    "metadata" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_event_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_status_history" (
    "id" TEXT NOT NULL,
    "promotion_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "changed_by" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auctions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reward_type" TEXT NOT NULL,
    "reward_name" TEXT,
    "reward_value" DOUBLE PRECISION NOT NULL,
    "reward_image_url" TEXT,
    "bid_amount" DOUBLE PRECISION NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "extension_window_seconds" INTEGER NOT NULL DEFAULT 60,
    "extension_duration_seconds" INTEGER NOT NULL DEFAULT 600,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "current_leader_id" TEXT,
    "current_pool" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bid_count" INTEGER NOT NULL DEFAULT 0,
    "participant_count" INTEGER NOT NULL DEFAULT 0,
    "extension_count" INTEGER NOT NULL DEFAULT 0,
    "last_extended_at" TIMESTAMP(3),
    "last_bid_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_bids" (
    "id" TEXT NOT NULL,
    "auction_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "bid_number" INTEGER NOT NULL,
    "is_leading" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auction_bids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_status_history" (
    "id" TEXT NOT NULL,
    "auction_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "changed_by" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auction_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_collection" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "auction_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_claim',
    "claimed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "delivery_notes" TEXT,
    "reward_data" TEXT,
    "claim_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auction_collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "languages" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "native_name" TEXT NOT NULL,
    "flag" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'ltr',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "languages_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "translation_keys" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "namespace" TEXT NOT NULL DEFAULT 'common',
    "default_value" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "translation_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translations" (
    "id" TEXT NOT NULL,
    "language_code" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "is_auto_translated" BOOLEAN NOT NULL DEFAULT false,
    "is_approved" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translation_history" (
    "id" SERIAL NOT NULL,
    "language_code" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT NOT NULL,
    "changed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "translation_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "rate_source" TEXT NOT NULL DEFAULT 'manual',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "country" TEXT,
    "flag" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateUniqueIndex statements
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");
CREATE UNIQUE INDEX "users_affiliate_code_key" ON "users"("affiliate_code");
CREATE UNIQUE INDEX "users_ambassador_code_key" ON "users"("ambassador_code");
CREATE UNIQUE INDEX "user_profiles_username_key" ON "user_profiles"("username");
CREATE UNIQUE INDEX "kyc_submissions_user_id_key" ON "kyc_submissions"("user_id");
CREATE UNIQUE INDEX "wallets_user_id_wallet_type_key" ON "wallets"("user_id", "wallet_type");
CREATE UNIQUE INDEX "task_proofs_task_id_user_id_key" ON "task_proofs"("task_id", "user_id");
CREATE UNIQUE INDEX "admin_proof_reviews_proof_id_key" ON "admin_proof_reviews"("proof_id");
CREATE UNIQUE INDEX "referrals_referred_id_key" ON "referrals"("referred_id");
CREATE UNIQUE INDEX "affiliate_applications_user_id_key" ON "affiliate_applications"("user_id");
CREATE UNIQUE INDEX "game_rounds_verification_id_key" ON "game_rounds"("verification_id");
CREATE UNIQUE INDEX "game_rounds_game_type_lobby_id_round_number_key" ON "game_rounds"("game_type", "lobby_id", "round_number");
CREATE UNIQUE INDEX "pvp_matches_verification_id_key" ON "pvp_matches"("verification_id");
CREATE UNIQUE INDEX "private_rooms_code_key" ON "private_rooms"("code");
CREATE UNIQUE INDEX "dice_rounds_verification_id_key" ON "dice_rounds"("verification_id");
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE UNIQUE INDEX "ip_blocks_ip_address_key" ON "ip_blocks"("ip_address");
CREATE UNIQUE INDEX "system_config_key_key" ON "system_config"("key");
CREATE UNIQUE INDEX "content_posts_slug_key" ON "content_posts"("slug");
CREATE UNIQUE INDEX "static_pages_slug_key" ON "static_pages"("slug");
CREATE UNIQUE INDEX "prediction_results_prediction_id_key" ON "prediction_results"("prediction_id");
CREATE UNIQUE INDEX "user_prediction_views_user_id_prediction_id_key" ON "user_prediction_views"("user_id", "prediction_id");
CREATE UNIQUE INDEX "ai_model_versions_version_key" ON "ai_model_versions"("version");
CREATE UNIQUE INDEX "ai_match_analyses_match_id_key" ON "ai_match_analyses"("match_id");
CREATE UNIQUE INDEX "ai_learning_metrics_period_key" ON "ai_learning_metrics"("period");
CREATE UNIQUE INDEX "data_providers_name_key" ON "data_providers"("name");
CREATE UNIQUE INDEX "provider_league_mappings_provider_id_external_id_key" ON "provider_league_mappings"("provider_id", "external_id");
CREATE UNIQUE INDEX "ambassador_applications_user_id_key" ON "ambassador_applications"("user_id");
CREATE UNIQUE INDEX "ambassador_reward_pools_period_key" ON "ambassador_reward_pools"("period");
CREATE UNIQUE INDEX "ambassador_pool_distributions_pool_id_user_id_key" ON "ambassador_pool_distributions"("pool_id", "user_id");
CREATE UNIQUE INDEX "referral_challenges_period_key" ON "referral_challenges"("period");
CREATE UNIQUE INDEX "challenge_entries_challenge_id_referred_id_key" ON "challenge_entries"("challenge_id", "referred_id");
CREATE UNIQUE INDEX "challenge_rewards_challenge_id_level_rank_key" ON "challenge_rewards"("challenge_id", "level", "rank");
CREATE UNIQUE INDEX "football_hub_daily_claims_user_id_claim_date_key" ON "football_hub_daily_claims"("user_id", "claim_date");
CREATE UNIQUE INDEX "promotion_placements_promotion_id_location_key" ON "promotion_placements"("promotion_id", "location");
CREATE UNIQUE INDEX "promotion_schedules_promotion_id_key" ON "promotion_schedules"("promotion_id");
CREATE UNIQUE INDEX "featured_requests_promotion_id_key" ON "featured_requests"("promotion_id");
CREATE UNIQUE INDEX "featured_pricing_duration_days_key" ON "featured_pricing"("duration_days");
CREATE UNIQUE INDEX "featured_revenue_featured_req_id_key" ON "featured_revenue"("featured_req_id");
CREATE UNIQUE INDEX "promotion_event_links_promotion_id_event_type_event_id_key" ON "promotion_event_links"("promotion_id", "event_type", "event_id");
CREATE UNIQUE INDEX "auction_collection_auction_id_key" ON "auction_collection"("auction_id");
CREATE UNIQUE INDEX "translation_keys_key_key" ON "translation_keys"("key");
CREATE UNIQUE INDEX "translations_language_code_key_key" ON "translations"("language_code", "key");

-- CreateIndex statements
CREATE INDEX "auth_tokens_user_id_idx" ON "auth_tokens"("user_id");
CREATE INDEX "auth_tokens_token_hash_idx" ON "auth_tokens"("token_hash");
CREATE INDEX "wallets_user_id_idx" ON "wallets"("user_id");
CREATE INDEX "transactions_user_id_idx" ON "transactions"("user_id");
CREATE INDEX "deposits_user_id_idx" ON "deposits"("user_id");
CREATE INDEX "withdrawals_user_id_idx" ON "withdrawals"("user_id");
CREATE INDEX "tasks_status_created_at_idx" ON "tasks"("status", "created_at" DESC);
CREATE INDEX "tasks_advertiser_id_idx" ON "tasks"("advertiser_id");
CREATE INDEX "task_proofs_status_idx" ON "task_proofs"("status");
CREATE INDEX "referrals_referrer_id_idx" ON "referrals"("referrer_id");
CREATE INDEX "affiliate_commissions_beneficiary_id_idx" ON "affiliate_commissions"("beneficiary_id");
CREATE INDEX "affiliate_commissions_source_user_id_idx" ON "affiliate_commissions"("source_user_id");
CREATE INDEX "affiliate_commissions_event_ref_id_idx" ON "affiliate_commissions"("event_ref_id");
CREATE INDEX "affiliate_applications_status_idx" ON "affiliate_applications"("status");
CREATE INDEX "commission_jobs_status_created_at_idx" ON "commission_jobs"("status", "created_at");
CREATE INDEX "game_rounds_game_type_lobby_id_status_idx" ON "game_rounds"("game_type", "lobby_id", "status");
CREATE INDEX "game_bets_round_id_idx" ON "game_bets"("round_id");
CREATE INDEX "game_bets_user_id_idx" ON "game_bets"("user_id");
CREATE INDEX "matchmaking_queues_game_type_stake_status_idx" ON "matchmaking_queues"("game_type", "stake", "status");
CREATE INDEX "dice_rounds_game_type_stake_status_idx" ON "dice_rounds"("game_type", "stake", "status");
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");
CREATE INDEX "notifications_user_id_read_idx" ON "notifications"("user_id", "read");
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log"("actor_id");
CREATE INDEX "audit_log_target_type_target_id_idx" ON "audit_log"("target_type", "target_id");
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");
CREATE INDEX "security_events_type_idx" ON "security_events"("type");
CREATE INDEX "security_events_severity_idx" ON "security_events"("severity");
CREATE INDEX "security_events_ip_address_idx" ON "security_events"("ip_address");
CREATE INDEX "security_events_actor_id_idx" ON "security_events"("actor_id");
CREATE INDEX "security_events_created_at_idx" ON "security_events"("created_at");
CREATE INDEX "login_history_user_id_idx" ON "login_history"("user_id");
CREATE INDEX "login_history_email_idx" ON "login_history"("email");
CREATE INDEX "login_history_ip_address_idx" ON "login_history"("ip_address");
CREATE INDEX "login_history_success_idx" ON "login_history"("success");
CREATE INDEX "login_history_created_at_idx" ON "login_history"("created_at");
CREATE INDEX "ip_blocks_type_idx" ON "ip_blocks"("type");
CREATE INDEX "fraud_alerts_user_id_idx" ON "fraud_alerts"("user_id");
CREATE INDEX "fraud_alerts_severity_idx" ON "fraud_alerts"("severity");
CREATE INDEX "fraud_alerts_status_idx" ON "fraud_alerts"("status");
CREATE INDEX "fraud_alerts_type_idx" ON "fraud_alerts"("type");
CREATE INDEX "content_posts_category_status_idx" ON "content_posts"("category", "status");
CREATE INDEX "content_posts_status_published_at_idx" ON "content_posts"("status", "published_at");
CREATE INDEX "football_matches_league_id_idx" ON "football_matches"("league_id");
CREATE INDEX "football_matches_status_idx" ON "football_matches"("status");
CREATE INDEX "football_matches_kickoff_at_idx" ON "football_matches"("kickoff_at");
CREATE INDEX "football_matches_external_id_idx" ON "football_matches"("external_id");
CREATE INDEX "football_predictions_match_id_idx" ON "football_predictions"("match_id");
CREATE INDEX "football_predictions_status_idx" ON "football_predictions"("status");
CREATE INDEX "football_predictions_is_vip_idx" ON "football_predictions"("is_vip");
CREATE INDEX "football_predictions_published_at_idx" ON "football_predictions"("published_at");
CREATE INDEX "ai_prediction_queues_status_idx" ON "ai_prediction_queues"("status");
CREATE INDEX "ai_prediction_queues_scheduled_at_idx" ON "ai_prediction_queues"("scheduled_at");
CREATE INDEX "provider_sync_logs_provider_id_started_at_idx" ON "provider_sync_logs"("provider_id", "started_at");
CREATE INDEX "ai_drift_alerts_is_resolved_created_at_idx" ON "ai_drift_alerts"("is_resolved", "created_at");
CREATE INDEX "ai_monitoring_logs_component_created_at_idx" ON "ai_monitoring_logs"("component", "created_at");
CREATE INDEX "challenge_entries_challenge_id_referrer_id_idx" ON "challenge_entries"("challenge_id", "referrer_id");
CREATE INDEX "football_hub_daily_claims_user_id_idx" ON "football_hub_daily_claims"("user_id");
CREATE INDEX "vip_grants_user_id_idx" ON "vip_grants"("user_id");
CREATE INDEX "promotions_status_priority_idx" ON "promotions"("status", "priority");
CREATE INDEX "promotions_created_by_idx" ON "promotions"("created_by");
CREATE INDEX "promotion_placements_location_is_active_idx" ON "promotion_placements"("location", "is_active");
CREATE INDEX "featured_requests_user_id_idx" ON "featured_requests"("user_id");
CREATE INDEX "featured_requests_task_id_idx" ON "featured_requests"("task_id");
CREATE INDEX "featured_requests_status_idx" ON "featured_requests"("status");
CREATE INDEX "featured_revenue_user_id_idx" ON "featured_revenue"("user_id");
CREATE INDEX "auctions_status_idx" ON "auctions"("status");
CREATE INDEX "auctions_starts_at_idx" ON "auctions"("starts_at");
CREATE INDEX "auctions_ends_at_idx" ON "auctions"("ends_at");
CREATE INDEX "auctions_visibility_status_idx" ON "auctions"("visibility", "status");
CREATE INDEX "auction_bids_auction_id_idx" ON "auction_bids"("auction_id");
CREATE INDEX "auction_bids_user_id_idx" ON "auction_bids"("user_id");
CREATE INDEX "auction_bids_auction_id_bid_number_idx" ON "auction_bids"("auction_id", "bid_number");
CREATE INDEX "auction_bids_auction_id_is_leading_idx" ON "auction_bids"("auction_id", "is_leading");
CREATE INDEX "auction_status_history_auction_id_idx" ON "auction_status_history"("auction_id");
CREATE INDEX "auction_collection_user_id_idx" ON "auction_collection"("user_id");
CREATE INDEX "auction_collection_status_idx" ON "auction_collection"("status");
CREATE INDEX "translation_keys_namespace_idx" ON "translation_keys"("namespace");
CREATE INDEX "translations_language_code_idx" ON "translations"("language_code");
CREATE INDEX "translation_history_language_code_key_idx" ON "translation_history"("language_code", "key");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_upline_id_fkey" FOREIGN KEY ("upline_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "security_pins" ADD CONSTRAINT "security_pins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vip_streaks" ADD CONSTRAINT "vip_streaks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "withdrawal_limits" ADD CONSTRAINT "withdrawal_limits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_advertiser_id_fkey" FOREIGN KEY ("advertiser_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_reference_screenshots" ADD CONSTRAINT "task_reference_screenshots_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_proofs" ADD CONSTRAINT "task_proofs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_proofs" ADD CONSTRAINT "task_proofs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_proof_screenshots" ADD CONSTRAINT "task_proof_screenshots_proof_id_fkey" FOREIGN KEY ("proof_id") REFERENCES "task_proofs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_proof_reviews" ADD CONSTRAINT "admin_proof_reviews_proof_id_fkey" FOREIGN KEY ("proof_id") REFERENCES "task_proofs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_id_fkey" FOREIGN KEY ("referred_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "affiliate_applications" ADD CONSTRAINT "affiliate_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_bets" ADD CONSTRAINT "game_bets_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "game_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_bets" ADD CONSTRAINT "game_bets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "matchmaking_queues" ADD CONSTRAINT "matchmaking_queues_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "matchmaking_queues" ADD CONSTRAINT "matchmaking_queues_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "pvp_matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pvp_matches" ADD CONSTRAINT "pvp_matches_player1_id_fkey" FOREIGN KEY ("player1_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pvp_matches" ADD CONSTRAINT "pvp_matches_player2_id_fkey" FOREIGN KEY ("player2_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "private_rooms" ADD CONSTRAINT "private_rooms_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "private_rooms" ADD CONSTRAINT "private_rooms_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "football_matches" ADD CONSTRAINT "football_matches_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "football_leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "football_predictions" ADD CONSTRAINT "football_predictions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "football_matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prediction_results" ADD CONSTRAINT "prediction_results_prediction_id_fkey" FOREIGN KEY ("prediction_id") REFERENCES "football_predictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_prediction_views" ADD CONSTRAINT "user_prediction_views_prediction_id_fkey" FOREIGN KEY ("prediction_id") REFERENCES "football_predictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_match_analyses" ADD CONSTRAINT "ai_match_analyses_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "football_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_prediction_queues" ADD CONSTRAINT "ai_prediction_queues_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "football_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_sync_logs" ADD CONSTRAINT "provider_sync_logs_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "data_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_league_mappings" ADD CONSTRAINT "provider_league_mappings_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "data_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_league_mappings" ADD CONSTRAINT "provider_league_mappings_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "football_leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ambassador_applications" ADD CONSTRAINT "ambassador_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ambassador_activity_scores" ADD CONSTRAINT "ambassador_activity_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ambassador_pool_distributions" ADD CONSTRAINT "ambassador_pool_distributions_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "ambassador_reward_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ambassador_pool_distributions" ADD CONSTRAINT "ambassador_pool_distributions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "challenge_entries" ADD CONSTRAINT "challenge_entries_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "referral_challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "challenge_entries" ADD CONSTRAINT "challenge_entries_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "challenge_entries" ADD CONSTRAINT "challenge_entries_referred_id_fkey" FOREIGN KEY ("referred_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "challenge_rewards" ADD CONSTRAINT "challenge_rewards_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "referral_challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "challenge_rewards" ADD CONSTRAINT "challenge_rewards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "football_hub_daily_claims" ADD CONSTRAINT "football_hub_daily_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "football_points_balances" ADD CONSTRAINT "football_points_balances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vip_grants" ADD CONSTRAINT "vip_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vip_grants" ADD CONSTRAINT "vip_grants_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "referral_challenges"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "promotion_placements" ADD CONSTRAINT "promotion_placements_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promotion_schedules" ADD CONSTRAINT "promotion_schedules_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "featured_requests" ADD CONSTRAINT "featured_requests_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "featured_requests" ADD CONSTRAINT "featured_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "featured_revenue" ADD CONSTRAINT "featured_revenue_featured_req_id_fkey" FOREIGN KEY ("featured_req_id") REFERENCES "featured_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promotion_event_links" ADD CONSTRAINT "promotion_event_links_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promotion_status_history" ADD CONSTRAINT "promotion_status_history_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auction_bids" ADD CONSTRAINT "auction_bids_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auction_status_history" ADD CONSTRAINT "auction_status_history_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auction_collection" ADD CONSTRAINT "auction_collection_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "translations" ADD CONSTRAINT "translations_language_code_fkey" FOREIGN KEY ("language_code") REFERENCES "languages"("code") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "translations" ADD CONSTRAINT "translations_key_fkey" FOREIGN KEY ("key") REFERENCES "translation_keys"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_stats" ADD CONSTRAINT "game_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
