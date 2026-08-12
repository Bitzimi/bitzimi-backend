-- Add new settings and payment fields to user_profiles

ALTER TABLE "user_profiles"
ADD COLUMN "theme_pref" TEXT NOT NULL DEFAULT 'dark';

ALTER TABLE "user_profiles"
ADD COLUMN "usdt_address" TEXT;

ALTER TABLE "user_profiles"
ADD COLUMN "bank_account_name" TEXT;

ALTER TABLE "user_profiles"
ADD COLUMN "bank_account_number" TEXT;

ALTER TABLE "user_profiles"
ADD COLUMN "bank_name" TEXT;

ALTER TABLE "user_profiles"
ADD COLUMN "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "user_profiles"
ADD COLUMN "two_factor_secret" TEXT;
