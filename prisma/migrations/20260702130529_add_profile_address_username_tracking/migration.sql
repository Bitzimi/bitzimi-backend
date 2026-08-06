-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_user_profiles" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
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
    "last_username_edit" DATETIME,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_user_profiles" ("avatar_url", "bank_account_name", "bank_account_number", "bank_name", "currency_pref", "full_name", "language_pref", "phone_number", "phone_verified", "theme_pref", "two_factor_enabled", "two_factor_secret", "updated_at", "usdt_address", "user_id", "username") SELECT "avatar_url", "bank_account_name", "bank_account_number", "bank_name", "currency_pref", "full_name", "language_pref", "phone_number", "phone_verified", "theme_pref", "two_factor_enabled", "two_factor_secret", "updated_at", "usdt_address", "user_id", "username" FROM "user_profiles";
DROP TABLE "user_profiles";
ALTER TABLE "new_user_profiles" RENAME TO "user_profiles";
CREATE UNIQUE INDEX "user_profiles_username_key" ON "user_profiles"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
