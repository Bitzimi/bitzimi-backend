-- AlterTable
ALTER TABLE "audit_log" ADD COLUMN "http_status" INTEGER;
ALTER TABLE "audit_log" ADD COLUMN "metadata" TEXT;

-- CreateTable
CREATE TABLE "system_config" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updated_at" DATETIME NOT NULL,
    "updated_by" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "system_config_key_key" ON "system_config"("key");

-- CreateIndex
CREATE INDEX "audit_log_target_type_target_id_idx" ON "audit_log"("target_type", "target_id");
