
"use server";

import { PaymentStatus, ChargeStatus, AdjustmentStatus, AdjustmentType, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "./auth";
import { db } from "./db";

const allocationSchema = z.object({
  paymentId: z.string().min(1),
  chargeId: z.string().min(1),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount with up to two decimal places.")
    .refine((value) => {
      const amount = Number(value);
      return Number.isFinite(amount) && amount > 0 && amount <= 999999.99;
    }, "Allocation amount must be greater than zero and no more than 999,999.99."),
});

type AllocationResult =
  | "success"
  | "not-found"
  | "invalid-data"
  | "payment-not-posted"
  | "charge-not-posted"
  | "patient-mismatch"
  | "payment-exceeded"
  | "charge-exceeded";

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

function allocationRedirect(result: string): never {
  revalidatePath("/billing");
  revalidatePath("/patients");
  redirect(`/billing?result=${result}`);
}

export async function allocatePayment(formData: FormData) {
  const user = await billingUser();

  const parsed = allocationSchema.safeParse({
    paymentId: formData.get("paymentId"),
    chargeId: formData.get("chargeId"),
    amount: formData.get("amount"),
  });

  if (!parsed.success) {
    allocationRedirect("invalid-data");
  }

  const { paymentId, chargeId } = parsed.data;
  const allocationAmount = new Prisma.Decimal(parsed.data.amount);

  const result = await db.$transaction(async (tx) => {
    // Lock payment first. This serializes allocations against the same payment.
    const paymentLocks = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Payment"
      WHERE "id" = ${paymentId}
        AND "practiceId" = ${user.practiceId}
      FOR UPDATE
    `;

    if (paymentLocks.length === 0) {
      return "not-found" as AllocationResult;
    }

    // Lock charge as well. This serializes allocations from different payments
    // against the same outstanding charge.
    const chargeLocks = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Charge"
      WHERE "id" = ${chargeId}
        AND "practiceId" = ${user.practiceId}
      FOR UPDATE
    `;

    if (chargeLocks.length === 0) {
      return "not-found" as AllocationResult;
    }

    const payment = await tx.payment.findFirst({
      where: {
        id: paymentId,
        practiceId: user.practiceId,
      },
    });

    const charge = await tx.charge.findFirst({
      where: {
        id: chargeId,
        practiceId: user.practiceId,
      },
    });

    if (!payment || !charge) {
      return "not-found" as AllocationResult;
    }

    if (payment.status !== PaymentStatus.POSTED) {
      return "payment-not-posted" as AllocationResult;
    }

    if (charge.status !== ChargeStatus.POSTED) {
      return "charge-not-posted" as AllocationResult;
    }

    if (payment.patientId !== charge.patientId) {
      return "patient-mismatch" as AllocationResult;
    }

    if (payment.currency !== charge.currency) {
      return "invalid-data" as AllocationResult;
    }

    // Calculate the payment's remaining unapplied amount.
    const paymentAllocationAggregate =
      await tx.paymentAllocation.aggregate({
        where: {
          paymentId: payment.id,
        },
        _sum: {
          amount: true,
        },
      });

    const paymentAlreadyAllocated =
      paymentAllocationAggregate._sum.amount ??
      new Prisma.Decimal(0);

    const paymentRemaining = payment.amount.minus(
      paymentAlreadyAllocated
    );

    if (allocationAmount.greaterThan(paymentRemaining)) {
      return "payment-exceeded" as AllocationResult;
    }

    // Calculate the charge balance after posted adjustments.
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

    let credits = new Prisma.Decimal(0);
    let debits = new Prisma.Decimal(0);

    for (const adjustment of postedAdjustments) {
      if (adjustment.type === AdjustmentType.CREDIT) {
        credits = credits.plus(adjustment.amount);
      } else {
        debits = debits.plus(adjustment.amount);
      }
    }

    const chargeAllocationAggregate =
      await tx.paymentAllocation.aggregate({
        where: {
          chargeId: charge.id,
          payment: {
            status: PaymentStatus.POSTED,
          },
        },
        _sum: {
          amount: true,
        },
      });

    const chargeAlreadyPaid =
      chargeAllocationAggregate._sum.amount ??
      new Prisma.Decimal(0);

    const chargeBalance = charge.totalAmount
      .plus(debits)
      .minus(credits)
      .minus(chargeAlreadyPaid);

    if (chargeBalance.lessThanOrEqualTo(0)) {
      return "charge-exceeded" as AllocationResult;
    }

    if (allocationAmount.greaterThan(chargeBalance)) {
      return "charge-exceeded" as AllocationResult;
    }

    // Upsert because the schema permits one allocation row per payment/charge.
    const existingAllocation = await tx.paymentAllocation.findUnique({
      where: {
        paymentId_chargeId: {
          paymentId: payment.id,
          chargeId: charge.id,
        },
      },
    });

    const newAllocationAmount = existingAllocation
      ? existingAllocation.amount.plus(allocationAmount)
      : allocationAmount;

    const allocation = existingAllocation
      ? await tx.paymentAllocation.update({
          where: {
            id: existingAllocation.id,
          },
          data: {
            amount: newAllocationAmount,
          },
        })
      : await tx.paymentAllocation.create({
          data: {
            paymentId: payment.id,
            chargeId: charge.id,
            amount: allocationAmount,
          },
        });

    await tx.auditEvent.create({
      data: {
        action: "PAYMENT_ALLOCATED",
        entityType: "Payment",
        entityId: payment.id,
        practiceId: user.practiceId,
        actorId: user.id,
        metadata: {
          paymentId: payment.id,
          chargeId: charge.id,
          allocationId: allocation.id,
          patientId: payment.patientId,
          allocationAmount: allocationAmount.toFixed(2),
          totalAllocatedToCharge: newAllocationAmount.toFixed(2),
          paymentAmount: payment.amount.toFixed(2),
        },
      },
    });

    return "success" as AllocationResult;
  });

  if (result !== "success") {
    allocationRedirect(result);
  }

  allocationRedirect("payment-allocated");
}