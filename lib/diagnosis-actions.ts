
"use server";

import { EncounterStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

const CLINICAL_ROLES = ["ADMIN", "PROVIDER", "CLINICAL_STAFF"];

type DiagnosisTransactionResult =
  | "success"
  | "not-found"
  | "signed"
  | "invalid"
  | "duplicate"
  | "already-primary";

async function authorizedEncounter(encounterId: string) {
  const user = await currentUser();

  if (!user || !user.active || !CLINICAL_ROLES.includes(user.role)) {
    return { user: null, encounter: null };
  }

  const encounter = await db.clinicalEncounter.findFirst({
    where: {
      id: encounterId,
      practiceId: user.practiceId,
    },
    select: {
      id: true,
      status: true,
      providerId: true,
      practiceId: true,
    },
  });

  if (!encounter) return { user, encounter: null };

  if (user.role === "PROVIDER") {
    const provider = await db.provider.findFirst({
      where: {
        id: encounter.providerId,
        practiceId: user.practiceId,
        active: true,
        displayName: user.displayName,
      },
      select: { id: true },
    });

    if (!provider) return { user: null, encounter: null };
  }

  return { user, encounter };
}

/**
 * Locks the encounter row for the duration of a transaction.
 * Diagnosis changes and encounter signing must use this same lock.
 */
async function lockEncounter(
  tx: Prisma.TransactionClient,
  encounterId: string,
  practiceId: string
) {
  const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "ClinicalEncounter"
    WHERE "id" = ${encounterId}
      AND "practiceId" = ${practiceId}
    FOR UPDATE
  `;

  if (lockedRows.length === 0) return null;

  return tx.clinicalEncounter.findFirst({
    where: {
      id: encounterId,
      practiceId,
    },
    select: {
      id: true,
      status: true,
    },
  });
}

/**
 * Reassigns sequence numbers as 1, 2, 3...
 * Temporary negative values avoid collisions with the unique constraint.
 */
async function normalizeDiagnosisSequences(
  tx: Prisma.TransactionClient,
  diagnoses: Array<{ id: string }>
) {
  for (let index = 0; index < diagnoses.length; index++) {
    await tx.encounterDiagnosis.update({
      where: { id: diagnoses[index].id },
      data: { sequence: -(index + 1) },
    });
  }

  for (let index = 0; index < diagnoses.length; index++) {
    await tx.encounterDiagnosis.update({
      where: { id: diagnoses[index].id },
      data: { sequence: index + 1 },
    });
  }
}

function redirectForTransactionError(
  encounterId: string,
  result: DiagnosisTransactionResult
): never {
  switch (result) {
    case "not-found":
      redirect("/clinical?error=notfound");
    case "signed":
      redirect(`/clinical/${encounterId}?error=signed`);
    case "invalid":
      redirect(`/clinical/${encounterId}?error=diagnosis-not-found`);
    case "duplicate":
      redirect(`/clinical/${encounterId}?error=diagnosis-duplicate`);
    default:
      redirect(`/clinical/${encounterId}?error=diagnosis-update`);
  }
}

function handleDatabaseError(error: unknown, encounterId: string): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    redirect(`/clinical/${encounterId}?error=diagnosis-duplicate`);
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  ) {
    redirect(`/clinical/${encounterId}?error=concurrent-update`);
  }

  throw error;
}

export async function searchDiagnosisCodes(
  encounterId: string,
  searchText: string
) {
  const searchSchema = z.object({
    encounterId: z.string().min(1),
    searchText: z.string().trim().min(2).max(100),
  });

  const parsed = searchSchema.safeParse({ encounterId, searchText });

  if (!parsed.success) return [];

  const { user, encounter } = await authorizedEncounter(
    parsed.data.encounterId
  );

  if (!user || !encounter || encounter.status === EncounterStatus.SIGNED) {
    return [];
  }

  const term = parsed.data.searchText;

  return db.diagnosisCode.findMany({
    where: {
      fiscalYear: 2027,
      billable: true,
      isActive: true,
      OR: [
        { code: { startsWith: term.toUpperCase() } },
        { description: { contains: term, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      code: true,
      description: true,
    },
    orderBy: { code: "asc" },
    take: 20,
  });
}

export async function addEncounterDiagnosis(formData: FormData) {
  const parsed = z.object({
    encounterId: z.string().min(1),
    diagnosisCodeId: z.string().min(1),
  }).safeParse({
    encounterId: formData.get("encounterId"),
    diagnosisCodeId: formData.get("diagnosisCodeId"),
  });

  if (!parsed.success) redirect("/clinical?error=invalid");

  const { user, encounter } = await authorizedEncounter(
    parsed.data.encounterId
  );

  if (!user || !encounter) {
    redirect("/clinical?error=provider-access");
  }

  const code = await db.diagnosisCode.findFirst({
    where: {
      id: parsed.data.diagnosisCodeId,
      fiscalYear: 2027,
      billable: true,
      isActive: true,
    },
    select: {
      id: true,
      code: true,
      description: true,
    },
  });

  if (!code) {
    redirect(`/clinical/${encounter.id}?error=diagnosis-code`);
  }

  let result: DiagnosisTransactionResult;

  try {
    result = await db.$transaction(async (tx) => {
      const lockedEncounter = await lockEncounter(
        tx,
        encounter.id,
        user.practiceId
      );

      if (!lockedEncounter) return "not-found";
      if (lockedEncounter.status === EncounterStatus.SIGNED) return "signed";

      const existing = await tx.encounterDiagnosis.findMany({
        where: {
          encounterId: encounter.id,
          practiceId: user.practiceId,
        },
        select: {
          id: true,
          sequence: true,
        },
        orderBy: { sequence: "asc" },
      });

      if (existing.some((item) => item.id === code.id)) {
        // Diagnosis IDs and diagnosis-code IDs are different.
        // The duplicate check below uses diagnosisCodeId instead.
      }

      const duplicate = await tx.encounterDiagnosis.findFirst({
        where: {
          encounterId: encounter.id,
          diagnosisCodeId: code.id,
          practiceId: user.practiceId,
        },
        select: { id: true },
      });

      if (duplicate) return "duplicate";

      const nextSequence =
        existing.length === 0
          ? 1
          : Math.max(...existing.map((item) => item.sequence)) + 1;

      await tx.encounterDiagnosis.create({
        data: {
          encounterId: encounter.id,
          diagnosisCodeId: code.id,
          sequence: nextSequence,
          practiceId: user.practiceId,
          addedById: user.id,
        },
      });

      const updated = await tx.encounterDiagnosis.findMany({
        where: {
          encounterId: encounter.id,
          practiceId: user.practiceId,
        },
        select: { id: true },
        orderBy: { sequence: "asc" },
      });

      await normalizeDiagnosisSequences(tx, updated);

      await tx.auditEvent.create({
        data: {
          action: "DIAGNOSIS_ADDED",
          entityType: "ClinicalEncounter",
          entityId: encounter.id,
          actorId: user.id,
          practiceId: user.practiceId,
          metadata: {
            code: code.code,
            description: code.description,
            diagnosisType: existing.length === 0 ? "PRIMARY" : "SECONDARY",
          },
        },
      });

      return "success";
    });
  } catch (error) {
    handleDatabaseError(error, encounter.id);
  }

  if (result !== "success") {
    redirectForTransactionError(encounter.id, result);
  }

  revalidatePath(`/clinical/${encounter.id}`);
  revalidatePath("/patients");
  redirect(`/clinical/${encounter.id}?diagnosisAdded=1`);
}

export async function promoteEncounterDiagnosis(formData: FormData) {
  const parsed = z.object({
    encounterId: z.string().min(1),
    diagnosisId: z.string().min(1),
  }).safeParse({
    encounterId: formData.get("encounterId"),
    diagnosisId: formData.get("diagnosisId"),
  });

  if (!parsed.success) redirect("/clinical?error=invalid");

  const { user, encounter } = await authorizedEncounter(
    parsed.data.encounterId
  );

  if (!user || !encounter) {
    redirect("/clinical?error=provider-access");
  }

  let result: DiagnosisTransactionResult;

  try {
    result = await db.$transaction(async (tx) => {
      const lockedEncounter = await lockEncounter(
        tx,
        encounter.id,
        user.practiceId
      );

      if (!lockedEncounter) return "not-found";
      if (lockedEncounter.status === EncounterStatus.SIGNED) return "signed";

      const selected = await tx.encounterDiagnosis.findFirst({
        where: {
          id: parsed.data.diagnosisId,
          encounterId: encounter.id,
          practiceId: user.practiceId,
        },
        include: {
          diagnosisCode: {
            select: { code: true, description: true },
          },
        },
      });

      if (!selected) return "invalid";
      if (selected.sequence === 1) return "already-primary";

      const diagnoses = await tx.encounterDiagnosis.findMany({
        where: {
          encounterId: encounter.id,
          practiceId: user.practiceId,
        },
        select: { id: true, sequence: true },
        orderBy: [
          { sequence: "asc" },
          { id: "asc" },
        ],
      });

      const reordered = [
        { id: selected.id },
        ...diagnoses
          .filter((item) => item.id !== selected.id)
          .map((item) => ({ id: item.id })),
      ];

      await normalizeDiagnosisSequences(tx, reordered);

      await tx.auditEvent.create({
        data: {
          action: "DIAGNOSIS_PRIMARY_CHANGED",
          entityType: "ClinicalEncounter",
          entityId: encounter.id,
          actorId: user.id,
          practiceId: user.practiceId,
          metadata: {
            diagnosisId: selected.id,
            code: selected.diagnosisCode.code,
            description: selected.diagnosisCode.description,
          },
        },
      });

      return "success";
    });
  } catch (error) {
    handleDatabaseError(error, encounter.id);
  }

  if (result === "already-primary") {
    redirect(`/clinical/${encounter.id}?diagnosisAlreadyPrimary=1`);
  }

  if (result !== "success") {
    redirectForTransactionError(encounter.id, result);
  }

  revalidatePath(`/clinical/${encounter.id}`);
  redirect(`/clinical/${encounter.id}?diagnosisPromoted=1`);
}

export async function removeEncounterDiagnosis(formData: FormData) {
  const parsed = z.object({
    encounterId: z.string().min(1),
    diagnosisId: z.string().min(1),
  }).safeParse({
    encounterId: formData.get("encounterId"),
    diagnosisId: formData.get("diagnosisId"),
  });

  if (!parsed.success) redirect("/clinical?error=invalid");

  const { user, encounter } = await authorizedEncounter(
    parsed.data.encounterId
  );

  if (!user || !encounter) {
    redirect("/clinical?error=provider-access");
  }

  let result: DiagnosisTransactionResult;

  try {
    result = await db.$transaction(async (tx) => {
      const lockedEncounter = await lockEncounter(
        tx,
        encounter.id,
        user.practiceId
      );

      if (!lockedEncounter) return "not-found";
      if (lockedEncounter.status === EncounterStatus.SIGNED) return "signed";

      const selected = await tx.encounterDiagnosis.findFirst({
        where: {
          id: parsed.data.diagnosisId,
          encounterId: encounter.id,
          practiceId: user.practiceId,
        },
        include: {
          diagnosisCode: {
            select: {
              code: true,
              description: true,
            },
          },
        },
      });

      if (!selected) return "invalid";

      await tx.encounterDiagnosis.delete({
        where: { id: selected.id },
      });

      const remaining = await tx.encounterDiagnosis.findMany({
        where: {
          encounterId: encounter.id,
          practiceId: user.practiceId,
        },
        select: { id: true },
        orderBy: [
          { sequence: "asc" },
          { id: "asc" },
        ],
      });

      await normalizeDiagnosisSequences(tx, remaining);

      await tx.auditEvent.create({
        data: {
          action: "DIAGNOSIS_REMOVED",
          entityType: "ClinicalEncounter",
          entityId: encounter.id,
          actorId: user.id,
          practiceId: user.practiceId,
          metadata: {
            code: selected.diagnosisCode.code,
            description: selected.diagnosisCode.description,
          },
        },
      });

      return "success";
    });
  } catch (error) {
    handleDatabaseError(error, encounter.id);
  }

  if (result !== "success") {
    redirectForTransactionError(encounter.id, result);
  }

  revalidatePath(`/clinical/${encounter.id}`);
  revalidatePath("/patients");
  redirect(`/clinical/${encounter.id}?diagnosisRemoved=1`);
}