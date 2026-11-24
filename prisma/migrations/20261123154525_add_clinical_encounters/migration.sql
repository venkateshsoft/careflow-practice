-- CreateEnum
CREATE TYPE "EncounterStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'SIGNED');

-- CreateTable
CREATE TABLE "ClinicalEncounter" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "authorId" TEXT,
    "status" "EncounterStatus" NOT NULL DEFAULT 'DRAFT',
    "chiefComplaint" TEXT,
    "historyOfPresentIllness" TEXT,
    "reviewOfSystems" TEXT,
    "physicalExam" TEXT,
    "assessment" TEXT,
    "diagnosis" TEXT,
    "plan" TEXT,
    "vitals" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "signedAt" TIMESTAMP(3),

    CONSTRAINT "ClinicalEncounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalEncounter_appointmentId_key" ON "ClinicalEncounter"("appointmentId");

-- CreateIndex
CREATE INDEX "ClinicalEncounter_practiceId_status_idx" ON "ClinicalEncounter"("practiceId", "status");

-- CreateIndex
CREATE INDEX "ClinicalEncounter_patientId_createdAt_idx" ON "ClinicalEncounter"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClinicalEncounter_providerId_createdAt_idx" ON "ClinicalEncounter"("providerId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClinicalEncounter" ADD CONSTRAINT "ClinicalEncounter_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalEncounter" ADD CONSTRAINT "ClinicalEncounter_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalEncounter" ADD CONSTRAINT "ClinicalEncounter_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalEncounter" ADD CONSTRAINT "ClinicalEncounter_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalEncounter" ADD CONSTRAINT "ClinicalEncounter_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
