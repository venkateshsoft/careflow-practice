
"use server";

import {
  AdjustmentStatus,
  AdjustmentType,
  ChargeStatus,
  Prisma,
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "./auth";
import { db } from "./db";

const adjustmentSchema = z.object({
  chargeId: z.string().min(1),
  type: z.nativeEnum(AdjustmentType),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount with up to two decimal places.")
    .refine((value) => {
      const amount = Number(value);
      return Number.isFinite(amount) && amount > 0 && amount <= 999999.99;
    }, "Amount must be greater than zero and no more than 999,999.99."),
  reason: z.string().trim().min(5).max(1000),
  notes: z.string().trim().max(5000).optional(),
});

const editAdjustmentSchema = z.object({
  adjustmentId: z.string().min(1),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount with up to two decimal places.")
    .refine((value) => {
      const amount = Number(value);
      return Number.isFinite(amount) && amount > 0 && amount <= 999999.99;
    }, "Amount must be greater than zero and no more than 999,999.99."),
  reason: z.string().trim().min(5).max(1000),
  notes: z.string().trim().max(5000).optional(),
});

const idSchema = z.string().min(1);

const voidSchema = z.object({
  adjustmentId: z.string().min(1),
  reason: z.string().trim().min(5).max(1000),
});

type ActionResult =
  | "success"
  | "not-found"
  | "not-posted"
  | "already-processed"
  | "not-reviewed"
  | "negative-balance"
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

function adjustmentRedirect(chargeId: string, result: string): never {
  revalidatePath("/billing");
  revalidatePath(`/billing/${chargeId}`);
  revalidatePath(`/billing/${chargeId}/adjustments`);

  redirect(`/billing/${chargeId}/adjustments?result=${result}`);
}

async function lockCharge(
  tx: Prisma.TransactionClient,
  chargeId: string,
  practiceId: string
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Charge"
    WHERE "id" = ${chargeId}
      AND "practiceId" = ${practiceId}
    FOR UPDATE
  `;

  if (rows.length === 0) {
    return null;
  }

  return tx.charge.findFirst({
    where: {
      id: chargeId,
      practiceId,
    },
  });
}

async function lockAdjustment(
  tx: Prisma.TransactionClient,
  adjustmentId: string,
  practiceId: string
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "ChargeAdjustment"
    WHERE "id" = ${adjustmentId}
      AND "practiceId" = ${practiceId}
    FOR UPDATE
  `;

  if (rows.length === 0) {
    return null;
  }

  return tx.chargeAdjustment.findFirst({
    where: {
      id: adjustmentId,
      practiceId,
    },
  });
}

async function writeAdjustmentAudit(
  tx: Prisma.TransactionClient,
  input: {
    action: string;
    adjustmentId: string;
    practiceId: string;
    actorId: string;
    chargeId: string;
    metadata?: Prisma.InputJsonObject;
  }
) {
  await tx.auditEvent.create({
    data: {
      action: input.action,
      entityType: "ChargeAdjustment",
      entityId: input.adjustmentId,
      practiceId: input.practiceId,
      actorId: input.actorId,
      metadata: {
        chargeId: input.chargeId,
        ...(input.metadata ?? {}),
      },
    },
  });
}

export async function createChargeAdjustment(formData: FormData) {
  const user = await billingUser();

  const parsed = adjustmentSchema.safeParse({
    chargeId: formData.get("chargeId"),
    type: formData.get("type"),
    amount: formData.get("amount"),
    reason: formData.get("reason"),
    notes: formData.get("notes") || "",
  });

  if (!parsed.success) {
    redirect(
      `/billing/${String(formData.get("chargeId") ?? "")}/adjustments?result=invalid-data`
    );
  }

  const data = parsed.data;
  const amount = new Prisma.Decimal(data.amount);

  const result = await db.$transaction(async (tx) => {
    const charge = await lockCharge(tx, data.chargeId, user.practiceId);

    if (!charge) return "not-found" as ActionResult;
    if (charge.status !== ChargeStatus.POSTED) {
      return "not-posted" as ActionResult;
    }

    const adjustment = await tx.chargeAdjustment.create({
      data: {
        chargeId: charge.id,
        practiceId: user.practiceId,
        patientId: charge.patientId,
        type: data.type,
        status: AdjustmentStatus.DRAFT,
        amount,
        reason: data.reason,
        notes: data.notes || null,
        createdById: user.id,
      },
    });

    await writeAdjustmentAudit(tx, {
      action: "CHARGE_ADJUSTMENT_CREATED",
      adjustmentId: adjustment.id,
      practiceId: user.practiceId,
      actorId: user.id,
      chargeId: charge.id,
      metadata: {
        type: data.type,
        amount: amount.toFixed(2),
        status: AdjustmentStatus.DRAFT,
      },
    });

    return "success" as ActionResult;
  });

  if (result !== "success") {
    adjustmentRedirect(data.chargeId, result);
  }

  adjustmentRedirect(data.chargeId, "created");
}

export async function updateDraftChargeAdjustment(formData: FormData) {
  const user = await billingUser();

  const parsed = editAdjustmentSchema.safeParse({
    adjustmentId: formData.get("adjustmentId"),
    amount: formData.get("amount"),
    reason: formData.get("reason"),
    notes: formData.get("notes") || "",
  });

  if (!parsed.success) {
    const adjustmentId = String(formData.get("adjustmentId") ?? "");
    redirect(`/billing/adjustments/${adjustmentId}?result=invalid-data`);
  }

  const data = parsed.data;
  const amount = new Prisma.Decimal(data.amount);

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.chargeAdjustment.findFirst({
      where: {
        id: data.adjustmentId,
        practiceId: user.practiceId,
      },
      select: {
        id: true,
        chargeId: true,
      },
    });

    if (!existing) return "not-found" as ActionResult;

    const charge = await lockCharge(tx, existing.chargeId, user.practiceId);
    if (!charge) return "not-found" as ActionResult;
    if (charge.status !== ChargeStatus.POSTED) {
      return "not-posted" as ActionResult;
    }

    const adjustment = await lockAdjustment(
      tx,
      data.adjustmentId,
      user.practiceId
    );

    if (!adjustment) return "not-found" as ActionResult;
    if (adjustment.status !== AdjustmentStatus.DRAFT) {
      return "already-processed" as ActionResult;
    }

    await tx.chargeAdjustment.update({
      where: { id: adjustment.id },
      data: {
        amount,
        reason: data.reason,
        notes: data.notes || null,
        reviewedById: null,
        reviewedAt: null,
      },
    });

    await writeAdjustmentAudit(tx, {
      action: "CHARGE_ADJUSTMENT_UPDATED",
      adjustmentId: adjustment.id,
      practiceId: user.practiceId,
      actorId: user.id,
      chargeId: charge.id,
      metadata: {
        type: adjustment.type,
        amount: amount.toFixed(2),
        reviewReset: true,
      },
    });

    return "success" as ActionResult;
  });

  if (result !== "success") {
    redirect(
      `/billing/adjustments/${data.adjustmentId}?result=${result}`
    );
  }

  revalidatePath("/billing");
  redirect(
    `/billing/adjustments/${data.adjustmentId}?result=updated`
  );
}

