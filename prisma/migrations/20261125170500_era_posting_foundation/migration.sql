-- CreateEnum
CREATE TYPE "EraPostingBatchStatus" AS ENUM ('PREVIEW', 'BLOCKED', 'READY_FOR_REVIEW', 'APPROVED', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "EraAdjustmentTreatment" AS ENUM ('PATIENT_RESPONSIBILITY', 'CONTRACTUAL_CREDIT', 'CONTRACTUAL_DEBIT', 'REVIEW_REQUIRED', 'INFORMATIONAL');

-- AlterTable
ALTER TABLE "ChargeAdjustment" ADD COLUMN     "eraPostingItemId" TEXT,
ADD COLUMN     "eraPostingReversalId" TEXT,
ADD COLUMN     "reversalOfAdjustmentId" TEXT;

-- AlterTable
ALTER TABLE "EraServiceLine" ADD COLUMN     "postingItemId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "eraPostingReversalId" TEXT,
ADD COLUMN     "reversalOfPaymentId" TEXT;

-- AlterTable
ALTER TABLE "PaymentAllocation" ADD COLUMN     "eraPostingReversalId" TEXT,
ADD COLUMN     "reversalOfAllocationId" TEXT;

-- CreateTable
CREATE TABLE "EraPostingBatch" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "eraImportId" TEXT NOT NULL,
    "status" "EraPostingBatchStatus" NOT NULL DEFAULT 'PREVIEW',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "totalInsurancePayment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalPatientResponsibility" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalContractualAdjustments" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "preparedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "postedById" TEXT,
    "reversedById" TEXT,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "reversalNote" TEXT,
    "blockingNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EraPostingBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EraPostingReversal" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "reversedById" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EraPostingReversal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EraPostingClaim" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "eraClaimId" TEXT NOT NULL,
    "insuranceClaimId" TEXT,
    "patientId" TEXT,
    "paymentId" TEXT,
    "paymentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "patientResponsibilityAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EraPostingClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EraPostingItem" (
    "id" TEXT NOT NULL,
    "postingClaimId" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "paymentAllocationId" TEXT,
    "chargeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "insurancePayment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "patientResponsibility" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "contractualAdjustment" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "adjustmentSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EraPostingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EraAdjustmentMapping" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "groupCode" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "treatment" "EraAdjustmentTreatment" NOT NULL,
    "description" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EraAdjustmentMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EraPostingBatch_eraImportId_key" ON "EraPostingBatch"("eraImportId");

-- CreateIndex
CREATE INDEX "EraPostingBatch_practiceId_status_preparedAt_idx" ON "EraPostingBatch"("practiceId", "status", "preparedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EraPostingReversal_batchId_key" ON "EraPostingReversal"("batchId");

-- CreateIndex
CREATE INDEX "EraPostingReversal_practiceId_createdAt_idx" ON "EraPostingReversal"("practiceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EraPostingClaim_eraClaimId_key" ON "EraPostingClaim"("eraClaimId");

-- CreateIndex
CREATE UNIQUE INDEX "EraPostingClaim_paymentId_key" ON "EraPostingClaim"("paymentId");

-- CreateIndex
CREATE INDEX "EraPostingClaim_insuranceClaimId_idx" ON "EraPostingClaim"("insuranceClaimId");

-- CreateIndex
CREATE INDEX "EraPostingClaim_patientId_idx" ON "EraPostingClaim"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "EraPostingClaim_batchId_eraClaimId_key" ON "EraPostingClaim"("batchId", "eraClaimId");

-- CreateIndex
CREATE UNIQUE INDEX "EraPostingItem_paymentAllocationId_key" ON "EraPostingItem"("paymentAllocationId");

-- CreateIndex
CREATE INDEX "EraPostingItem_chargeId_idx" ON "EraPostingItem"("chargeId");

-- CreateIndex
CREATE UNIQUE INDEX "EraPostingItem_postingClaimId_chargeId_key" ON "EraPostingItem"("postingClaimId", "chargeId");

-- CreateIndex
CREATE INDEX "EraAdjustmentMapping_practiceId_active_treatment_idx" ON "EraAdjustmentMapping"("practiceId", "active", "treatment");

-- CreateIndex
CREATE UNIQUE INDEX "EraAdjustmentMapping_practiceId_groupCode_reasonCode_key" ON "EraAdjustmentMapping"("practiceId", "groupCode", "reasonCode");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeAdjustment_reversalOfAdjustmentId_key" ON "ChargeAdjustment"("reversalOfAdjustmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reversalOfPaymentId_key" ON "Payment"("reversalOfPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_reversalOfAllocationId_key" ON "PaymentAllocation"("reversalOfAllocationId");

-- AddForeignKey
ALTER TABLE "ChargeAdjustment" ADD CONSTRAINT "ChargeAdjustment_eraPostingItemId_fkey" FOREIGN KEY ("eraPostingItemId") REFERENCES "EraPostingItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeAdjustment" ADD CONSTRAINT "ChargeAdjustment_reversalOfAdjustmentId_fkey" FOREIGN KEY ("reversalOfAdjustmentId") REFERENCES "ChargeAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeAdjustment" ADD CONSTRAINT "ChargeAdjustment_eraPostingReversalId_fkey" FOREIGN KEY ("eraPostingReversalId") REFERENCES "EraPostingReversal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reversalOfPaymentId_fkey" FOREIGN KEY ("reversalOfPaymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_eraPostingReversalId_fkey" FOREIGN KEY ("eraPostingReversalId") REFERENCES "EraPostingReversal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_reversalOfAllocationId_fkey" FOREIGN KEY ("reversalOfAllocationId") REFERENCES "PaymentAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_eraPostingReversalId_fkey" FOREIGN KEY ("eraPostingReversalId") REFERENCES "EraPostingReversal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraServiceLine" ADD CONSTRAINT "EraServiceLine_postingItemId_fkey" FOREIGN KEY ("postingItemId") REFERENCES "EraPostingItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraPostingBatch" ADD CONSTRAINT "EraPostingBatch_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraPostingBatch" ADD CONSTRAINT "EraPostingBatch_eraImportId_fkey" FOREIGN KEY ("eraImportId") REFERENCES "EraImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraPostingBatch" ADD CONSTRAINT "EraPostingBatch_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraPostingBatch" ADD CONSTRAINT "EraPostingBatch_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraPostingBatch" ADD CONSTRAINT "EraPostingBatch_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraPostingBatch" ADD CONSTRAINT "EraPostingBatch_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraPostingReversal" ADD CONSTRAINT "EraPostingReversal_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "EraPostingBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraPostingReversal" ADD CONSTRAINT "EraPostingReversal_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraPostingReversal" ADD CONSTRAINT "EraPostingReversal_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraPostingClaim" ADD CONSTRAINT "EraPostingClaim_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "EraPostingBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraPostingClaim" ADD CONSTRAINT "EraPostingClaim_eraClaimId_fkey" FOREIGN KEY ("eraClaimId") REFERENCES "EraClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraPostingClaim" ADD CONSTRAINT "EraPostingClaim_insuranceClaimId_fkey" FOREIGN KEY ("insuranceClaimId") REFERENCES "InsuranceClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraPostingClaim" ADD CONSTRAINT "EraPostingClaim_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraPostingClaim" ADD CONSTRAINT "EraPostingClaim_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraPostingItem" ADD CONSTRAINT "EraPostingItem_postingClaimId_fkey" FOREIGN KEY ("postingClaimId") REFERENCES "EraPostingClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraPostingItem" ADD CONSTRAINT "EraPostingItem_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraPostingItem" ADD CONSTRAINT "EraPostingItem_paymentAllocationId_fkey" FOREIGN KEY ("paymentAllocationId") REFERENCES "PaymentAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EraAdjustmentMapping" ADD CONSTRAINT "EraAdjustmentMapping_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
