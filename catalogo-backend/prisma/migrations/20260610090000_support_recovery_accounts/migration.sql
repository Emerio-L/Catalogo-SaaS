ALTER TABLE "Tenant"
ADD COLUMN "accountNumber" TEXT,
ADD COLUMN "internalNotes" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Settings"
ALTER COLUMN "mostrarDescripcion" SET DEFAULT false;

UPDATE "Settings"
SET "mostrarDescripcion" = false
WHERE "mostrarDescripcion" = true;

WITH numbered_tenants AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (ORDER BY "creadoEn" ASC, "id" ASC) AS sequence_number
    FROM "Tenant"
)
UPDATE "Tenant" AS tenant
SET "accountNumber" = 'CT-' || LPAD(numbered_tenants.sequence_number::TEXT, 6, '0')
FROM numbered_tenants
WHERE tenant."id" = numbered_tenants."id"
  AND tenant."accountNumber" IS NULL;

ALTER TABLE "Tenant"
ALTER COLUMN "accountNumber" SET NOT NULL;

CREATE UNIQUE INDEX "Tenant_accountNumber_key" ON "Tenant"("accountNumber");

CREATE TABLE "RecoveryCode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "RecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecoveryCode_codeHash_key" ON "RecoveryCode"("codeHash");
CREATE INDEX "RecoveryCode_tenantId_idx" ON "RecoveryCode"("tenantId");
CREATE INDEX "RecoveryCode_userId_idx" ON "RecoveryCode"("userId");
CREATE INDEX "RecoveryCode_expiresAt_idx" ON "RecoveryCode"("expiresAt");
CREATE INDEX "SupportTicket_status_idx" ON "SupportTicket"("status");
CREATE INDEX "SupportTicket_createdAt_idx" ON "SupportTicket"("createdAt");

ALTER TABLE "RecoveryCode"
ADD CONSTRAINT "RecoveryCode_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecoveryCode"
ADD CONSTRAINT "RecoveryCode_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecoveryCode"
ADD CONSTRAINT "RecoveryCode_createdBy_fkey"
FOREIGN KEY ("createdBy") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
