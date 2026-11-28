
const { PrismaClient, Prisma } = require("@prisma/client");

const prisma = new PrismaClient();

const IDS = {
  patient: "careflow-era-test-patient-001",
  appointment: "careflow-era-test-appointment-001",
  encounter: "careflow-era-test-encounter-001",
  charge: "careflow-era-test-charge-001",
  chargeLine: "careflow-era-test-charge-line-001",
  insuranceClaim: "careflow-era-test-insurance-claim-001",
  insuranceClaimLine: "careflow-era-test-claim-line-001",
};

async function main() {
  const practice = await prisma.practice.findUnique({
    where: { id: "demo-practice" },
  });
  if (!practice) throw new Error("Demo practice not found.");

  const provider = await prisma.provider.findUnique({
    where: { id: "demo-provider-profile" },
  });
  const billingUser = await prisma.user.findUnique({
    where: { id: "demo-billing" },
  });
  const payer = await prisma.insurancePayer.findFirst({
    where: {
      practiceId: practice.id,
      payerCode: "DEMO-PAYER",
      active: true,
    },
  });
  const procedure = await prisma.procedureCode.findUnique({
    where: { code: "DEMO-AWV" },
  });

  if (!provider || !billingUser || !payer || !procedure) {
    throw new Error("Required demo provider, billing user, payer or procedure code is missing.");
  }
  if (!procedure.isActive) throw new Error("DEMO-AWV is not active.");

  const patient = await prisma.patient.upsert({
    where: { mrn: "CF-ERA-TEST-001" },
    update: {},
    create: {
      id: IDS.patient,
      mrn: "CF-ERA-TEST-001",
      firstName: "Morgan",
      lastName: "Testpatient",
      dateOfBirth: new Date("1985-05-15T00:00:00.000Z"),
      phone: "(555) 010-0199",
      practiceId: practice.id,
    },
  });

  if (patient.id !== IDS.patient) {
    throw new Error("Test MRN belongs to a different record.");
  }

  const appointment = await prisma.appointment.upsert({
    where: { id: IDS.appointment },
    update: {},
    create: {
      id: IDS.appointment,
      startsAt: new Date(),
      durationMin: 30,
      visitType: "Annual wellness",
      status: "COMPLETED",
      patientId: patient.id,
      providerId: provider.id,
      practiceId: practice.id,
    },
  });

  const encounter = await prisma.clinicalEncounter.upsert({
    where: { appointmentId: appointment.id },
    update: {},
    create: {
      id: IDS.encounter,
      appointmentId: appointment.id,
      patientId: patient.id,
      providerId: provider.id,
      practiceId: practice.id,
      authorId: billingUser.id,
      status: "SIGNED",
      chiefComplaint: "Synthetic ERA posting test",
      assessment: "Synthetic annual wellness encounter",
      plan: "Demo fixture only",
      signedAt: new Date(),
    },
  });

  if (encounter.id !== IDS.encounter) {
    throw new Error("Appointment already has a different encounter.");
  }

  const charge = await prisma.charge.upsert({
    where: { encounterId: encounter.id },
    update: {},
    create: {
      id: IDS.charge,
      encounterId: encounter.id,
      patientId: patient.id,
      providerId: provider.id,
      practiceId: practice.id,
      status: "POSTED",
      currency: "USD",
      subtotal: new Prisma.Decimal("150.00"),
      totalAmount: new Prisma.Decimal("150.00"),
      createdById: billingUser.id,
      reviewedById: billingUser.id,
      postedById: billingUser.id,
      generatedAt: new Date(),
      reviewedAt: new Date(),
      postedAt: new Date(),
      notes: "Synthetic ERA posting fixture. No real patient data.",
    },
  });

  if (charge.id !== IDS.charge) {
    throw new Error("Encounter already has a different charge.");
  }

  const chargeLine = await prisma.chargeLine.upsert({
    where: {
      chargeId_sequence: {
        chargeId: charge.id,
        sequence: 1,
      },
    },
    update: {},
    create: {
      id: IDS.chargeLine,
      chargeId: charge.id,
      procedureCodeId: procedure.id,
      sequence: 1,
      codeSnapshot: "DEMO-AWV",
      descriptionSnapshot: "Annual wellness visit",
      units: 1,
      unitPrice: new Prisma.Decimal("150.00"),
      lineTotal: new Prisma.Decimal("150.00"),
    },
  });

  const insuranceClaim = await prisma.insuranceClaim.upsert({
    where: {
      practiceId_patientControlNumber: {
        practiceId: practice.id,
        patientControlNumber: "CF-ERA-TEST-CLAIM-001",
      },
    },
    update: {},
    create: {
      id: IDS.insuranceClaim,
      practiceId: practice.id,
      patientId: patient.id,
      payerId: payer.id,
      patientControlNumber: "CF-ERA-TEST-CLAIM-001",
      payerClaimControlNumber: "PCN-ERA-TEST-001",
      status: "SUBMITTED",
      totalBilled: new Prisma.Decimal("150.00"),
      currency: "USD",
      submittedAt: new Date(),
    },
  });

  if (insuranceClaim.id !== IDS.insuranceClaim) {
    throw new Error("Claim control number belongs to another record.");
  }

  const claimLine = await prisma.insuranceClaimLine.upsert({
    where: {
      claimId_chargeLineId: {
        claimId: insuranceClaim.id,
        chargeLineId: chargeLine.id,
      },
    },
    update: {},
    create: {
      id: IDS.insuranceClaimLine,
      claimId: insuranceClaim.id,
      chargeLineId: chargeLine.id,
      submittedAmount: new Prisma.Decimal("150.00"),
      units: new Prisma.Decimal("1"),
      serviceDateFrom: new Date(),
      serviceDateThrough: new Date(),
    },
  });

  console.log("\nSynthetic ERA posting fixture created/verified.");
  console.log({
    patient: `${patient.firstName} ${patient.lastName}`,
    mrn: patient.mrn,
    patientId: patient.id,
    appointmentId: appointment.id,
    encounterId: encounter.id,
    encounterStatus: encounter.status,
    chargeId: charge.id,
    chargeStatus: charge.status,
    chargeLineId: chargeLine.id,
    procedureCode: chargeLine.codeSnapshot,
    billedAmount: chargeLine.lineTotal.toString(),
    insuranceClaimId: insuranceClaim.id,
    claimLineId: claimLine.id,
    payer: payer.payerCode,
  });

  console.log("No payments, allocations, adjustments or ERA posting records created.");
}

main()
  .catch((error) => {
    console.error("Fixture creation failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });