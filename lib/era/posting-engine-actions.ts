"use server";

import {
  AdjustmentStatus,
  AdjustmentType,
  ChargeStatus,
  EraAdjustmentTreatment,
  EraExceptionStatus,
  EraImportStatus,
  EraMatchStatus,
  EraPostingBatchStatus,
  PaymentMethod,
  PaymentSource,
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
  confirmation: z.literal("POST"),
});

type Result =
  | "success"
  | "not-found"
  | "not-approved"
  | "already-posted"
  | "invalid-batch"
  | "claim-invalid"
  | "charge-invalid"
  | "payment-total-mismatch"
  | "responsibility-total-mismatch"
  | "contractual-total-mismatch"
  | "charge-balance-exceeded"
  | "adjustment-invalid"
  | "retry";

type Snapshot = {
  groupCode?: string;
  reasonCode?: string;
  amount?: string;
  treatment?: string;
  description?: string;
};

function money(value: Prisma.Decimal | string | number) {
  return new Prisma.Decimal(value);
}

function redirectResult(importId: string, result: Result): never {
  revalidatePath("/billing/era");
  revalidatePath(`/billing/era/${importId}`);
  revalidatePath("/billing");
  revalidatePath("/patients");

  redirect(`/billing/era/${importId}?result=era-posting-${result}`);
}

async function billingUser() {
  const user = await currentUser();

  if (!user || !user.active) redirect("/login");
  if (!["ADMIN", "BILLING"].includes(user.role)) redirect("/");

  return user;
}

function paymentMethod(code: string | null): PaymentMethod {
  const value = (code ?? "").trim().toUpperCase();

  if (["ACH", "EFT", "WIRE"].includes(value)) {
    return PaymentMethod.EFT;
  }

  if (["CHK", "CHECK"].includes(value)) {
    return PaymentMethod.CHECK;
  }

  return PaymentMethod.OTHER;
}

function snapshotsOf(value: Prisma.JsonValue | null): Snapshot[] {
  if (!Array.isArray(value)) return [];
  return value as Snapshot[];
}

function sum(
  values: Prisma.Decimal[],
): Prisma.Decimal {
  return values.reduce((total, value) => total.plus(value), money(0));
}

