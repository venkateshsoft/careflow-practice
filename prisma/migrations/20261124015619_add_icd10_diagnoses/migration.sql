-- CreateTable
CREATE TABLE "DiagnosisCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validThrough" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagnosisCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncounterDiagnosis" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "diagnosisCodeId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "practiceId" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncounterDiagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiagnosisCode_fiscalYear_code_idx" ON "DiagnosisCode"("fiscalYear", "code");

-- CreateIndex
CREATE INDEX "DiagnosisCode_fiscalYear_description_idx" ON "DiagnosisCode"("fiscalYear", "description");

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosisCode_code_fiscalYear_key" ON "DiagnosisCode"("code", "fiscalYear");

-- CreateIndex
CREATE INDEX "EncounterDiagnosis_practiceId_encounterId_idx" ON "EncounterDiagnosis"("practiceId", "encounterId");

-- CreateIndex
CREATE INDEX "EncounterDiagnosis_diagnosisCodeId_idx" ON "EncounterDiagnosis"("diagnosisCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "EncounterDiagnosis_encounterId_diagnosisCodeId_key" ON "EncounterDiagnosis"("encounterId", "diagnosisCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "EncounterDiagnosis_encounterId_sequence_key" ON "EncounterDiagnosis"("encounterId", "sequence");

-- AddForeignKey
ALTER TABLE "EncounterDiagnosis" ADD CONSTRAINT "EncounterDiagnosis_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "ClinicalEncounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterDiagnosis" ADD CONSTRAINT "EncounterDiagnosis_diagnosisCodeId_fkey" FOREIGN KEY ("diagnosisCodeId") REFERENCES "DiagnosisCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterDiagnosis" ADD CONSTRAINT "EncounterDiagnosis_practiceId_fkey" FOREIGN KEY ("practiceId") REFERENCES "Practice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncounterDiagnosis" ADD CONSTRAINT "EncounterDiagnosis_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
