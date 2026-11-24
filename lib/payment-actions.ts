
"use server";

import {
  PaymentMethod,
  PaymentSource,
  PaymentStatus,
  Prisma,
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "./auth";
import { db } from "./db";

const amountSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount with up to two decimal places.")
  .refine((value) => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 && amount <= 999999.99;
  }, "Amount must be greater than zero and no more than 999,999.99.");

const paymentSchema = z.object({
  patientId: z.string().min(1),
  source: z.nativeEnum(PaymentSource),
  method: z.nativeEnum(PaymentMethod),
  amount: amountSchema,
  referenceNumber: z.string().trim().max(100).optional(),
  receivedAt: z.string().min(1),
  notes: z.string().trim().max(5000).optional(),
});

const editPaymentSchema = z.object({
  paymentId: z.string().min(1),
  source: z.nativeEnum(PaymentSource),
  method: z.nativeEnum(PaymentMethod),
  amount: amountSchema,
  referenceNumber: z.string().trim().max(100).optional(),
  receivedAt: z.string().min(1),
  notes: z.string().trim().max(5000).optional(),
});

const idSchema = z.string().min(1);

const voidSchema = z.object({
  paymentId: z.string().min(1),
  reason: z.string().trim().min(5).max(1000),
});

type ActionResult =
  | "success"
  | "not-found"
  | "already-processed"
  | "not-reviewed"
  | "invalid-data";

async function billingUser() {
  const user = await currentUser();

  if (!user || !user.active) {
    redirect("/login");
  }

  if (!["ADMIN", "BILLING"].includes(user.role)) {
    redirect("/");
  }

  return user;
}

function paymentRedirect(result: string): never {
  revalidatePath("/billing");
  revalidatePath("/patients");

  redirect(`/billing?result=${result}`);
}

function parseReceivedAt(value: string): Date | null {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  return date;
}

