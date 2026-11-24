
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const procedures = [
  {
    code: "DEMO-AWV",
    description: "Annual wellness visit",
    category: "WELLNESS",
    visitTypeMapping: "Annual wellness",
    unitPrice: new Prisma.Decimal("150.00"),
  },
  {
    code: "DEMO-EST",
    description: "Established patient follow-up",
    category: "OFFICE_VISIT",
    visitTypeMapping: "Follow-up",
    unitPrice: new Prisma.Decimal("110.00"),
  },
  {
    code: "DEMO-NEW",
    description: "New patient consultation",
    category: "OFFICE_VISIT",
    visitTypeMapping: "New patient",
    unitPrice: new Prisma.Decimal("180.00"),
  },
];

async function main() {
  const practice = await prisma.practice.findUnique({
    where: { id: "demo-practice" },
  });

  if (!practice) {
    throw new Error("Demo practice not found.");
  }

  const effectiveFrom = new Date("2026-01-01T00:00:00.000Z");

  const feeSchedule = await prisma.feeSchedule.upsert({
    where: {
      id: "demo-fee-schedule-2026",
    },
    update: {},
    create: {
      id: "demo-fee-schedule-2026",
      name: "Harborview Demo Fee Schedule 2026",
      currency: "USD",
      effectiveFrom,
      effectiveThrough: null,
      isActive: true,
      practiceId: practice.id,
    },
  });

  for (const procedure of procedures) {
    const { unitPrice, ...procedureData } = procedure;

    const savedProcedure = await prisma.procedureCode.upsert({
      where: { code: procedure.code },
      update: {
        description: procedure.description,
        category: procedure.category,
        visitTypeMapping: procedure.visitTypeMapping,
        isActive: true,
      },
      create: {
        ...procedureData,
      },
    });

    await prisma.feeScheduleItem.upsert({
      where: {
        feeScheduleId_procedureCodeId: {
          feeScheduleId: feeSchedule.id,
          procedureCodeId: savedProcedure.id,
        },
      },
      update: {
        unitPrice,
      },
      create: {
        feeScheduleId: feeSchedule.id,
        procedureCodeId: savedProcedure.id,
        unitPrice,
      },
    });
  }

  console.log("RCM catalog and fee schedule configured.");

  for (const procedure of procedures) {
    console.log(
      `${procedure.code}: $${procedure.unitPrice.toFixed(2)}`
    );
  }
}

main()
  .catch((error) => {
    console.error("RCM catalog setup failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });