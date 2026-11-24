
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const corrections = [
  {
    mrn: "CF-10001",
    visitType: "Annual wellness",
    time: "2026-11-23T14:00:00.000Z",
  },
  {
    mrn: "CF-10002",
    visitType: "Follow-up",
    time: "2026-11-23T16:00:00.000Z",
  },
  {
    mrn: "CF-10003",
    visitType: "New patient",
    time: "2026-11-23T18:00:00.000Z",
  },
];

async function main() {
  const practiceId = "demo-practice";
  const providerId = "demo-provider-profile";

  await prisma.$transaction(async (tx) => {
    for (const correction of corrections) {
      const patient = await tx.patient.findUnique({
        where: { mrn: correction.mrn },
        select: { id: true, firstName: true, lastName: true },
      });

      if (!patient) {
        throw new Error(`Patient not found: ${correction.mrn}`);
      }

      const appointments = await tx.appointment.findMany({
        where: {
          practiceId,
          providerId,
          patientId: patient.id,
          visitType: correction.visitType,
          startsAt: {
            gte: new Date("2026-11-23T00:00:00.000Z"),
            lt: new Date("2026-11-24T00:00:00.000Z"),
          },
        },
      });

      if (appointments.length !== 1) {
        throw new Error(
          `Expected exactly one matching appointment for ${correction.mrn}; found ${appointments.length}. No correction applied to this record.`
        );
      }

      const appointment = appointments[0];

      console.log(
        `${patient.firstName} ${patient.lastName}: ` +
        `${appointment.startsAt.toISOString()} -> ${correction.time}`
      );

      await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          startsAt: new Date(correction.time),
        },
      });
    }
  });

  console.log("Original demo appointment times corrected.");
  console.log("Appointment statuses and associations were preserved.");
}

main()
  .catch((error) => {
    console.error("Correction failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });