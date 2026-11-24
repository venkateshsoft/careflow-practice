"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

const patientSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  phone: z.string().trim().min(7).max(25),
});

const CREATE_ROLES = ["ADMIN", "RECEPTIONIST"];
const EDIT_ROLES = ["ADMIN", "RECEPTIONIST", "PROVIDER", "CLINICAL_STAFF"];

function readPatientForm(formData: FormData) {
  return patientSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    dateOfBirth: formData.get("dateOfBirth"),
    phone: formData.get("phone"),
  });
}

function validDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    date <= new Date()
  );
}

export async function createPatient(formData: FormData) {
  const user = await currentUser();

  if (!user || !user.active || !CREATE_ROLES.includes(user.role)) {
    redirect("/patients?error=unauthorized");
  }

  const parsed = readPatientForm(formData);

  if (!parsed.success || !validDate(parsed.data.dateOfBirth)) {
    redirect("/patients/new?error=invalid");
  }

  const data = parsed.data;
  const mrn = `CF-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;

  await db.$transaction(async (tx) => {
    const patient = await tx.patient.create({
      data: {
        mrn,
        firstName: data.firstName,
        lastName: data.lastName,
        dateOfBirth: new Date(`${data.dateOfBirth}T00:00:00.000Z`),
        phone: data.phone,
        practiceId: user.practiceId,
      },
    });

    await tx.auditEvent.create({
      data: {
        action: "PATIENT_CREATED",
        entityType: "Patient",
        entityId: patient.id,
        actorId: user.id,
        practiceId: user.practiceId,
        metadata: { mrn: patient.mrn },
      },
    });
  });

  redirect("/patients?created=1");
}

export async function updatePatient(formData: FormData) {
  const user = await currentUser();

  if (!user || !user.active || !EDIT_ROLES.includes(user.role)) {
    redirect("/patients?error=unauthorized");
  }

  const patientId = String(formData.get("patientId") ?? "");
  const parsed = readPatientForm(formData);

  if (
    !patientId ||
    !parsed.success ||
    !validDate(parsed.data.dateOfBirth)
  ) {
    redirect("/patients?error=invalid");
  }

  const existing = await db.patient.findFirst({
    where: {
      id: patientId,
      practiceId: user.practiceId,
    },
    select: { id: true, mrn: true },
  });

  if (!existing) {
    redirect("/patients?error=notfound");
  }

  const data = parsed.data;

  await db.$transaction(async (tx) => {
    await tx.patient.update({
      where: { id: existing.id },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        dateOfBirth: new Date(`${data.dateOfBirth}T00:00:00.000Z`),
        phone: data.phone,
      },
    });

    await tx.auditEvent.create({
      data: {
        action: "PATIENT_UPDATED",
        entityType: "Patient",
        entityId: existing.id,
        actorId: user.id,
        practiceId: user.practiceId,
        metadata: { mrn: existing.mrn },
      },
    });
  });

  redirect(`/patients/${existing.id}?updated=1`);
}