async function lockPayment(
  tx: Prisma.TransactionClient,
  paymentId: string,
  practiceId: string
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Payment"
    WHERE "id" = ${paymentId}
      AND "practiceId" = ${practiceId}
    FOR UPDATE
  `;

  if (rows.length === 0) {
    return null;
  }

  return tx.payment.findFirst({
    where: {
      id: paymentId,
      practiceId,
    },
  });
}

async function writePaymentAudit(
  tx: Prisma.TransactionClient,
  input: {
    action: string;
    paymentId: string;
    practiceId: string;
    actorId: string;
    metadata?: Prisma.InputJsonObject;
  }
) {
  await tx.auditEvent.create({
    data: {
      action: input.action,
      entityType: "Payment",
      entityId: input.paymentId,
      practiceId: input.practiceId,
      actorId: input.actorId,
      metadata: {
        ...(input.metadata ?? {}),
      },
    },
  });
}

export async function createPayment(formData: FormData) {
  const user = await billingUser();

  const parsed = paymentSchema.safeParse({
    patientId: formData.get("patientId"),
    source: formData.get("source"),
    method: formData.get("method"),
    amount: formData.get("amount"),
    referenceNumber: formData.get("referenceNumber") || "",
    receivedAt: formData.get("receivedAt"),
    notes: formData.get("notes") || "",
  });

  if (!parsed.success) {
    paymentRedirect("invalid-data");
  }

  const data = parsed.data;
  const receivedAt = parseReceivedAt(data.receivedAt);

  if (!receivedAt) {
    paymentRedirect("invalid-data");
  }

  const patient = await db.patient.findFirst({
    where: {
      id: data.patientId,
      practiceId: user.practiceId,
    },
    select: {
      id: true,
    },
  });

  if (!patient) {
    paymentRedirect("not-found");
  }

  const amount = new Prisma.Decimal(data.amount);

  await db.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        practiceId: user.practiceId,
        patientId: patient.id,
        source: data.source,
        method: data.method,
        status: PaymentStatus.DRAFT,
        amount,
        currency: "USD",
        referenceNumber: data.referenceNumber || null,
        receivedAt,
        notes: data.notes || null,
        createdById: user.id,
      },
    });

    await writePaymentAudit(tx, {
      action: "PAYMENT_CREATED",
      paymentId: payment.id,
      practiceId: user.practiceId,
      actorId: user.id,
      metadata: {
        patientId: patient.id,
        source: data.source,
        method: data.method,
        amount: amount.toFixed(2),
        status: PaymentStatus.DRAFT,
      },
    });
  });

  paymentRedirect("payment-created");
}

export async function updateDraftPayment(formData: FormData) {
  const user = await billingUser();

  const parsed = editPaymentSchema.safeParse({
    paymentId: formData.get("paymentId"),
    source: formData.get("source"),
    method: formData.get("method"),
    amount: formData.get("amount"),
    referenceNumber: formData.get("referenceNumber") || "",
    receivedAt: formData.get("receivedAt"),
    notes: formData.get("notes") || "",
  });

  if (!parsed.success) {
    paymentRedirect("invalid-data");
  }

  const data = parsed.data;
  const receivedAt = parseReceivedAt(data.receivedAt);

  if (!receivedAt) {
    paymentRedirect("invalid-data");
  }

  const amount = new Prisma.Decimal(data.amount);

  const result = await db.$transaction(async (tx) => {
    const payment = await lockPayment(
      tx,
      data.paymentId,
      user.practiceId
    );

    if (!payment) return "not-found" as ActionResult;

    if (payment.status !== PaymentStatus.DRAFT) {
      return "already-processed" as ActionResult;
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        source: data.source,
        method: data.method,
        amount,
        referenceNumber: data.referenceNumber || null,
        receivedAt,
        notes: data.notes || null,
        reviewedById: null,
        reviewedAt: null,
      },
    });

    await writePaymentAudit(tx, {
      action: "PAYMENT_UPDATED",
      paymentId: payment.id,
      practiceId: user.practiceId,
      actorId: user.id,
      metadata: {
        source: data.source,
        method: data.method,
        amount: amount.toFixed(2),
        reviewReset: true,
      },
    });

    return "success" as ActionResult;
  });

  if (result !== "success") {
    paymentRedirect(result);
  }

  paymentRedirect("payment-updated");
}

export async function reviewPayment(formData: FormData) {
  const user = await billingUser();
  const parsed = idSchema.safeParse(formData.get("paymentId"));

  if (!parsed.success) {
    paymentRedirect("invalid-data");
  }

  const paymentId = parsed.data;

  const result = await db.$transaction(async (tx) => {
    const payment = await lockPayment(
      tx,
      paymentId,
      user.practiceId
    );

    if (!payment) return "not-found" as ActionResult;

    if (payment.status !== PaymentStatus.DRAFT) {
      return "already-processed" as ActionResult;
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        reviewedById: user.id,
        reviewedAt: new Date(),
      },
    });

    await writePaymentAudit(tx, {
      action: "PAYMENT_REVIEWED",
      paymentId: payment.id,
      practiceId: user.practiceId,
      actorId: user.id,
      metadata: {
        amount: payment.amount.toFixed(2),
        source: payment.source,
        method: payment.method,
      },
    });

    return "success" as ActionResult;
  });

  if (result !== "success") {
    paymentRedirect(result);
  }

  paymentRedirect("payment-reviewed");
}

export async function postPayment(formData: FormData) {
  const user = await billingUser();
  const parsed = idSchema.safeParse(formData.get("paymentId"));

  if (!parsed.success) {
    paymentRedirect("invalid-data");
  }

  const paymentId = parsed.data;

  const result = await db.$transaction(async (tx) => {
    const payment = await lockPayment(
      tx,
      paymentId,
      user.practiceId
    );

    if (!payment) return "not-found" as ActionResult;

    if (payment.status !== PaymentStatus.DRAFT) {
      return "already-processed" as ActionResult;
    }

    if (!payment.reviewedAt || !payment.reviewedById) {
      return "not-reviewed" as ActionResult;
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.POSTED,
        postedById: user.id,
        postedAt: new Date(),
      },
    });

    await writePaymentAudit(tx, {
      action: "PAYMENT_POSTED",
      paymentId: payment.id,
      practiceId: user.practiceId,
      actorId: user.id,
      metadata: {
        amount: payment.amount.toFixed(2),
        source: payment.source,
        method: payment.method,
        patientId: payment.patientId,
      },
    });

    return "success" as ActionResult;
  });

  if (result !== "success") {
    paymentRedirect(result);
  }

  paymentRedirect("payment-posted");
}

export async function voidPayment(formData: FormData) {
  const user = await billingUser();

  const parsed = voidSchema.safeParse({
    paymentId: formData.get("paymentId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    paymentRedirect("invalid-data");
  }

  const data = parsed.data;

  const result = await db.$transaction(async (tx) => {
    const payment = await lockPayment(
      tx,
      data.paymentId,
      user.practiceId
    );

    if (!payment) return "not-found" as ActionResult;

    if (payment.status !== PaymentStatus.DRAFT) {
      return "already-processed" as ActionResult;
    }

    const existingNotes = payment.notes?.trim();
    const voidNote = `Voided by ${user.email}: ${data.reason}`;

    const updatedNotes = existingNotes
      ? `${existingNotes}\n\n${voidNote}`
      : voidNote;

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.VOIDED,
        voidedAt: new Date(),
        notes: updatedNotes,
      },
    });

    await writePaymentAudit(tx, {
      action: "PAYMENT_VOIDED",
      paymentId: payment.id,
      practiceId: user.practiceId,
      actorId: user.id,
      metadata: {
        amount: payment.amount.toFixed(2),
        reason: data.reason,
      },
    });

    return "success" as ActionResult;
  });

  if (result !== "success") {
    paymentRedirect(result);
  }

  paymentRedirect("payment-voided");
}