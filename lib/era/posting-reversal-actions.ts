"use server";

import {
  AdjustmentStatus,
  AdjustmentType,
  EraPostingBatchStatus,
  PaymentStatus,
  Prisma,
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

const schema = z.object({
  batchId: z.string().min(1),
  reversalNote: z.string().trim().min(10).max(2000),
  confirmation: z.literal("REVERSE"),
});

type Result =
  | "success"
  | "not-found"
  | "not-authorized"
  | "not-posted"
  | "already-reversed"
  | "no-financial-records"
  | "invalid-records"
  | "retry";

function redirectResult(eraImportId: string, result: Result): never {
  revalidatePath("/billing/era");
  revalidatePath(`/billing/era/${eraImportId}`);
  revalidatePath("/billing");
  revalidatePath("/patients");

  redirect(`/billing/era/${eraImportId}?result=era-reversal-${result}`);
}

function moneyEquals(
  left: Prisma.Decimal,
  right: Prisma.Decimal
): boolean {
  return left.equals(right);
}

function sumMoney(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce(
    (total, value) => total.plus(value),
    new Prisma.Decimal(0)
  );
}

export async function reversePostedEraBatch(formData: FormData) {
  const user = await currentUser();

  if (!user || !user.active) {
    redirect("/login");
  }

  // Only active administrators can reverse a posted ERA batch.
  if (user.role !== "ADMIN") {
    redirect("/");
  }

  const parsed = schema.safeParse({
    batchId: formData.get("batchId"),
    reversalNote: formData.get("reversalNote"),
    confirmation: formData.get("confirmation"),
  });

  if (!parsed.success) {
    redirect("/billing/era?result=era-reversal-invalid");
  }

  const { batchId, reversalNote } = parsed.data;

  const reference = await db.eraPostingBatch.findFirst({
    where: {
      id: batchId,
      practiceId: user.practiceId,
    },
    select: {
      eraImportId: true,
    },
  });

  if (!reference) {
    redirect("/billing/era?result=era-reversal-not-found");
  }

  const eraImportId = reference.eraImportId;

  try {
    const result = await db.$transaction(
      async (tx): Promise<Result> => {
        // ------------------------------------------------------------
        // 1. Lock the batch and validate its current status.
        // ------------------------------------------------------------

        const batchLocks = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "EraPostingBatch"
          WHERE "id" = ${batchId}
            AND "practiceId" = ${user.practiceId}
          FOR UPDATE
        `;

        if (batchLocks.length === 0) {
          return "not-found";
        }

        const batch = await tx.eraPostingBatch.findFirst({
          where: {
            id: batchId,
            practiceId: user.practiceId,
          },
          include: {
            reversal: true,
            claims: {
              include: {
                items: true,
              },
            },
          },
        });

        if (!batch) {
          return "not-found";
        }

        if (
          batch.status === EraPostingBatchStatus.REVERSED ||
          batch.reversal
        ) {
          return "already-reversed";
        }

        if (batch.status !== EraPostingBatchStatus.POSTED) {
          return "not-posted";
        }

        if (
          !batch.postedAt ||
          !batch.postedById ||
          batch.claims.length === 0 ||
          !batch.currency
        ) {
          return "invalid-records";
        }

        const allItems = batch.claims.flatMap((claim) => claim.items);

        if (allItems.length === 0) {
          return "no-financial-records";
        }

        // ------------------------------------------------------------
        // 2. Validate claim-level and batch-level financial totals.
        // ------------------------------------------------------------

        let batchInsuranceTotal = new Prisma.Decimal(0);
        let batchPatientResponsibilityTotal = new Prisma.Decimal(0);
        let batchContractualTotal = new Prisma.Decimal(0);

        for (const claim of batch.claims) {
          // D: Every claim must use the batch currency.
          if (claim.currency !== batch.currency) {
            return "invalid-records";
          }

          if (
            claim.paymentAmount.isNegative() ||
            claim.patientResponsibilityAmount.isNegative()
          ) {
            return "invalid-records";
          }

          const itemPaymentTotal = sumMoney(
            claim.items.map((item) => item.insurancePayment)
          );

          const itemPatientResponsibilityTotal = sumMoney(
            claim.items.map((item) => item.patientResponsibility)
          );

          const itemContractualTotal = sumMoney(
            claim.items.map((item) => item.contractualAdjustment)
          );

          // Existing insurance payment reconciliation.
          if (!moneyEquals(itemPaymentTotal, claim.paymentAmount)) {
            return "invalid-records";
          }

          // A: Claim patient responsibility must equal the sum of its items.
          if (
            !moneyEquals(
              itemPatientResponsibilityTotal,
              claim.patientResponsibilityAmount
            )
          ) {
            return "invalid-records";
          }

          if (
            claim.paymentAmount.greaterThan(0) &&
            !claim.paymentId
          ) {
            return "invalid-records";
          }

          if (
            claim.paymentAmount.equals(0) &&
            claim.paymentId
          ) {
            return "invalid-records";
          }

          const hasNegativePayment = claim.paymentAmount.isNegative();

          if (hasNegativePayment) {
            return "invalid-records";
          }

          batchInsuranceTotal = batchInsuranceTotal.plus(
            claim.paymentAmount
          );

          batchPatientResponsibilityTotal =
            batchPatientResponsibilityTotal.plus(
              claim.patientResponsibilityAmount
            );

          batchContractualTotal = batchContractualTotal.plus(
            itemContractualTotal
          );

          for (const item of claim.items) {
            if (
              item.insurancePayment.isNegative() ||
              item.patientResponsibility.isNegative() ||
              item.contractualAdjustment.isNegative() ||
              item.chargeAmount.isNegative()
            ) {
              return "invalid-records";
            }

            if (
              item.insurancePayment.greaterThan(0) &&
              !item.paymentAllocationId
            ) {
              return "invalid-records";
            }

            if (
              item.insurancePayment.equals(0) &&
              item.paymentAllocationId
            ) {
              return "invalid-records";
            }
          }
        }

        // B: Reconcile all claims and items against the batch totals.
        if (
          !moneyEquals(
            batchInsuranceTotal,
            batch.totalInsurancePayment
          ) ||
          !moneyEquals(
            batchPatientResponsibilityTotal,
            batch.totalPatientResponsibility
          ) ||
          !moneyEquals(
            batchContractualTotal,
            batch.totalContractualAdjustments
          )
        ) {
          return "invalid-records";
        }

        // ------------------------------------------------------------
        // 3. Identify the exact original payments and allocations.
        // ------------------------------------------------------------

        const originalPaymentIds = batch.claims
          .filter((claim) => claim.paymentAmount.greaterThan(0))
          .map((claim) => claim.paymentId);

        if (
          originalPaymentIds.some((id) => !id) ||
          new Set(originalPaymentIds).size !== originalPaymentIds.length
        ) {
          return "invalid-records";
        }

        const paymentIds = originalPaymentIds
          .filter((id): id is string => Boolean(id))
          .sort();

        const expectedAllocationIds = allItems
          .map((item) => item.paymentAllocationId)
          .filter((id): id is string => Boolean(id));

        if (
          new Set(expectedAllocationIds).size !==
          expectedAllocationIds.length
        ) {
          return "invalid-records";
        }

        const chargeIds = [
          ...new Set(allItems.map((item) => item.chargeId)),
        ].sort();

        if (chargeIds.length === 0) {
          return "no-financial-records";
        }

        // ------------------------------------------------------------
        // 4. Lock all affected payments and charges.
        // ------------------------------------------------------------

        // Keep a stable lock order to reduce deadlock risk.
        for (const paymentId of paymentIds) {
          const paymentLocks = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "Payment"
            WHERE "id" = ${paymentId}
              AND "practiceId" = ${user.practiceId}
            FOR UPDATE
          `;

          if (paymentLocks.length === 0) {
            return "invalid-records";
          }
        }

        for (const chargeId of chargeIds) {
          const chargeLocks = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "Charge"
            WHERE "id" = ${chargeId}
              AND "practiceId" = ${user.practiceId}
            FOR UPDATE
          `;

          if (chargeLocks.length === 0) {
            return "invalid-records";
          }
        }

        // ------------------------------------------------------------
        // 5. Reload and validate original payments.
        // ------------------------------------------------------------

        const originalPayments =
          paymentIds.length > 0
            ? await tx.payment.findMany({
                where: {
                  id: { in: paymentIds },
                  practiceId: user.practiceId,
                  status: PaymentStatus.POSTED,
                },
              })
            : [];

        if (originalPayments.length !== paymentIds.length) {
          return "invalid-records";
        }

        const paymentById = new Map(
          originalPayments.map((payment) => [payment.id, payment])
        );

        for (const claim of batch.claims) {
          if (!claim.paymentAmount.greaterThan(0)) {
            continue;
          }

          const payment = claim.paymentId
            ? paymentById.get(claim.paymentId)
            : undefined;

          if (
            !payment ||
            payment.practiceId !== user.practiceId ||
            payment.patientId !== claim.patientId ||
            payment.status !== PaymentStatus.POSTED ||
            payment.currency !== batch.currency ||
            !moneyEquals(payment.amount, claim.paymentAmount) ||
            !payment.postedAt ||
            !payment.postedById
          ) {
            return "invalid-records";
          }
        }

        // ------------------------------------------------------------
        // 6. Reload and validate the affected charges.
        // ------------------------------------------------------------

        const charges = await tx.charge.findMany({
          where: {
            id: { in: chargeIds },
            practiceId: user.practiceId,
          },
          select: {
            id: true,
            practiceId: true,
            patientId: true,
            currency: true,
          },
        });

        if (charges.length !== chargeIds.length) {
          return "invalid-records";
        }

        const chargeById = new Map(
          charges.map((charge) => [charge.id, charge])
        );

        // C and D: Validate each charge against its posting claim.
        for (const claim of batch.claims) {
          for (const item of claim.items) {
            const charge = chargeById.get(item.chargeId);

            if (
              !charge ||
              charge.practiceId !== user.practiceId ||
              charge.patientId !== claim.patientId ||
              charge.currency !== batch.currency
            ) {
              return "invalid-records";
            }
          }
        }

        // ------------------------------------------------------------
        // 7. Fetch only allocations explicitly linked to posting items.
        // ------------------------------------------------------------

        const expectedAllocations =
          expectedAllocationIds.length > 0
            ? await tx.paymentAllocation.findMany({
                where: {
                  id: { in: expectedAllocationIds },
                },
              })
            : [];

        if (
          expectedAllocations.length !== expectedAllocationIds.length
        ) {
          return "invalid-records";
        }

        const allocationById = new Map(
          expectedAllocations.map((allocation) => [
            allocation.id,
            allocation,
          ])
        );

        for (const claim of batch.claims) {
          for (const item of claim.items) {
            if (!item.paymentAllocationId) {
              continue;
            }

            const allocation = allocationById.get(
              item.paymentAllocationId
            );

            const payment = claim.paymentId
              ? paymentById.get(claim.paymentId)
              : undefined;

            if (
              !allocation ||
              !payment ||
              allocation.paymentId !== payment.id ||
              allocation.chargeId !== item.chargeId ||
              !moneyEquals(
                allocation.amount,
                item.insurancePayment
              )
            ) {
              return "invalid-records";
            }
          }
        }

        // ------------------------------------------------------------
        // 8. Reject unrelated allocations added to original payments.
        // ------------------------------------------------------------

        for (const paymentId of paymentIds) {
          const allPaymentAllocations =
            await tx.paymentAllocation.findMany({
              where: {
                paymentId,
              },
              select: {
                id: true,
              },
            });

          const expectedForPayment = expectedAllocations
            .filter((allocation) => allocation.paymentId === paymentId)
            .map((allocation) => allocation.id)
            .sort();

          const actualForPayment = allPaymentAllocations
            .map((allocation) => allocation.id)
            .sort();

          if (
            expectedForPayment.length !== actualForPayment.length ||
            expectedForPayment.some(
              (id, index) => id !== actualForPayment[index]
            )
          ) {
            return "invalid-records";
          }
        }

        // ------------------------------------------------------------
        // 9. Reconcile allocations against original payment amounts.
        // ------------------------------------------------------------

        for (const claim of batch.claims) {
          if (!claim.paymentId) {
            continue;
          }

          const paymentAllocations = expectedAllocations.filter(
            (allocation) => allocation.paymentId === claim.paymentId
          );

          const allocationTotal = sumMoney(
            paymentAllocations.map((allocation) => allocation.amount)
          );

          if (!moneyEquals(allocationTotal, claim.paymentAmount)) {
            return "invalid-records";
          }
        }

        // ------------------------------------------------------------
        // 10. Reload and validate original contractual adjustments.
        // ------------------------------------------------------------

        const itemIds = allItems.map((item) => item.id);

        const originalAdjustments =
          await tx.chargeAdjustment.findMany({
            where: {
              practiceId: user.practiceId,
              status: AdjustmentStatus.POSTED,
              eraPostingItemId: { in: itemIds },
            },
          });

        for (const item of allItems) {
          const itemAdjustments = originalAdjustments.filter(
            (adjustment) => adjustment.eraPostingItemId === item.id
          );

          if (
            itemAdjustments.some(
              (adjustment) =>
                adjustment.chargeId !== item.chargeId ||
                adjustment.practiceId !== user.practiceId ||
                adjustment.amount.isNegative() ||
                adjustment.amount.equals(0)
            )
          ) {
            return "invalid-records";
          }

          const adjustmentTotal = sumMoney(
            itemAdjustments.map((adjustment) => adjustment.amount)
          );

          if (
            !moneyEquals(
              adjustmentTotal,
              item.contractualAdjustment
            )
          ) {
            return "invalid-records";
          }

          const claim = batch.claims.find((postingClaim) =>
            postingClaim.items.some(
              (postingItem) => postingItem.id === item.id
            )
          );

          if (
            !claim ||
            itemAdjustments.some(
              (adjustment) =>
                adjustment.patientId !== claim.patientId
            )
          ) {
            return "invalid-records";
          }
        }

        // If no financial records exist, do not create an empty reversal.
        if (
          originalPayments.length === 0 &&
          expectedAllocations.length === 0 &&
          originalAdjustments.length === 0
        ) {
          return "no-financial-records";
        }

        // ------------------------------------------------------------
        // 11. Prevent duplicate reversals of individual financial rows.
        // ------------------------------------------------------------

        const paymentReversals =
          paymentIds.length > 0
            ? await tx.payment.findMany({
                where: {
                  practiceId: user.practiceId,
                  reversalOfPaymentId: { in: paymentIds },
                },
                select: {
                  reversalOfPaymentId: true,
                },
              })
            : [];

        const allocationReversals =
          expectedAllocationIds.length > 0
            ? await tx.paymentAllocation.findMany({
                where: {
                  reversalOfAllocationId: {
                    in: expectedAllocationIds,
                  },
                },
                select: {
                  reversalOfAllocationId: true,
                },
              })
            : [];

        const adjustmentIds = originalAdjustments.map(
          (adjustment) => adjustment.id
        );

        const adjustmentReversals =
          adjustmentIds.length > 0
            ? await tx.chargeAdjustment.findMany({
                where: {
                  reversalOfAdjustmentId: {
                    in: adjustmentIds,
                  },
                },
                select: {
                  reversalOfAdjustmentId: true,
                },
              })
            : [];

        if (
          paymentReversals.length > 0 ||
          allocationReversals.length > 0 ||
          adjustmentReversals.length > 0
        ) {
          return "invalid-records";
        }

        // ------------------------------------------------------------
        // 12. Confirm the original batch-posted audit event exists.
        // ------------------------------------------------------------

        const originalPostingAudit = await tx.auditEvent.findFirst({
          where: {
            practiceId: user.practiceId,
            entityType: "EraPostingBatch",
            entityId: batch.id,
            action: "ERA_POSTING_BATCH_POSTED",
          },
          select: {
            id: true,
          },
        });

        if (!originalPostingAudit) {
          return "invalid-records";
        }

        // ============================================================
        // All validation is complete.
        // Financial writes begin only below this point.
        // ============================================================

        const reversedAt = new Date();

        const reversal = await tx.eraPostingReversal.create({
          data: {
            batchId: batch.id,
            practiceId: user.practiceId,
            reversedById: user.id,
            note: reversalNote,
          },
        });

        const reversalPaymentByOriginal = new Map<string, string>();

        // ------------------------------------------------------------
        // 13. Create negative compensating payments.
        // ------------------------------------------------------------

        for (const original of originalPayments) {
          const negativeAmount = new Prisma.Decimal(0).minus(
            original.amount
          );

          const reversalPayment = await tx.payment.create({
            data: {
              practiceId: original.practiceId,
              patientId: original.patientId,
              source: original.source,
              method: original.method,
              status: PaymentStatus.POSTED,
              amount: negativeAmount,
              currency: original.currency,
              referenceNumber: original.referenceNumber,
              receivedAt: reversedAt,
              notes:
                `Reversal of payment ${original.id}. ` +
                `ERA batch ${batch.id}. ${reversalNote}`,
              createdById: user.id,
              reviewedById: user.id,
              reviewedAt: reversedAt,
              postedById: user.id,
              postedAt: reversedAt,
              reversalOfPaymentId: original.id,
              eraPostingReversalId: reversal.id,
            },
          });

          reversalPaymentByOriginal.set(
            original.id,
            reversalPayment.id
          );

          await tx.auditEvent.create({
            data: {
              action: "PAYMENT_REVERSED",
              entityType: "Payment",
              entityId: reversalPayment.id,
              practiceId: user.practiceId,
              actorId: user.id,
              metadata: {
                originalPaymentId: original.id,
                reversalPaymentId: reversalPayment.id,
                originalAmount: original.amount.toFixed(2),
                reversalAmount: negativeAmount.toFixed(2),
                postingBatchId: batch.id,
                reversalId: reversal.id,
              },
            },
          });
        }

        // ------------------------------------------------------------
        // 14. Create negative compensating allocations.
        // ------------------------------------------------------------

        for (const original of expectedAllocations) {
          const reversalPaymentId = reversalPaymentByOriginal.get(
            original.paymentId
          );

          if (!reversalPaymentId) {
            throw new Error("Reversal payment was not created.");
          }

          const negativeAmount = new Prisma.Decimal(0).minus(
            original.amount
          );

          const reversalAllocation =
            await tx.paymentAllocation.create({
              data: {
                paymentId: reversalPaymentId,
                chargeId: original.chargeId,
                amount: negativeAmount,
                reversalOfAllocationId: original.id,
                eraPostingReversalId: reversal.id,
              },
            });

          await tx.auditEvent.create({
            data: {
              action: "PAYMENT_ALLOCATION_REVERSED",
              entityType: "PaymentAllocation",
              entityId: reversalAllocation.id,
              practiceId: user.practiceId,
              actorId: user.id,
              metadata: {
                originalAllocationId: original.id,
                reversalAllocationId: reversalAllocation.id,
                chargeId: original.chargeId,
                originalAmount: original.amount.toFixed(2),
                reversalAmount: negativeAmount.toFixed(2),
                postingBatchId: batch.id,
                reversalId: reversal.id,
              },
            },
          });
        }

        // ------------------------------------------------------------
        // 15. Reverse contractual adjustments with opposite types.
        // ------------------------------------------------------------

        for (const original of originalAdjustments) {
          const oppositeType =
            original.type === AdjustmentType.CREDIT
              ? AdjustmentType.DEBIT
              : AdjustmentType.CREDIT;

          const reversalAdjustment =
            await tx.chargeAdjustment.create({
              data: {
                chargeId: original.chargeId,
                practiceId: original.practiceId,
                patientId: original.patientId,
                type: oppositeType,
                status: AdjustmentStatus.POSTED,
                amount: original.amount,
                reason: `Reversal of adjustment ${original.id}`,
                notes: `ERA batch ${batch.id}. ${reversalNote}`,
                createdById: user.id,
                reviewedById: user.id,
                reviewedAt: reversedAt,
                postedById: user.id,
                postedAt: reversedAt,
                eraPostingItemId: original.eraPostingItemId,
                reversalOfAdjustmentId: original.id,
                eraPostingReversalId: reversal.id,
              },
            });

          await tx.auditEvent.create({
            data: {
              action: "CHARGE_ADJUSTMENT_REVERSED",
              entityType: "ChargeAdjustment",
              entityId: reversalAdjustment.id,
              practiceId: user.practiceId,
              actorId: user.id,
              metadata: {
                originalAdjustmentId: original.id,
                reversalAdjustmentId: reversalAdjustment.id,
                chargeId: original.chargeId,
                originalType: original.type,
                reversalType: oppositeType,
                amount: original.amount.toFixed(2),
                postingBatchId: batch.id,
                reversalId: reversal.id,
              },
            },
          });
        }

        // ------------------------------------------------------------
        // 16. Preserve originals and mark the batch as reversed.
        // ------------------------------------------------------------

        await tx.eraPostingBatch.update({
          where: {
            id: batch.id,
          },
          data: {
            status: EraPostingBatchStatus.REVERSED,
            reversedById: user.id,
            reversedAt,
            reversalNote,
          },
        });

        await tx.auditEvent.create({
          data: {
            action: "ERA_POSTING_BATCH_REVERSED",
            entityType: "EraPostingBatch",
            entityId: batch.id,
            practiceId: user.practiceId,
            actorId: user.id,
            metadata: {
              eraImportId: batch.eraImportId,
              reversalId: reversal.id,
              reversedById: user.id,
              reversedAt: reversedAt.toISOString(),
              reversalNote,
              originalPaymentCount: originalPayments.length,
              originalAllocationCount: expectedAllocations.length,
              originalAdjustmentCount: originalAdjustments.length,
              reversalPaymentsCreated: originalPayments.length,
              reversalAllocationsCreated: expectedAllocations.length,
              reversalAdjustmentsCreated: originalAdjustments.length,
              originalRecordsPreserved: true,
              financialReversalPerformed: true,
            },
          },
        });

        return "success";
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 30000,
      }
    );

    redirectResult(eraImportId, result);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      redirectResult(eraImportId, "retry");
    }

    throw error;
  }
}