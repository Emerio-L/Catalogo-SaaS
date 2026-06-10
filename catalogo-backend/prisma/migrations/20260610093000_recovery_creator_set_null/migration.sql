ALTER TABLE "RecoveryCode"
DROP CONSTRAINT "RecoveryCode_createdBy_fkey";

ALTER TABLE "RecoveryCode"
ALTER COLUMN "createdBy" DROP NOT NULL;

ALTER TABLE "RecoveryCode"
ADD CONSTRAINT "RecoveryCode_createdBy_fkey"
FOREIGN KEY ("createdBy") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
