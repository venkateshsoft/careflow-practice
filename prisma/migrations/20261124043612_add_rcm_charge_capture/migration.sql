-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('DRAFT', 'POSTED', 'VOIDED');

-- CreateTable
CREATE TABLE "ProcedureCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "visitTypeMapping" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcedureCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeSchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveThrough" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "practiceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeScheduleItem" (
    "id" TEXT NOT NULL,
    "feeScheduleId" TEXT NOT NULL,
    "procedureCodeId" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "feeScheduleId" TEXT,
    "status" "ChargeStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "createdById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "postedById" TEXT,
    "voidedById" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeLine" (
    "id" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "procedureCodeId" TEXT NOT NULL,
    "feeScheduleItemId" TEXT,
    "sequence" INTEGER NOT NULL,
    "codeSnapshot" TEXT NOT NULL,
    "descriptionSnapshot" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChargeLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcedureCode_code_key" ON "ProcedureCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProcedureCode_visitTypeMapping_key" ON "ProcedureCode"("visitTypeMapping");

-- CreateIndex
CREATE INDEX "ProcedureCode_isActive_category_idx" ON "ProcedureCode"("isActive", "category");

-- CreateIndex
CREATE INDEX "FeeSchedule_practiceId_isActive_idx" ON "FeeSchedule"("practiceId", "isActive");

-- CreateIndex
CREATE INDEX "FeeSchedule_practiceId_effectiveFrom_effectiveThrough_idx" ON "FeeSchedule"("practiceId", "effectiveFrom", "effectiveThrough");

-- CreateIndex
CREATE INDEX "FeeScheduleItem_procedureCodeId_idx" ON "FeeScheduleItem"("procedureCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeScheduleItem_feeScheduleId_procedureCodeId_key" ON "FeeScheduleItem"("feeScheduleId", "procedureCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_encounterId_key" ON "Charge"("encounterId");

-- CreateIndex
CREATE INDEX "Charge_practiceId_status_generatedAt_idx" ON "Charge"("practiceId", "status", "generatedAt");

-- CreateIndex
CREATE INDEX "Charge_patientId_generatedAt_idx" ON "Charge"("patientId", "generatedAt");

-- CreateIndex
CREATE INDEX "Charge_providerId_generatedAt_idx" ON "Charge"("providerId", "generatedAt");

-- CreateIndex
CREATE INDEX "ChargeLine_procedureCodeId_idx" ON "ChargeLine"("procedureCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeLine_chargeId_sequence_key" ON "ChargeLine"("chargeId", "sequence");

-- AddForeignKey
ALTER TABLE "FeeSchedule" ADD CONSTRAINT "FeeSchedule_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeScheduleItem" ADD CONSTRAINT "FeeScheduleItem_feeScheduleId_fkey" FOREIGN KEY ("feeScheduleId") REFERENCES "FeeSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeScheduleItem" ADD CONSTRAINT "FeeScheduleItem_procedureCodeId_fkey" FOREIGN KEY ("procedureCodeId") REFERENCES "ProcedureCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "ClinicalEncounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_feeScheduleId_fkey" FOREIGN KEY ("feeScheduleId") REFERENCES "FeeSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_procedureCodeId_fkey" FOREIGN KEY ("procedureCodeId") REFERENCES "ProcedureCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeLine" ADD CONSTRAINT "ChargeLine_feeScheduleItemId_fkey" FOREIGN KEY ("feeScheduleItemId") REFERENCES "FeeScheduleItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
