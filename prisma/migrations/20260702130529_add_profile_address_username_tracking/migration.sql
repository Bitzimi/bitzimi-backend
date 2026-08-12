-- Add address and username tracking fields to user_profiles

ALTER TABLE "user_profiles"
ADD COLUMN "address_street" TEXT;

ALTER TABLE "user_profiles"
ADD COLUMN "address_city" TEXT;

ALTER TABLE "user_profiles"
ADD COLUMN "address_state" TEXT;

ALTER TABLE "user_profiles"
ADD COLUMN "address_country" TEXT;

ALTER TABLE "user_profiles"
ADD COLUMN "address_postal_code" TEXT;

ALTER TABLE "user_profiles"
ADD COLUMN "address_locked_by_verification" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "user_profiles"
ADD COLUMN "last_username_edit" TIMESTAMP;
