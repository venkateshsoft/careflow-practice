-- CreateEnum
CREATE TYPE "InsuranceClaimStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PARTIALLY_ADJUDICATED', 'ADJUDICATED', 'VOIDED');

-- CreateEnum
CREATE TYPE "EraImportStatus" AS ENUM ('RECEIVED', 'VALIDATION_FAILED', 'VALIDATED', 'RECONCILIATION_READY', 'RECONCILED', 'POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "EraMatchStatus" AS ENUM ('UNMATCHED', 'PARTIALLY_MATCHED', 'MATCHED', 'EXCEPTION', 'RECONCILED');

-- CreateEnum
CREATE TYPE "EraExceptionSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "EraExceptionStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateTable
CREATE TABLE "InsurancePayer" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "payerCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsurancePayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceClaim" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "patientControlNumber" TEXT NOT NULL,
    "payerClaimControlNumber" TEXT,
    "status" "InsuranceClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "totalBilled" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsuranceClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceClaimLine" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "chargeLineId" TEXT NOT NULL,
    "submittedAmount" DECIMAL(12,2) NOT NULL,
    "units" DECIMAL(10,3),
    "serviceDateFrom" TIMESTAMP(3),
    "serviceDateThrough" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsuranceClaimLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EraImport" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "payerId" TEXT,
    "status" "EraImportStatus" NOT NULL DEFAULT 'RECEIVED',
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "rawContent" TEXT NOT NULL,
    "parserVersion" TEXT,
    "interchangeControlNumber" TEXT,
    "groupControlNumber" TEXT,
    "transactionControlNumber" TEXT,
    "senderId" TEXT,
    "receiverId" TEXT,
    "paymentAmount" DECIMAL(12,2),
    "paymentMethodCode" TEXT,
    "paymentEffectiveDate" TIMESTAMP(3),
    "traceNumber" TEXT,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "importedById" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "EraImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EraClaim" (
    "id" TEXT NOT NULL,
    "eraImportId" TEXT NOT NULL,
    "patientId" TEXT,
    "insuranceClaimId" TEXT,
    "patientControlNumber" TEXT NOT NULL,
    "payerClaimControlNumber" TEXT,
    "claimStatusCode" TEXT NOT NULL,
    "claimFilingIndicator" TEXT,
    "totalChargeAmount" DECIMAL(12,2) NOT NULL,
    "paymentAmount" DECIMAL(12,2) NOT NULL,
    "patientResponsibilityAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "claimReceivedDate" TIMESTAMP(3),
    "claimStatementFrom" TIMESTAMP(3),
    "claimStatementThrough" TIMESTAMP(3),
    "matchStatus" "EraMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "EraClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EraServiceLine" (
    "id" TEXT NOT NULL,
    "eraClaimId" TEXT NOT NULL,
    "insuranceClaimLineId" TEXT,
    "chargeLineId" TEXT,
    "procedureIdentifierQualifier" TEXT,
    "procedureCode" TEXT,
    "modifiers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "revenueCode" TEXT,
    "lineChargeAmount" DECIMAL(12,2) NOT NULL,
    "linePaymentAmount" DECIMAL(12,2) NOT NULL,
    "unitsPaid" DECIMAL(10,3),
    "serviceDateFrom" TIMESTAMP(3),
    "serviceDateThrough" TIMESTAMP(3),
    "serviceLineControlNumber" TEXT,
    "adjudicationDate" TIMESTAMP(3),
    "matchStatus" "EraMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchedAt" TIMESTAMP(3),

    CONSTRAINT "EraServiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EraAdjustment" (
    "id" TEXT NOT NULL,
    "eraClaimId" TEXT NOT NULL,
    "eraServiceLineId" TEXT,
    "adjustmentSequence" INTEGER NOT NULL,
    "groupCode" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "quantity" DECIMAL(12,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EraAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EraProviderAdjustment" (
    "id" TEXT NOT NULL,
    "eraImportId" TEXT NOT NULL,
    "adjustmentSequence" INTEGER NOT NULL,
    "providerIdentifierQualifier" TEXT,
    "providerIdentifier" TEXT,
    "fiscalPeriodDate" TIMESTAMP(3),
    "reasonCode" TEXT NOT NULL,
    "referenceId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EraProviderAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EraException" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "eraImportId" TEXT NOT NULL,
    "eraClaimId" TEXT,
    "eraServiceLineId" TEXT,
    "category" TEXT NOT NULL,
    "code" TEXT,
    "message" TEXT NOT NULL,
    "severity" "EraExceptionSeverity" NOT NULL DEFAULT 'WARNING',
    "status" "EraExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EraException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InsurancePayer_practiceId_active_name_idx" ON "InsurancePayer"("practiceId", "active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "InsurancePayer_practiceId_payerCode_key" ON "InsurancePayer"("practiceId", "payerCode");

-- CreateIndex
CREATE INDEX "InsuranceClaim_practiceId_status_createdAt_idx" ON "InsuranceClaim"("practiceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "InsuranceClaim_patientId_createdAt_idx" ON "InsuranceClaim"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "InsuranceClaim_payerId_payerClaimControlNumber_idx" ON "InsuranceClaim"("payerId", "payerClaimControlNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceClaim_practiceId_patientControlNumber_key" ON "InsuranceClaim"("practiceId", "patientControlNumber");

-- CreateIndex
CREATE INDEX "InsuranceClaimLine_chargeLineId_idx" ON "InsuranceClaimLine"("chargeLineId");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceClaimLine_claimId_chargeLineId_key" ON "InsuranceClaimLine"("claimId", "chargeLineId");

-- CreateIndex
CREATE INDEX "EraImport_practiceId_status_receivedAt_idx" ON "EraImport"("practiceId", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "EraImport_practiceId_traceNumber_idx" ON "EraImport"("practiceId", "traceNumber");

-- CreateIndex
CREATE INDEX "EraImport_interchangeControlNumber_groupControlNumber_trans_idx" ON "EraImport"("interchangeControlNumber", "groupControlNumber", "transactionControlNumber");

-- CreateIndex
CREATE UNIQUE INDEX "EraImport_practiceId_fileHash_key" ON "EraImport"("practiceId", "fileHash");

-- CreateIndex
CREATE INDEX "EraClaim_eraImportId_matchStatus_idx" ON "EraClaim"("eraImportId", "matchStatus");

-- CreateIndex
CREATE INDEX "EraClaim_patientControlNumber_idx" ON "EraClaim"("patientControlNumber");

-- CreateIndex
CREATE INDEX "EraClaim_payerClaimControlNumber_idx" ON "EraClaim"("payerClaimControlNumber");

-- CreateIndex
CREATE INDEX "EraClaim_insuranceClaimId_idx" ON "EraClaim"("insuranceClaimId");

-- CreateIndex
CREATE INDEX "EraServiceLine_eraClaimId_matchStatus_idx" ON "EraServiceLine"("eraClaimId", "matchStatus");

-- CreateIndex
CREATE INDEX "EraServiceLine_procedureCode_idx" ON "EraServiceLine"("procedureCode");

-- CreateIndex
CREATE INDEX "EraServiceLine_chargeLineId_idx" ON "EraServiceLine"("chargeLineId");

-- CreateIndex
CREATE INDEX "EraAdjustment_eraClaimId_groupCode_reasonCode_idx" ON "EraAdjustment"("eraClaimId", "groupCode", "reasonCode");

-- CreateIndex
CREATE INDEX "EraAdjustment_eraServiceLineId_idx" ON "EraAdjustment"("eraServiceLineId");

-- CreateIndex
CREATE UNIQUE INDEX "EraAdjustment_eraClaimId_adjustmentSequence_key" ON "EraAdjustment"("eraClaimId", "adjustmentSequence");

-- CreateIndex
CREATE INDEX "EraProviderAdjustment_eraImportId_reasonCode_idx" ON "EraProviderAdjustment"("eraImportId", "reasonCode");

-- CreateIndex
CREATE UNIQUE INDEX "EraProviderAdjustment_eraImportId_adjustmentSequence_key" ON "EraProviderAdjustment"("eraImportId", "adjustmentSequence");

-- CreateIndex
CREATE INDEX "EraException_practiceId_status_severity_createdAt_idx" ON "EraException"("practiceId", "status", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "EraException_eraImportId_status_idx" ON "EraException"("eraImportId", "status");

-- CreateIndex
CREATE INDEX "EraException_eraClaimId_idx" ON "EraException"("eraClaimId");

-- CreateIndex
CREATE INDEX "EraException_eraServiceLineId_idx" ON "EraException"("eraServiceLineId");

-- CreateIndex
CREATE INDEX "Patient_practiceId_lastName_firstName_idx" ON "Patient"("practiceId", "lastName", "firstName");

-- AddForeignKey
ALTER TABLE "InsurancePayer" ADD CONSTRAINT "InsurancePayer_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "InsurancePayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaimLine" ADD CONSTRAINT "InsuranceClaimLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "InsuranceClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaimLine" ADD CONSTRAINT "InsuranceClaimLine_chargeLineId_fkey" FOREIGN KEY ("chargeLineId") REFERENCES "ChargeLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraImport" ADD CONSTRAINT "EraImport_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraImport" ADD CONSTRAINT "EraImport_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "InsurancePayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraImport" ADD CONSTRAINT "EraImport_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraClaim" ADD CONSTRAINT "EraClaim_eraImportId_fkey" FOREIGN KEY ("eraImportId") REFERENCES "EraImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraClaim" ADD CONSTRAINT "EraClaim_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraClaim" ADD CONSTRAINT "EraClaim_insuranceClaimId_fkey" FOREIGN KEY ("insuranceClaimId") REFERENCES "InsuranceClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraServiceLine" ADD CONSTRAINT "EraServiceLine_eraClaimId_fkey" FOREIGN KEY ("eraClaimId") REFERENCES "EraClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraServiceLine" ADD CONSTRAINT "EraServiceLine_insuranceClaimLineId_fkey" FOREIGN KEY ("insuranceClaimLineId") REFERENCES "InsuranceClaimLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraServiceLine" ADD CONSTRAINT "EraServiceLine_chargeLineId_fkey" FOREIGN KEY ("chargeLineId") REFERENCES "ChargeLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraAdjustment" ADD CONSTRAINT "EraAdjustment_eraClaimId_fkey" FOREIGN KEY ("eraClaimId") REFERENCES "EraClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraAdjustment" ADD CONSTRAINT "EraAdjustment_eraServiceLineId_fkey" FOREIGN KEY ("eraServiceLineId") REFERENCES "EraServiceLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraProviderAdjustment" ADD CONSTRAINT "EraProviderAdjustment_eraImportId_fkey" FOREIGN KEY ("eraImportId") REFERENCES "EraImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraException" ADD CONSTRAINT "EraException_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraException" ADD CONSTRAINT "EraException_eraImportId_fkey" FOREIGN KEY ("eraImportId") REFERENCES "EraImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraException" ADD CONSTRAINT "EraException_eraClaimId_fkey" FOREIGN KEY ("eraClaimId") REFERENCES "EraClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraException" ADD CONSTRAINT "EraException_eraServiceLineId_fkey" FOREIGN KEY ("eraServiceLineId") REFERENCES "EraServiceLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraException" ADD CONSTRAINT "EraException_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