export async function reviewChargeAdjustment(formData: FormData) {
  const user = await billingUser();
  const parsed = idSchema.safeParse(formData.get("adjustmentId"));

  if (!parsed.success) {
    redirect("/billing?result=invalid-data");
  }

  const adjustmentId = parsed.data;

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.chargeAdjustment.findFirst({
      where: {
        id: adjustmentId,
        practiceId: user.practiceId,
      },
      select: {
        id: true,
        chargeId: true,
      },
    });

    if (!existing) return "not-found" as ActionResult;

    const charge = await lockCharge(tx, existing.chargeId, user.practiceId);
    if (!charge) return "not-found" as ActionResult;
    if (charge.status !== ChargeStatus.POSTED) {
      return "not-posted" as ActionResult;
    }

    const adjustment = await lockAdjustment(
      tx,
      adjustmentId,
      user.practiceId
    );

    if (!adjustment) return "not-found" as ActionResult;
    if (adjustment.status !== AdjustmentStatus.DRAFT) {
      return "already-processed" as ActionResult;
    }

    await tx.chargeAdjustment.update({
      where: { id: adjustment.id },
      data: {
        reviewedById: user.id,
        reviewedAt: new Date(),
      },
    });

    await writeAdjustmentAudit(tx, {
      action: "CHARGE_ADJUSTMENT_REVIEWED",
      adjustmentId: adjustment.id,
      practiceId: user.practiceId,
      actorId: user.id,
      chargeId: charge.id,
      metadata: {
        type: adjustment.type,
        amount: adjustment.amount.toFixed(2),
      },
    });

    return "success" as ActionResult;
  });

  if (result !== "success") {
    redirect(`/billing?result=${result}`);
  }

  revalidatePath("/billing");
  redirect("/billing?result=adjustment-reviewed");
}