export async function postApprovedEraBatch(formData: FormData) {
  const user = await billingUser();

  const parsed = schema.safeParse({
    batchId: formData.get("batchId"),
    confirmation: formData.get("confirmation"),
  });

  if (!parsed.success) {
    redirect("/billing/era?result=era-posting-invalid-batch");
  }

  const { batchId } = parsed.data;

  const reference = await db.eraPostingBatch.findFirst({
    where: {
      id: batchId,
      practiceId: user.practiceId,
    },
    select: { eraImportId: true },
  });

  if (!reference) {
    redirect("/billing/era?result=era-posting-not-found");
  }

  const importId = reference.eraImportId;

  try {
    const result = await db.$transaction(
      async (tx): Promise<Result> => {
        // Lock the batch to prevent concurrent or duplicate posting.
        const batchLocks = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "EraPostingBatch"
          WHERE "id" = ${batchId}
            AND "practiceId" = ${user.practiceId}
          FOR UPDATE
        `;

        if (batchLocks.length === 0) return "not-found";

        const batch = await tx.eraPostingBatch.findFirst({
          where: {
            id: batchId,
            practiceId: user.practiceId,
          },
          include: {
            claims: {
              include: {
                eraClaim: {
                  include: {
                    serviceLines: true,
                    exceptions: true,
                  },
                },
                items: true,
              },
            },
            eraImport: {
              include: {
                exceptions: true,
                providerAdjustments: true,
              },
            },
          },
        });

        if (!batch) return "not-found";

        if (batch.status === EraPostingBatchStatus.POSTED) {
          return "already-posted";
        }

        if (batch.status !== EraPostingBatchStatus.APPROVED) {
          return "not-approved";
        }

        if (
          !batch.approvedById ||
          !batch.approvedAt ||
          batch.approvedById === batch.preparedById
        ) {
          return "invalid-batch";
        }

        if (
          batch.currency !== "USD" ||
          batch.eraImport.currency !== "USD" ||
          batch.eraImport.status === EraImportStatus.POSTED ||
          batch.claims.length === 0 ||
          batch.eraImport.exceptions.some(
            (item) => item.status === EraExceptionStatus.OPEN
          ) ||
          batch.eraImport.providerAdjustments.some(
            (item) => !item.amount.isZero()
          )
        ) {
          return "invalid-batch";
        }

        // Verify the independent approval audit record.
        const approval = await tx.auditEvent.findFirst({
          where: {
            practiceId: user.practiceId,
            entityType: "EraPostingBatch",
            entityId: batch.id,
            action: "ERA_POSTING_BATCH_APPROVED",
            actorId: batch.approvedById,
          },
          select: { id: true },
        });

        if (!approval) return "not-approved";

        const reconciliationApproval = await tx.auditEvent.findFirst({
          where: {
            practiceId: user.practiceId,
            entityType: "EraImport",
            entityId: batch.eraImportId,
            action: "ERA_RECONCILIATION_APPROVED",
          },
          select: { id: true },
        });

        if (!reconciliationApproval) return "not-approved";

        // Reconcile deposit and claim-level payment totals.
        const claimPaymentTotal = sum(
          batch.claims.map((claim) => claim.paymentAmount)
        );

        if (
          !batch.eraImport.paymentAmount ||
          !claimPaymentTotal.equals(batch.totalInsurancePayment) ||
          !claimPaymentTotal.equals(batch.eraImport.paymentAmount)
        ) {
          return "payment-total-mismatch";
        }

        // Reconcile patient responsibility at claim and batch levels.
        const claimResponsibilityTotal = sum(
          batch.claims.map(
            (claim) => claim.patientResponsibilityAmount
          )
        );

        if (
          !claimResponsibilityTotal.equals(
            batch.totalPatientResponsibility
          )
        ) {
          return "responsibility-total-mismatch";
        }

        // Validate claims, patients, service lines and posting items.
        for (const claim of batch.claims) {
          if (
            !claim.patientId ||
            !claim.insuranceClaimId ||
            claim.eraClaim.matchStatus !== EraMatchStatus.MATCHED ||
            claim.eraClaim.insuranceClaimId !== claim.insuranceClaimId ||
            claim.eraClaim.patientId !== claim.patientId ||
            claim.eraClaim.exceptions.some(
              (item) => item.status === EraExceptionStatus.OPEN
            ) ||
            claim.eraClaim.serviceLines.length === 0 ||
            claim.items.length === 0 ||
            claim.paymentId
          ) {
            return "claim-invalid";
          }

          if (
            claim.items.some(
              (item) =>
                item.paymentAllocationId ||
                item.insurancePayment.lessThan(0) ||
                item.patientResponsibility.lessThan(0) ||
                item.contractualAdjustment.lessThan(0) ||
                item.chargeAmount.lessThanOrEqualTo(0)
            )
          ) {
            return "claim-invalid";
          }

          const itemPaymentTotal = sum(
            claim.items.map((item) => item.insurancePayment)
          );

          if (!itemPaymentTotal.equals(claim.paymentAmount)) {
            return "payment-total-mismatch";
          }

          const itemResponsibilityTotal = sum(
            claim.items.map((item) => item.patientResponsibility)
          );

          if (
            !itemResponsibilityTotal.equals(
              claim.patientResponsibilityAmount
            )
          ) {
            return "responsibility-total-mismatch";
          }
        }

        const itemIds = batch.claims.flatMap((claim) =>
          claim.items.map((item) => item.id)
        );

        const linkedLines = await tx.eraServiceLine.findMany({
          where: {
            postingItemId: { in: itemIds },
          },
          include: {
            chargeLine: {
              include: {
                charge: true,
              },
            },
          },
        });

        // Every ERA service line must be linked exactly once to the
        // expected posting item, charge line, patient and practice.
        const lineIds = new Set<string>();
        const billedByChargeLine = new Map<string, Prisma.Decimal>();

        for (const claim of batch.claims) {
          for (const line of claim.eraClaim.serviceLines) {
            const matches = linkedLines.filter(
              (linked) => linked.id === line.id
            );

            if (
              matches.length !== 1 ||
              line.matchStatus !== EraMatchStatus.MATCHED ||
              !line.chargeLineId
            ) {
              return "claim-invalid";
            }

            const linked = matches[0];

            if (
              lineIds.has(linked.id) ||
              linked.eraClaimId !== claim.eraClaimId ||
              linked.chargeLineId !== line.chargeLineId ||
              linked.matchStatus !== EraMatchStatus.MATCHED ||
              !linked.chargeLine ||
              linked.chargeLine.chargeId !==
                linked.chargeLine.charge.id ||
              linked.chargeLine.charge.patientId !== claim.patientId ||
              linked.chargeLine.charge.practiceId !== user.practiceId ||
              linked.chargeLine.charge.status !== ChargeStatus.POSTED
            ) {
              return "claim-invalid";
            }

            lineIds.add(linked.id);

            if (!linked.chargeLineId) return "claim-invalid";

            const chargeLineId = linked.chargeLineId;
            const previous =
              billedByChargeLine.get(chargeLineId) ?? money(0);

            billedByChargeLine.set(
              chargeLineId,
              previous.plus(line.lineChargeAmount)
            );
          }
        }

        // The total ERA billed amount mapped to a charge line must
        // never exceed that internal charge line's billed amount.
        for (const linked of linkedLines) {
          if (!linked.chargeLine || !linked.chargeLineId) {
            return "claim-invalid";
          }

          const billed = billedByChargeLine.get(
            linked.chargeLineId
          );

          if (
            !billed ||
            billed.greaterThan(linked.chargeLine.lineTotal)
          ) {
            return "charge-invalid";
          }
        }

        if (lineIds.size !== linkedLines.length) {
          return "claim-invalid";
        }

        // Validate each posting item's totals against its linked
        // original ERA service lines and immutable adjustment snapshot.
        let contractualBatchTotal = money(0);

        const plannedByCharge = new Map<
          string,
          {
            patientId: string;
            payment: Prisma.Decimal;
            credit: Prisma.Decimal;
            debit: Prisma.Decimal;
          }
        >();

        for (const claim of batch.claims) {
          for (const item of claim.items) {
            const itemLines = linkedLines.filter(
              (line) =>
                line.postingItemId === item.id &&
                line.eraClaimId === claim.eraClaimId
            );

            if (itemLines.length === 0) return "claim-invalid";

            const lineChargeTotal = sum(
              itemLines.map((line) => line.lineChargeAmount)
            );

            const linePaymentTotal = sum(
              itemLines.map((line) => line.linePaymentAmount)
            );

            if (
              !lineChargeTotal.equals(item.chargeAmount) ||
              !linePaymentTotal.equals(item.insurancePayment)
            ) {
              return "claim-invalid";
            }

            let snapshotPR = money(0);
            let snapshotContractual = money(0);
            let credit = money(0);
            let debit = money(0);

            for (const snapshot of snapshotsOf(item.adjustmentSnapshot)) {
              const amount = money(snapshot.amount ?? "0");

              if (amount.lessThan(0)) return "adjustment-invalid";

              if (
                snapshot.treatment ===
                EraAdjustmentTreatment.PATIENT_RESPONSIBILITY
              ) {
                snapshotPR = snapshotPR.plus(amount);
              } else if (
                snapshot.treatment ===
                EraAdjustmentTreatment.CONTRACTUAL_CREDIT
              ) {
                credit = credit.plus(amount);
                snapshotContractual =
                  snapshotContractual.plus(amount);
              } else if (
                snapshot.treatment ===
                EraAdjustmentTreatment.CONTRACTUAL_DEBIT
              ) {
                debit = debit.plus(amount);
                snapshotContractual =
                  snapshotContractual.plus(amount);
              } else if (
                snapshot.treatment ===
                EraAdjustmentTreatment.REVIEW_REQUIRED
              ) {
                return "adjustment-invalid";
              } else {
                return "adjustment-invalid";
              }
            }

            if (
              !snapshotPR.equals(item.patientResponsibility) ||
              !snapshotContractual.equals(
                item.contractualAdjustment
              )
            ) {
              return "adjustment-invalid";
            }

            // The ERA line must reconcile completely using the
            // supported payment, PR and contractual adjustment types.
            const expectedBilled = item.insurancePayment
              .plus(item.patientResponsibility)
              .plus(credit)
              .minus(debit);

            if (!expectedBilled.equals(item.chargeAmount)) {
              return "adjustment-invalid";
            }

            contractualBatchTotal =
              contractualBatchTotal.plus(snapshotContractual);

            const existing = plannedByCharge.get(item.chargeId);

            if (existing) {
              if (existing.patientId !== claim.patientId) {
                return "charge-invalid";
              }

              existing.payment = existing.payment.plus(
                item.insurancePayment
              );
              existing.credit = existing.credit.plus(credit);
              existing.debit = existing.debit.plus(debit);
            } else {
              plannedByCharge.set(item.chargeId, {
                patientId: claim.patientId!,
                payment: item.insurancePayment,
                credit,
                debit,
              });
            }
          }
        }

        if (
          !contractualBatchTotal.equals(
            batch.totalContractualAdjustments
          )
        ) {
          return "contractual-total-mismatch";
        }

        // Lock affected charges in stable order.
        const chargeIds = [...plannedByCharge.keys()].sort();

        for (const chargeId of chargeIds) {
          const locks = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "Charge"
            WHERE "id" = ${chargeId}
              AND "practiceId" = ${user.practiceId}
            FOR UPDATE
          `;

          if (locks.length === 0) return "charge-invalid";
        }

        // Recalculate outstanding balances from posted financial rows.
        for (const [chargeId, plan] of plannedByCharge) {
          const charge = await tx.charge.findFirst({
            where: {
              id: chargeId,
              practiceId: user.practiceId,
              patientId: plan.patientId,
              status: ChargeStatus.POSTED,
            },
            include: {
              adjustments: {
                where: { status: AdjustmentStatus.POSTED },
              },
              paymentAllocations: {
                where: {
                  payment: { status: PaymentStatus.POSTED },
                },
              },
            },
          });

          if (!charge || charge.currency !== batch.currency) {
            return "charge-invalid";
          }

          let credits = money(0);
          let debits = money(0);

          for (const adjustment of charge.adjustments) {
            if (adjustment.type === AdjustmentType.CREDIT) {
              credits = credits.plus(adjustment.amount);
            } else {
              debits = debits.plus(adjustment.amount);
            }
          }

          const allocated = sum(
            charge.paymentAllocations.map(
              (allocation) => allocation.amount
            )
          );

          const outstanding = charge.totalAmount
            .plus(debits)
            .minus(credits)
            .minus(allocated);

          if (outstanding.lessThan(0)) return "charge-invalid";

          // Debit adjustments increase the balance; credits reduce it.
          const remainingAfterPosting = outstanding
            .plus(plan.debit)
            .minus(plan.payment)
            .minus(plan.credit);

          if (remainingAfterPosting.lessThan(0)) {
            return "charge-balance-exceeded";
          }
        }

        // No financial records have been created before this point.
        // From here onward all writes are in this same transaction.
        const postedAt = new Date();

        for (const claim of batch.claims) {
          let paymentId: string | null = null;

          if (claim.paymentAmount.greaterThan(0)) {
            const payment = await tx.payment.create({
              data: {
                practiceId: user.practiceId,
                patientId: claim.patientId!,
                source: PaymentSource.INSURANCE,
                method: paymentMethod(
                  batch.eraImport.paymentMethodCode
                ),
                status: PaymentStatus.POSTED,
                amount: claim.paymentAmount,
                currency: batch.currency,
                referenceNumber:
                  batch.eraImport.traceNumber ??
                  batch.eraImport.fileName,
                receivedAt:
                  batch.eraImport.paymentEffectiveDate ??
                  batch.eraImport.receivedAt,
                notes: `Synthetic ERA posting. Batch ${batch.id}.`,
                createdById: batch.preparedById,
                reviewedById: batch.approvedById,
                reviewedAt: batch.approvedAt,
                postedById: user.id,
                postedAt,
              },
            });

            paymentId = payment.id;

            await tx.auditEvent.create({
              data: {
                action: "PAYMENT_POSTED",
                entityType: "Payment",
                entityId: payment.id,
                practiceId: user.practiceId,
                actorId: user.id,
                metadata: {
                  source: PaymentSource.INSURANCE,
                  method: payment.method,
                  amount: payment.amount.toFixed(2),
                  patientId: payment.patientId,
                  eraImportId: batch.eraImportId,
                  postingBatchId: batch.id,
                  postingClaimId: claim.id,
                },
              },
            });
          }

          await tx.eraPostingClaim.update({
            where: { id: claim.id },
            data: { paymentId },
          });

          for (const item of claim.items) {
            if (item.insurancePayment.greaterThan(0)) {
              if (!paymentId) {
                throw new Error(
                  "Posting invariant failed: payment is missing for a positive allocation."
                );
              }

              const allocation = await tx.paymentAllocation.create({
                data: {
                  paymentId,
                  chargeId: item.chargeId,
                  amount: item.insurancePayment,
                },
              });

              await tx.eraPostingItem.update({
                where: { id: item.id },
                data: {
                  paymentAllocationId: allocation.id,
                },
              });

              await tx.auditEvent.create({
                data: {
                  action: "PAYMENT_ALLOCATED",
                  entityType: "Payment",
                  entityId: paymentId,
                  practiceId: user.practiceId,
                  actorId: user.id,
                  metadata: {
                    allocationId: allocation.id,
                    chargeId: item.chargeId,
                    amount: allocation.amount.toFixed(2),
                    postingBatchId: batch.id,
                    postingItemId: item.id,
                  },
                },
              });
            }

            for (const snapshot of snapshotsOf(
              item.adjustmentSnapshot
            )) {
              const isCredit =
                snapshot.treatment ===
                EraAdjustmentTreatment.CONTRACTUAL_CREDIT;

              const isDebit =
                snapshot.treatment ===
                EraAdjustmentTreatment.CONTRACTUAL_DEBIT;

              if (!isCredit && !isDebit) continue;

              const amount = money(snapshot.amount ?? "0");
              if (amount.isZero()) continue;

              const adjustment = await tx.chargeAdjustment.create({
                data: {
                  chargeId: item.chargeId,
                  practiceId: user.practiceId,
                  patientId: claim.patientId!,
                  type: isCredit
                    ? AdjustmentType.CREDIT
                    : AdjustmentType.DEBIT,
                  status: AdjustmentStatus.POSTED,
                  amount,
                  reason:
                    `${snapshot.groupCode ?? "ERA"}/` +
                    `${snapshot.reasonCode ?? "ADJ"}: ` +
                    `${snapshot.description ?? "Contractual adjustment"}`,
                  notes: `ERA posting batch ${batch.id}`,
                  createdById: batch.preparedById,
                  reviewedById: batch.approvedById,
                  reviewedAt: batch.approvedAt,
                  postedById: user.id,
                  postedAt,
                  eraPostingItemId: item.id,
                },
              });

              await tx.auditEvent.create({
                data: {
                  action: "CHARGE_ADJUSTMENT_POSTED",
                  entityType: "ChargeAdjustment",
                  entityId: adjustment.id,
                  practiceId: user.practiceId,
                  actorId: user.id,
                  metadata: {
                    chargeId: item.chargeId,
                    amount: amount.toFixed(2),
                    type: adjustment.type,
                    postingBatchId: batch.id,
                    postingItemId: item.id,
                  },
                },
              });
            }
          }
        }

        await tx.eraPostingBatch.update({
          where: { id: batch.id },
          data: {
            status: EraPostingBatchStatus.POSTED,
            postedById: user.id,
            postedAt,
          },
        });

        await tx.eraImport.update({
          where: { id: batch.eraImportId },
          data: {
            status: EraImportStatus.POSTED,
            postedAt,
          },
        });

        await tx.auditEvent.create({
          data: {
            action: "ERA_POSTING_BATCH_POSTED",
            entityType: "EraPostingBatch",
            entityId: batch.id,
            practiceId: user.practiceId,
            actorId: user.id,
            metadata: {
              eraImportId: batch.eraImportId,
              preparedById: batch.preparedById,
              approvedById: batch.approvedById,
              postedById: user.id,
              postedAt: postedAt.toISOString(),
              claimCount: batch.claims.length,
              totalInsurancePayment:
                batch.totalInsurancePayment.toFixed(2),
              totalPatientResponsibility:
                batch.totalPatientResponsibility.toFixed(2),
              totalContractualAdjustments:
                batch.totalContractualAdjustments.toFixed(2),
              financialPostingPerformed: true,
              paymentsCreated: true,
              allocationsCreated: true,
              adjustmentsCreated:
                !batch.totalContractualAdjustments.isZero(),
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

    redirectResult(importId, result);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      redirectResult(importId, "retry");
    }

    throw error;
  }
}