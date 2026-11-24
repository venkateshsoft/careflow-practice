
"use server";

import { ChargeStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

const BILLING_ROLES = ["ADMIN", "BILLING"] as const;

const editSchema = z.object({
  chargeId: z.string().min(1),
  lineId: z.string().min(1),
  units: z.coerce.number().int().min(1).max(100),
  unitPrice: z.coerce.number().min(0).max(999999),
  notes: z.string().trim().max(2000),
});

const reasonSchema = z.object({
  chargeId: z.string().min(1),
  reason: z.string().trim().min(5).max(1000),
});

async function requireBillingUser() {
  const user = await currentUser();

  if (
    !user ||
    !user.active ||
    !BILLING_ROLES.includes(user.role as (typeof BILLING_ROLES)[number])
  ) {
    redirect("/login?error=unauthorized");
  }

  return user;
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

  if (rows.length === 0) return null;

  return tx.charge.findFirst({
    where: {
      id: chargeId,
      practiceId,
    },
    include: {
      lines: true,
    },
  });
}

function billingPath(chargeId: string, result: string): never {
  redirect(`/billing/${chargeId}?${result}=1`);
}

export async function updateDraftCharge(formData: FormData) {
  const user = await requireBillingUser();

  const parsed = editSchema.safeParse({
    chargeId: formData.get("chargeId"),
    lineId: formData.get("lineId"),
    units: formData.get("units"),
    unitPrice: formData.get("unitPrice"),
    notes: formData.get("notes") ?? "",
  });

  if (!parsed.success) redirect("/billing?error=invalid");

  const data = parsed.data;

  try {
    await db.$transaction(async (tx) => {
      const charge = await lockCharge(
        tx,
        data.chargeId,
        user.practiceId
      );

      if (!charge) throw new Error("CHARGE_NOT_FOUND");
      if (charge.status !== ChargeStatus.DRAFT) {
        throw new Error("CHARGE_NOT_DRAFT");
      }

      const line = charge.lines.find(
        (item) => item.id === data.lineId
      );

      if (!line) throw new Error("CHARGE_LINE_NOT_FOUND");

      const unitPrice = new Prisma.Decimal(data.unitPrice);
      const lineTotal = unitPrice.mul(data.units);

      await tx.chargeLine.update({
        where: { id: line.id },
        data: {
          units: data.units,
          unitPrice,
          lineTotal,
        },
      });

      await tx.charge.update({
        where: { id: charge.id },
        data: {
          subtotal: lineTotal,
          totalAmount: lineTotal,
          notes: data.notes || null,
        },
      });

      await tx.auditEvent.create({
        data: {
          action: "CHARGE_DRAFT_UPDATED",
          entityType: "Charge",
          entityId: charge.id,
          actorId: user.id,
          practiceId: user.practiceId,
          metadata: {
            lineId: line.id,
            previousUnits: line.units,
            newUnits: data.units,
            previousUnitPrice: line.unitPrice.toFixed(2),
            newUnitPrice: unitPrice.toFixed(2),
            previousTotal: charge.totalAmount.toFixed(2),
            newTotal: lineTotal.toFixed(2),
          },
        },
      });
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "CHARGE_NOT_FOUND") {
        redirect("/billing?error=notfound");
      }
      if (error.message === "CHARGE_NOT_DRAFT") {
        billingPath(data.chargeId, "locked");
      }
      if (error.message === "CHARGE_LINE_NOT_FOUND") {
        billingPath(data.chargeId, "invalid-line");
      }
    }
    throw error;
  }

  revalidatePath("/billing");
  revalidatePath(`/billing/${data.chargeId}`);
  billingPath(data.chargeId, "updated");
}

export async function reviewCharge(formData: FormData) {
  const user = await requireBillingUser();
  const chargeId = String(formData.get("chargeId") ?? "");

  if (!chargeId) redirect("/billing?error=invalid");

  try {
    await db.$transaction(async (tx) => {
      const charge = await lockCharge(
        tx,
        chargeId,
        user.practiceId
      );

      if (!charge) throw new Error("CHARGE_NOT_FOUND");
      if (charge.status !== ChargeStatus.DRAFT) {
        throw new Error("CHARGE_NOT_DRAFT");
      }

      await tx.charge.update({
        where: { id: charge.id },
        data: {
          reviewedById: user.id,
          reviewedAt: new Date(),
        },
      });

      await tx.auditEvent.create({
        data: {
          action: "CHARGE_REVIEWED",
          entityType: "Charge",
          entityId: charge.id,
          actorId: user.id,
          practiceId: user.practiceId,
          metadata: {
            reviewedBy: user.displayName,
            amount: charge.totalAmount.toFixed(2),
            currency: charge.currency,
          },
        },
      });
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "CHARGE_NOT_FOUND") {
        redirect("/billing?error=notfound");
      }
      if (error.message === "CHARGE_NOT_DRAFT") {
        billingPath(chargeId, "locked");
      }
    }
    throw error;
  }

  revalidatePath("/billing");
  revalidatePath(`/billing/${chargeId}`);
  billingPath(chargeId, "reviewed");
}

export async function postCharge(formData: FormData) {
  const user = await requireBillingUser();
  const chargeId = String(formData.get("chargeId") ?? "");

  if (!chargeId) redirect("/billing?error=invalid");

  try {
    await db.$transaction(async (tx) => {
      const charge = await lockCharge(
        tx,
        chargeId,
        user.practiceId
      );

      if (!charge) throw new Error("CHARGE_NOT_FOUND");
      if (charge.status !== ChargeStatus.DRAFT) {
        throw new Error("CHARGE_NOT_DRAFT");
      }
      if (!charge.reviewedAt || !charge.reviewedById) {
        throw new Error("CHARGE_NOT_REVIEWED");
      }
      if (charge.lines.length === 0) {
        throw new Error("CHARGE_HAS_NO_LINES");
      }

      const now = new Date();

      await tx.charge.update({
        where: { id: charge.id },
        data: {
          status: ChargeStatus.POSTED,
          postedById: user.id,
          postedAt: now,
        },
      });

      await tx.auditEvent.create({
        data: {
          action: "CHARGE_POSTED",
          entityType: "Charge",
          entityId: charge.id,
          actorId: user.id,
          practiceId: user.practiceId,
          metadata: {
            postedBy: user.displayName,
            reviewedById: charge.reviewedById,
            amount: charge.totalAmount.toFixed(2),
            currency: charge.currency,
          },
        },
      });
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "CHARGE_NOT_FOUND") {
        redirect("/billing?error=notfound");
      }
      if (error.message === "CHARGE_NOT_DRAFT") {
        billingPath(chargeId, "locked");
      }
      if (error.message === "CHARGE_NOT_REVIEWED") {
        billingPath(chargeId, "review-required");
      }
      if (error.message === "CHARGE_HAS_NO_LINES") {
        billingPath(chargeId, "empty-charge");
      }
    }
    throw error;
  }

  revalidatePath("/billing");
  revalidatePath(`/billing/${chargeId}`);
  billingPath(chargeId, "posted");
}

export async function voidCharge(formData: FormData) {
  const user = await requireBillingUser();

  const parsed = reasonSchema.safeParse({
    chargeId: formData.get("chargeId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) redirect("/billing?error=invalid");

  const { chargeId, reason } = parsed.data;

  try {
    await db.$transaction(async (tx) => {
      const charge = await lockCharge(
        tx,
        chargeId,
        user.practiceId
      );

      if (!charge) throw new Error("CHARGE_NOT_FOUND");
      if (charge.status !== ChargeStatus.DRAFT) {
        throw new Error("CHARGE_NOT_DRAFT");
      }

      const now = new Date();
      const updatedNotes = [
        charge.notes,
        `VOID REASON (${now.toISOString()}): ${reason}`,
      ]
        .filter(Boolean)
        .join("\n\n");

      await tx.charge.update({
        where: { id: charge.id },
        data: {
          status: ChargeStatus.VOIDED,
          voidedById: user.id,
          voidedAt: now,
          notes: updatedNotes,
        },
      });

      await tx.auditEvent.create({
        data: {
          action: "CHARGE_VOIDED",
          entityType: "Charge",
          entityId: charge.id,
          actorId: user.id,
          practiceId: user.practiceId,
          metadata: {
            voidedBy: user.displayName,
            reason,
            previousStatus: "DRAFT",
            amount: charge.totalAmount.toFixed(2),
            currency: charge.currency,
          },
        },
      });
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "CHARGE_NOT_FOUND") {
        redirect("/billing?error=notfound");
      }
      if (error.message === "CHARGE_NOT_DRAFT") {
        billingPath(chargeId, "locked");
      }
    }
    throw error;
  }

  revalidatePath("/billing");
  revalidatePath(`/billing/${chargeId}`);
  billingPath(chargeId, "voided");
}