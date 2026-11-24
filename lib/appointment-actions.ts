
"use server";

import { AppointmentStatus, Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  addCalendarDays,
  isValidCalendarDate,
  localDateTimeToUtc,
  startOfDayInTimeZone,
} from "@/lib/schedule-time";

const createSchema = z.object({
  patientId: z.string().min(1),
  providerId: z.string().min(1),
  date: z.string().refine(isValidCalendarDate),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMin: z.enum(["15", "30", "45", "60"]),
  visitType: z.string().trim().min(2).max(80),
});

const CREATE_ROLES = ["ADMIN", "RECEPTIONIST", "PROVIDER"];

export async function createAppointment(formData: FormData) {
  const user = await currentUser();

  if (!user || !user.active || !CREATE_ROLES.includes(user.role)) {
    redirect("/schedule?error=unauthorized");
  }

  const parsed = createSchema.safeParse({
    patientId: formData.get("patientId"),
    providerId: formData.get("providerId"),
    date: formData.get("date"),
    time: formData.get("time"),
    durationMin: formData.get("durationMin"),
    visitType: formData.get("visitType"),
  });

  if (!parsed.success) {
    redirect("/schedule/new?error=invalid");
  }

  const data = parsed.data;
  const timeZone = user.practice.timezone || "America/New_York";

  const startsAt = localDateTimeToUtc(
    data.date,
    data.time,
    timeZone
  );

  if (!startsAt) {
    redirect("/schedule/new?error=invalid-time");
  }

  const durationMin = Number(data.durationMin);
  const endsAt = new Date(startsAt.getTime() + durationMin * 60_000);

  const nextDayStart = startOfDayInTimeZone(
    addCalendarDays(data.date, 1),
    timeZone
  );

  try {
    await db.$transaction(
      async (tx) => {
        const [patient, provider] = await Promise.all([
          tx.patient.findFirst({
            where: {
              id: data.patientId,
              practiceId: user.practiceId,
              status: "ACTIVE",
            },
            select: { id: true },
          }),
          tx.provider.findFirst({
            where: {
              id: data.providerId,
              practiceId: user.practiceId,
              active: true,
            },
            select: { id: true },
          }),
        ]);

        if (!patient) throw new Error("PATIENT_NOT_FOUND");
        if (!provider) throw new Error("PROVIDER_NOT_FOUND");

        const searchStart = new Date(
          startsAt.getTime() - 60 * 60_000
        );

        const existingAppointments = await tx.appointment.findMany({
          where: {
            practiceId: user.practiceId,
            providerId: data.providerId,
            status: { not: AppointmentStatus.CANCELLED },
            startsAt: {
              gte: searchStart,
              lt: nextDayStart,
            },
          },
          select: {
            startsAt: true,
            durationMin: true,
          },
        });

        const hasConflict = existingAppointments.some((appointment) => {
          const existingEnd = new Date(
            appointment.startsAt.getTime() +
              appointment.durationMin * 60_000
          );

          return (
            startsAt.getTime() < existingEnd.getTime() &&
            endsAt.getTime() > appointment.startsAt.getTime()
          );
        });

        if (hasConflict) throw new Error("APPOINTMENT_CONFLICT");

        const appointment = await tx.appointment.create({
          data: {
            startsAt,
            durationMin,
            visitType: data.visitType,
            status: AppointmentStatus.SCHEDULED,
            patientId: patient.id,
            providerId: provider.id,
            practiceId: user.practiceId,
          },
        });

        await tx.auditEvent.create({
          data: {
            action: "APPOINTMENT_CREATED",
            entityType: "Appointment",
            entityId: appointment.id,
            actorId: user.id,
            practiceId: user.practiceId,
            metadata: {
              providerId: provider.id,
              patientId: patient.id,
              durationMin,
              visitType: data.visitType,
            },
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "APPOINTMENT_CONFLICT") {
      redirect("/schedule/new?error=conflict");
    }

    if (
      error instanceof Error &&
      (error.message === "PATIENT_NOT_FOUND" ||
        error.message === "PROVIDER_NOT_FOUND")
    ) {
      redirect("/schedule/new?error=invalid-selection");
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      redirect("/schedule/new?error=retry");
    }

    throw error;
  }

  redirect(`/schedule?date=${data.date}&created=1`);
}

const statusSchema = z.object({
  appointmentId: z.string().min(1),
  status: z.enum(["CHECKED_IN", "COMPLETED", "CANCELLED"]),
});

const allowedRoles: Record<string, string[]> = {
  CHECKED_IN: ["ADMIN", "RECEPTIONIST"],
  COMPLETED: ["ADMIN", "PROVIDER", "CLINICAL_STAFF"],
  CANCELLED: ["ADMIN", "RECEPTIONIST", "PROVIDER"],
};

const allowedTransitions: Record<string, string[]> = {
  SCHEDULED: ["CHECKED_IN", "CANCELLED"],
  CHECKED_IN: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export async function updateAppointmentStatus(formData: FormData) {
  const user = await currentUser();

  if (!user || !user.active) redirect("/login");

  const parsed = statusSchema.safeParse({
    appointmentId: formData.get("appointmentId"),
    status: formData.get("status"),
  });

  if (!parsed.success) redirect("/schedule?error=invalid");

  const { appointmentId, status } = parsed.data;

  if (!allowedRoles[status].includes(user.role)) {
    redirect("/schedule?error=unauthorized");
  }

  const existing = await db.appointment.findFirst({
    where: {
      id: appointmentId,
      practiceId: user.practiceId,
    },
    select: {
      id: true,
      status: true,
      startsAt: true,
    },
  });

  if (!existing) redirect("/schedule?error=notfound");

  if (!allowedTransitions[existing.status].includes(status)) {
    redirect("/schedule?error=invalid-transition");
  }

  try {
    await db.$transaction(
      async (tx) => {
        const current = await tx.appointment.findFirst({
          where: {
            id: appointmentId,
            practiceId: user.practiceId,
          },
          select: { status: true },
        });

        if (!current || !allowedTransitions[current.status].includes(status)) {
          throw new Error("INVALID_STATUS_TRANSITION");
        }

        const result = await tx.appointment.updateMany({
          where: {
            id: appointmentId,
            practiceId: user.practiceId,
            status: current.status,
          },
          data: { status: status as AppointmentStatus },
        });

        if (result.count !== 1) {
          throw new Error("STATUS_UPDATE_CONFLICT");
        }

        await tx.auditEvent.create({
          data: {
            action: `APPOINTMENT_${status}`,
            entityType: "Appointment",
            entityId: appointmentId,
            actorId: user.id,
            practiceId: user.practiceId,
            metadata: {
              previousStatus: current.status,
              newStatus: status,
            },
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "INVALID_STATUS_TRANSITION" ||
        error.message === "STATUS_UPDATE_CONFLICT")
    ) {
      redirect("/schedule?error=invalid-transition");
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      redirect("/schedule?error=retry");
    }

    throw error;
  }

  const timeZone = user.practice.timezone || "America/New_York";

  const appointmentDate = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(existing.startsAt);

  redirect(`/schedule?date=${appointmentDate}&updated=1`);
}