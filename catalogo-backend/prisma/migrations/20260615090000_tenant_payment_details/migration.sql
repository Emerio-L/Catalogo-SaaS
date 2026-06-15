CREATE TABLE "PaymentDetails" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mostrarDatosPago" BOOLEAN NOT NULL DEFAULT false,
    "banco" TEXT NOT NULL DEFAULT '',
    "tipoCuenta" TEXT NOT NULL DEFAULT '',
    "numeroCuenta" TEXT NOT NULL DEFAULT '',
    "nombreTitular" TEXT NOT NULL DEFAULT '',
    "montoSugerido" DECIMAL(10,2),
    "instruccionesPago" TEXT NOT NULL DEFAULT '',
    "fechaLimitePago" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentDetails_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentDetails_tenantId_key" ON "PaymentDetails"("tenantId");
CREATE INDEX "PaymentDetails_tenantId_idx" ON "PaymentDetails"("tenantId");

ALTER TABLE "PaymentDetails"
ADD CONSTRAINT "PaymentDetails_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
