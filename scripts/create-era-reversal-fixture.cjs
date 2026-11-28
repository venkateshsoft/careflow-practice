const { PrismaClient, AppointmentStatus, EncounterStatus, ChargeStatus, InsuranceClaimStatus } = require("@prisma/client");

const prisma = new PrismaClient();

const IDS = {
  practice: "demo-practice",
  admin: "demo-admin",
  provider: "demo-provider-profile",
  payer: "demo-era-payer-001",
  patient: "careflow-era-reversal-test-patient-001",
  appointment: "careflow-era-reversal-test-appointment-001",
  encounter: "careflow-era-reversal-test-encounter-001",
  charge: "careflow-era-reversal-test-charge-001",
  chargeLine: "careflow-era-reversal-test-charge-line-001",
  insuranceClaim: "careflow-era-reversal-test-insurance-claim-001",
  insuranceClaimLine: "careflow-era-reversal-test-claim-line-001",
  originalEraImport: "cmwxfoqkx0001ubf4gkywfwv4",
  originalPatient: "careflow-era-test-patient-001",
};

async function main() {
  // Guard against accidentally running this fixture against production or
  // another database. The known first ERA test import and patient must exist.
  const [practice, admin, provider, payer, procedure, originalImport, originalPatient] =
    await Promise.all([
      prisma.practice.findUnique({ where: { id: IDS.practice } }),
      prisma.user.findUnique({ where: { id: IDS.admin } }),
      prisma.provider.findUnique({ where: { id: IDS.provider } }),
      prisma.insurancePayer.findUnique({ where: { id: IDS.payer } }),
      prisma.procedureCode.findUnique({ where: { code: "DEMO-AWV" } }),
      prisma.eraImport.findFirst({
        where: { id: IDS.originalEraImport, practiceId: IDS.practice },
        select: { id: true, status: true },
      }),
      prisma.patient.findUnique({
        where: { id: IDS.originalPatient },
        select: { id: true, mrn: true },
      }),
    ]);

  if (!practice || !admin || !provider || !payer || !procedure) {
    throw new Error("Required development demo setup is missing. No fixture records were created.");
  }

  if (!originalImport || !originalPatient) {
    throw new Error(
      "Safety check failed: the known original development ERA import/patient was not found. " +
      "Confirm DATABASE_URL points to the CareFlow development branch. No fixture records were created."
    );
  }

  if (originalImport.status !== "POSTED") {
    throw new Error(
      `Safety check failed: original reference ERA import is ${originalImport.status}, not POSTED. No fixture records were created.`
    );
  }

  const existingPatient = await prisma.patient.findFirst({
    where: {
      OR: [
        { id: IDS.patient },
        { mrn: "CF-ERA-REV-TEST-001" },
      ],
    },
    select: { id: true, mrn: true, firstName: true, lastName: true },
  });

  if (existingPatient) {
    console.log("Synthetic reversal fixture already exists; no records were changed.");
    console.log(existingPatient);
    return;
  }

  await prisma.$transaction(async (tx) => {
    const patient = await tx.patient.create({
      data: {
        id: IDS.patient,
        mrn: "CF-ERA-REV-TEST-001",
        firstName: "Jamie",
        lastName: "Reversaltest",
        dateOfBirth: new Date("1985-06-15T00:00:00.000Z"),
        phone: "(555) 010-0199",
        status: "ACTIVE",
        practiceId: IDS.practice,
      },
    });

    const appointment = await tx.appointment.create({
      data: {
        id: IDS.appointment,
        startsAt: new Date("2026-11-20T14:00:00.000Z"),
        durationMin: 30,
        visitType: "Annual wellness",
        status: AppointmentStatus.COMPLETED,
        patientId: patient.id,
        providerId: provider.id,
        practiceId: practice.id,
      },
    });

    const encounter = await tx.clinicalEncounter.create({
      data: {
        id: IDS.encounter,
        appointmentId: appointment.id,
        patientId: patient.id,
        providerId: provider.id,
        practiceId: practice.id,
        authorId: admin.id,
        status: EncounterStatus.SIGNED,
        chiefComplaint: "Synthetic annual wellness visit for ERA reversal testing",
        assessment: "Synthetic test encounter; no real patient information",
        plan: "Synthetic test only. No clinical care provided.",
        signedAt: new Date("2026-11-20T14:30:00.000Z"),
      },
    });

    const charge = await tx.charge.create({
      data: {
        id: IDS.charge,
        encounterId: encounter.id,
        patientId: patient.id,
        providerId: provider.id,
        practiceId: practice.id,
        status: ChargeStatus.POSTED,
        currency: "USD",
        subtotal: 150,
        totalAmount: 150,
        createdById: admin.id,
        reviewedById: admin.id,
        postedById: admin.id,
        reviewedAt: new Date("2026-11-20T14:35:00.000Z"),
        postedAt: new Date("2026-11-20T14:35:00.000Z"),
        notes: "Synthetic charge for ERA reversal validation only.",
      },
    });

    const chargeLine = await tx.chargeLine.create({
      data: {
        id: IDS.chargeLine,
        chargeId: charge.id,
        procedureCodeId: procedure.id,
        sequence: 1,
        codeSnapshot: "DEMO-AWV",
        descriptionSnapshot: "Synthetic annual wellness visit",
        units: 1,
        unitPrice: 150,
        lineTotal: 150,
      },
    });

    const insuranceClaim = await tx.insuranceClaim.create({
      data: {
        id: IDS.insuranceClaim,
        practiceId: practice.id,
        patientId: patient.id,
        payerId: payer.id,
        patientControlNumber: "CF-ERA-REV-CLAIM-001",
        payerClaimControlNumber: "PCN-ERA-REV-TEST-001",
        status: InsuranceClaimStatus.SUBMITTED,
        totalBilled: 150,
        currency: "USD",
        submittedAt: new Date("2026-11-20T15:00:00.000Z"),
      },
    });

    await tx.insuranceClaimLine.create({
      data: {
        id: IDS.insuranceClaimLine,
        claimId: insuranceClaim.id,
        chargeLineId: chargeLine.id,
        submittedAmount: 150,
        units: 1,
        serviceDateFrom: new Date("2026-11-20T00:00:00.000Z"),
        serviceDateThrough: new Date("2026-11-20T00:00:00.000Z"),
      },
    });
  });

  const result = await prisma.patient.findUnique({
    where: { id: IDS.patient },
    include: {
      appointments: true,
      encounters: { include: { charge: { include: { lines: true } } } },
      insuranceClaims: { include: { lines: true, payer: true } },
    },
  });

  console.log("Synthetic ERA reversal fixture created successfully.");
  console.log(JSON.stringify({
    patient: {
      id: result.id,
      mrn: result.mrn,
      name: `${result.firstName} ${result.lastName}`,
      dateOfBirth: result.dateOfBirth.toISOString().slice(0, 10),
      phone: result.phone,
    },
    appointmentId: result.appointments[0]?.id,
    encounterId: result.encounters[0]?.id,
    encounterStatus: result.encounters[0]?.status,
    chargeId: result.encounters[0]?.charge?.id,
    chargeStatus: result.encounters[0]?.charge?.status,
    chargeAmount: result.encounters[0]?.charge?.totalAmount.toString(),
    chargeLineId: result.encounters[0]?.charge?.lines[0]?.id,
    procedureCode: result.encounters[0]?.charge?.lines[0]?.codeSnapshot,
    insuranceClaimId: result.insuranceClaims[0]?.id,
    patientControlNumber: result.insuranceClaims[0]?.patientControlNumber,
    payer: result.insuranceClaims[0]?.payer?.name,
    claimAmount: result.insuranceClaims[0]?.totalBilled.toString(),
    paymentsCreated: 0,
    allocationsCreated: 0,
    adjustmentsCreated: 0,
    eraImportCreated: false,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("Synthetic ERA reversal fixture failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
