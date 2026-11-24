
"use server";

import { EncounterStatus, Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

const CLINICAL_ROLES = ["ADMIN", "PROVIDER", "CLINICAL_STAFF"];

const clinicalNoteSchema = z.object({
  encounterId: z.string().min(1),
  chiefComplaint: z.string().trim().max(2000),
  historyOfPresentIllness: z.string().trim().max(10000),
  reviewOfSystems: z.string().trim().max(10000),
  physicalExam: z.string().trim().max(10000),
  assessment: z.string().trim().max(10000),
  diagnosis: z.string().trim().max(5000),
  plan: z.string().trim().max(10000),
  systolic: z.string().optional(),
  diastolic: z.string().optional(),
  pulse: z.string().optional(),
  temperature: z.string().optional(),
  respiratoryRate: z.string().optional(),
  oxygenSaturation: z.string().optional(),
  heightCm: z.string().optional(),
  weightKg: z.string().optional(),
});

type MutationResult =
  | "success"
  | "not-found"
  | "signed"
  | "required-sections"
  | "provider-access";

function optionalNumber(value?: string) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function verifyProviderAssignment(
  user: { role: string; practiceId: string; displayName: string },
  providerId: string
) {
  if (user.role !== "PROVIDER") return true;

  const provider = await db.provider.findFirst({
    where: {
      id: providerId,
      practiceId: user.practiceId,
      active: true,
      displayName: user.displayName,
    },
    select: { id: true },
  });

  return Boolean(provider);
}

async function lockEncounter(
  tx: Prisma.TransactionClient,
  encounterId: string,
  practiceId: string
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "ClinicalEncounter"
    WHERE "id" = ${encounterId}
      AND "practiceId" = ${practiceId}
    FOR UPDATE
  `;

  if (rows.length === 0) return null;

  return tx.clinicalEncounter.findFirst({
    where: { id: encounterId, practiceId },
    select: {
      id: true,
      status: true,
      providerId: true,
      patientId: true,
      appointmentId: true,
      chiefComplaint: true,
      assessment: true,
      plan: true,
    },
  });
}

function redirectForResult(
  encounterId: string,
  result: MutationResult
): never {
  switch (result) {
    case "not-found":
      redirect("/clinical?error=notfound");
    case "signed":
      redirect(`/clinical/${encounterId}?error=signed`);
    case "required-sections":
      redirect(`/clinical/${encounterId}?error=required-sections`);
    case "provider-access":
      redirect("/clinical?error=provider-access");
    default:
      redirect(`/clinical/${encounterId}?error=update-failed`);
  }
}

function handleMutationError(
  error: unknown,
  encounterId: string
): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  ) {
    redirect(`/clinical/${encounterId}?error=concurrent-update`);
  }

  throw error;
}

export async function startClinicalEncounter(formData: FormData) {
  const user = await currentUser();

  if (!user || !user.active || !CLINICAL_ROLES.includes(user.role)) {
    redirect("/clinical?error=unauthorized");
  }

  const appointmentId = String(formData.get("appointmentId") ?? "");
  if (!appointmentId) redirect("/clinical?error=invalid");

  const appointment = await db.appointment.findFirst({
    where: {
      id: appointmentId,
      practiceId: user.practiceId,
      status: "CHECKED_IN",
    },
    include: {
      patient: true,
      provider: true,
      encounter: true,
    },
  });

  if (!appointment) {
    redirect("/clinical?error=not-checked-in");
  }

  if (!(await verifyProviderAssignment(user, appointment.providerId))) {
    redirect("/clinical?error=provider-access");
  }

  if (appointment.encounter) {
    redirect(`/clinical/${appointment.encounter.id}`);
  }

  let createdEncounterId: string;

  try {
    const created = await db.$transaction(async (tx) => {
      const encounter = await tx.clinicalEncounter.create({
        data: {
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          providerId: appointment.providerId,
          practiceId: user.practiceId,
          authorId: user.id,
          status: EncounterStatus.DRAFT,
        },
      });

      await tx.auditEvent.create({
        data: {
          action: "ENCOUNTER_CREATED",
          entityType: "ClinicalEncounter",
          entityId: encounter.id,
          actorId: user.id,
          practiceId: user.practiceId,
          metadata: {
            appointmentId: appointment.id,
            patientId: appointment.patientId,
            providerId: appointment.providerId,
          },
        },
      });

      return encounter;
    });

    createdEncounterId = created.id;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      redirect("/clinical?error=encounter-exists");
    }
    throw error;
  }

  redirect(`/clinical/${createdEncounterId}`);
}

export async function saveClinicalEncounter(formData: FormData) {
  const user = await currentUser();

  if (!user || !user.active || !CLINICAL_ROLES.includes(user.role)) {
    redirect("/clinical?error=unauthorized");
  }

  const parsed = clinicalNoteSchema.safeParse({
    encounterId: formData.get("encounterId"),
    chiefComplaint: formData.get("chiefComplaint") ?? "",
    historyOfPresentIllness: formData.get("historyOfPresentIllness") ?? "",
    reviewOfSystems: formData.get("reviewOfSystems") ?? "",
    physicalExam: formData.get("physicalExam") ?? "",
    assessment: formData.get("assessment") ?? "",
    diagnosis: formData.get("diagnosis") ?? "",
    plan: formData.get("plan") ?? "",
    systolic: formData.get("systolic"),
    diastolic: formData.get("diastolic"),
    pulse: formData.get("pulse"),
    temperature: formData.get("temperature"),
    respiratoryRate: formData.get("respiratoryRate"),
    oxygenSaturation: formData.get("oxygenSaturation"),
    heightCm: formData.get("heightCm"),
    weightKg: formData.get("weightKg"),
  });

  if (!parsed.success) redirect("/clinical?error=invalid");

  const data = parsed.data;

  const encounter = await db.clinicalEncounter.findFirst({
    where: {
      id: data.encounterId,
      practiceId: user.practiceId,
    },
    select: {
      id: true,
      status: true,
      providerId: true,
    },
  });

  if (!encounter) redirect("/clinical?error=notfound");

  if (encounter.status === EncounterStatus.SIGNED) {
    redirect(`/clinical/${encounter.id}?error=signed`);
  }

  if (!(await verifyProviderAssignment(user, encounter.providerId))) {
    redirect("/clinical?error=provider-access");
  }

  const vitalFields = {
    systolic: data.systolic,
    diastolic: data.diastolic,
    pulse: data.pulse,
    temperature: data.temperature,
    respiratoryRate: data.respiratoryRate,
    oxygenSaturation: data.oxygenSaturation,
    heightCm: data.heightCm,
    weightKg: data.weightKg,
  };

  const vitals: Record<string, number> = {};

  for (const [key, value] of Object.entries(vitalFields)) {
    if (value?.trim()) {
      const parsedValue = optionalNumber(value);

      if (parsedValue === null || parsedValue === undefined) {
        redirect(`/clinical/${encounter.id}?error=invalid-vitals`);
      }

      vitals[key] = parsedValue;
    }
  }

  if (
    (vitals.systolic !== undefined && vitals.systolic > 300) ||
    (vitals.diastolic !== undefined && vitals.diastolic > 200) ||
    (vitals.pulse !== undefined && vitals.pulse > 300) ||
    (vitals.temperature !== undefined && vitals.temperature > 50) ||
    (vitals.respiratoryRate !== undefined && vitals.respiratoryRate > 100) ||
    (vitals.oxygenSaturation !== undefined && vitals.oxygenSaturation > 100) ||
    (vitals.heightCm !== undefined && vitals.heightCm > 300) ||
    (vitals.weightKg !== undefined && vitals.weightKg > 700)
  ) {
    redirect(`/clinical/${encounter.id}?error=invalid-vitals`);
  }

  let result: MutationResult;

  try {
    result = await db.$transaction(async (tx) => {
      const locked = await lockEncounter(
        tx,
        encounter.id,
        user.practiceId
      );

      if (!locked) return "not-found";
      if (locked.status === EncounterStatus.SIGNED) return "signed";

      await tx.clinicalEncounter.update({
        where: { id: locked.id },
        data: {
          chiefComplaint: data.chiefComplaint || null,
          historyOfPresentIllness: data.historyOfPresentIllness || null,
          reviewOfSystems: data.reviewOfSystems || null,
          physicalExam: data.physicalExam || null,
          assessment: data.assessment || null,
          diagnosis: data.diagnosis || null,
          plan: data.plan || null,
          vitals: vitals as Prisma.InputJsonValue,
          status: EncounterStatus.IN_PROGRESS,
        },
      });

      await tx.auditEvent.create({
        data: {
          action: "ENCOUNTER_UPDATED",
          entityType: "ClinicalEncounter",
          entityId: locked.id,
          actorId: user.id,
          practiceId: user.practiceId,
          metadata: {
            status: "IN_PROGRESS",
            sectionsUpdated: true,
          },
        },
      });

      return "success";
    });
  } catch (error) {
    handleMutationError(error, encounter.id);
  }

  if (result !== "success") {
    redirectForResult(encounter.id, result);
  }

  redirect(`/clinical/${encounter.id}?saved=1`);
}

export async function signClinicalEncounter(formData: FormData) {
  const user = await currentUser();

  if (!user || !user.active || user.role !== "PROVIDER") {
    redirect("/clinical?error=signing-unauthorized");
  }

  const encounterId = String(formData.get("encounterId") ?? "");
  if (!encounterId) redirect("/clinical?error=invalid");

  const encounter = await db.clinicalEncounter.findFirst({
    where: {
      id: encounterId,
      practiceId: user.practiceId,
    },
    select: {
      id: true,
      providerId: true,
    },
  });

  if (!encounter) redirect("/clinical?error=notfound");

  if (!(await verifyProviderAssignment(user, encounter.providerId))) {
    redirect("/clinical?error=provider-access");
  }

  let result: MutationResult;

  try {
    result = await db.$transaction(async (tx) => {
      const locked = await lockEncounter(
        tx,
        encounter.id,
        user.practiceId
      );

      if (!locked) return "not-found";
      if (locked.status === EncounterStatus.SIGNED) return "signed";

      if (locked.providerId !== encounter.providerId) {
        return "provider-access";
      }

      if (
        !locked.chiefComplaint?.trim() ||
        !locked.assessment?.trim() ||
        !locked.plan?.trim()
      ) {
        return "required-sections";
      }

      // Resolve the linked appointment and its visit type.
      const appointment = await tx.appointment.findFirst({
        where: {
          id: locked.appointmentId,
          practiceId: user.practiceId,
        },
        select: {
          visitType: true,
          patientId: true,
          providerId: true,
        },
      });

      if (!appointment) {
        throw new Error("Charge generation failed: appointment not found.");
      }

      // Resolve the synthetic procedure mapping.
      const procedure = await tx.procedureCode.findFirst({
        where: {
          visitTypeMapping: appointment.visitType,
          isActive: true,
        },
      });

      if (!procedure) {
        throw new Error(
          `No active procedure code is configured for visit type: ${appointment.visitType}`
        );
      }

      // Find the active practice fee schedule effective today.
      const now = new Date();

      const feeSchedule = await tx.feeSchedule.findFirst({
        where: {
          practiceId: user.practiceId,
          isActive: true,
          currency: "USD",
          effectiveFrom: { lte: now },
          OR: [
            { effectiveThrough: null },
            { effectiveThrough: { gte: now } },
          ],
        },
        orderBy: {
          effectiveFrom: "desc",
        },
        include: {
          items: {
            where: {
              procedureCodeId: procedure.id,
            },
          },
        },
      });

      if (!feeSchedule || feeSchedule.items.length === 0) {
        throw new Error(
          `No active USD fee is configured for procedure ${procedure.code}.`
        );
      }

      // Enforce one charge per encounter.
      const existingCharge = await tx.charge.findUnique({
        where: { encounterId: locked.id },
        select: { id: true },
      });

      if (existingCharge) {
        throw new Error(
          "A charge already exists for this encounter. Signing was stopped."
        );
      }

      const feeItem = feeSchedule.items[0];
      const units = 1;
      const lineTotal = feeItem.unitPrice.mul(units);

      const charge = await tx.charge.create({
        data: {
          encounterId: locked.id,
          patientId: appointment.patientId,
          providerId: appointment.providerId,
          practiceId: user.practiceId,
          feeScheduleId: feeSchedule.id,
          status: "DRAFT",
          currency: "USD",
          subtotal: lineTotal,
          totalAmount: lineTotal,
          createdById: user.id,
          lines: {
            create: {
              procedureCodeId: procedure.id,
              feeScheduleItemId: feeItem.id,
              sequence: 1,
              codeSnapshot: procedure.code,
              descriptionSnapshot: procedure.description,
              units,
              unitPrice: feeItem.unitPrice,
              lineTotal,
            },
          },
        },
      });

      // Sign the encounter in the same transaction as charge creation.
      await tx.clinicalEncounter.update({
        where: { id: locked.id },
        data: {
          status: EncounterStatus.SIGNED,
          signedAt: now,
        },
      });

      await tx.auditEvent.createMany({
        data: [
          {
            action: "ENCOUNTER_SIGNED",
            entityType: "ClinicalEncounter",
            entityId: locked.id,
            actorId: user.id,
            practiceId: user.practiceId,
            metadata: {
              signedBy: user.displayName,
            },
          },
          {
            action: "CHARGE_CREATED",
            entityType: "Charge",
            entityId: charge.id,
            actorId: user.id,
            practiceId: user.practiceId,
            metadata: {
              encounterId: locked.id,
              procedureCode: procedure.code,
              units,
              currency: "USD",
              amount: lineTotal.toFixed(2),
              status: "DRAFT",
            },
          },
        ],
      });

      return "success";
    });
  } catch (error) {
    handleMutationError(error, encounter.id);
  }

  if (result !== "success") {
    redirectForResult(encounter.id, result);
  }

  redirect(`/clinical/${encounter.id}?signed=1&charge=draft`);
}