export async function postChargeAdjustment(formData: FormData) {
  const user = await billingUser();
  const parsed = idSchema.safeParse(formData.get("adjustmentId"));

  if (!parsed.success) {
    redirect("/billing?result=invalid-data");
  }

  const adjustmentId = parsed.data;

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.chargeAdjustment.findFirst({
      where: {
        id: adjustmentId,
        practiceId: user.practiceId,
      },
      select: {
        id: true,
        chargeId: true,
      },
    });

    if (!existing) return "not-found" as ActionResult;

    const charge = await lockCharge(tx, existing.chargeId, user.practiceId);
    if (!charge) return "not-found" as ActionResult;
    if (charge.status !== ChargeStatus.POSTED) {
      return "not-posted" as ActionResult;
    }

    const adjustment = await lockAdjustment(
      tx,
      adjustmentId,
      user.practiceId
    );

    if (!adjustment) return "not-found" as ActionResult;
    if (adjustment.status !== AdjustmentStatus.DRAFT) {
      return "already-processed" as ActionResult;
    }

    if (!adjustment.reviewedAt || !adjustment.reviewedById) {
      return "not-reviewed" as ActionResult;
    }

    const postedAdjustments = await tx.chargeAdjustment.findMany({
      where: {
        chargeId: charge.id,
        practiceId: user.practiceId,
        status: AdjustmentStatus.POSTED,
      },
      select: {
        type: true,
        amount: true,
      },
    });

    let netAmount = new Prisma.Decimal(charge.totalAmount);

    for (const posted of postedAdjustments) {
      netAmount =
        posted.type === AdjustmentType.CREDIT
          ? netAmount.minus(posted.amount)
          : netAmount.plus(posted.amount);
    }

    netAmount =
      adjustment.type === AdjustmentType.CREDIT
        ? netAmount.minus(adjustment.amount)
        : netAmount.plus(adjustment.amount);

    if (netAmount.lessThan(0)) {
      return "negative-balance" as ActionResult;
    }

    await tx.chargeAdjustment.update({
      where: { id: adjustment.id },
      data: {
        status: AdjustmentStatus.POSTED,
        postedById: user.id,
        postedAt: new Date(),
      },
    });

    await writeAdjustmentAudit(tx, {
      action: "CHARGE_ADJUSTMENT_POSTED",
      adjustmentId: adjustment.id,
      practiceId: user.practiceId,
      actorId: user.id,
      chargeId: charge.id,
      metadata: {
        type: adjustment.type,
        amount: adjustment.amount.toFixed(2),
        netChargeAmount: netAmount.toFixed(2),
      },
    });

    return "success" as ActionResult;
  });

  if (result !== "success") {
    redirect(`/billing?result=${result}`);
  }

  revalidatePath("/billing");
  redirect("/billing?result=adjustment-posted");
}

export async function voidChargeAdjustment(formData: FormData) {
  const user = await billingUser();

  const parsed = voidSchema.safeParse({
    adjustmentId: formData.get("adjustmentId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    redirect("/billing?result=invalid-data");
  }

  const data = parsed.data;

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.chargeAdjustment.findFirst({
      where: {
        id: data.adjustmentId,
        practiceId: user.practiceId,
      },
      select: {
        id: true,
        chargeId: true,
      },
    });

    if (!existing) return "not-found" as ActionResult;

    const charge = await lockCharge(tx, existing.chargeId, user.practiceId);
    if (!charge) return "not-found" as ActionResult;

    const adjustment = await lockAdjustment(
      tx,
      data.adjustmentId,
      user.practiceId
    );

    if (!adjustment) return "not-found" as ActionResult;
    if (adjustment.status !== AdjustmentStatus.DRAFT) {
      return "already-processed" as ActionResult;
    }

    const existingNotes = adjustment.notes?.trim();
    const voidNote = `Voided by ${user.email}: ${data.reason}`;
    const updatedNotes = existingNotes
      ? `${existingNotes}\n\n${voidNote}`
      : voidNote;

    await tx.chargeAdjustment.update({
      where: { id: adjustment.id },
      data: {
        status: AdjustmentStatus.VOIDED,
        voidedAt: new Date(),
        notes: updatedNotes,
      },
    });

    await writeAdjustmentAudit(tx, {
      action: "CHARGE_ADJUSTMENT_VOIDED",
      adjustmentId: adjustment.id,
      practiceId: user.practiceId,
      actorId: user.id,
      chargeId: charge.id,
      metadata: {
        type: adjustment.type,
        amount: adjustment.amount.toFixed(2),
        reason: data.reason,
      },
    });

    return "success" as ActionResult;
  });

  if (result !== "success") {
    redirect(`/billing?result=${result}`);
  }

  revalidatePath("/billing");
  redirect("/billing?result=adjustment-voided");
}