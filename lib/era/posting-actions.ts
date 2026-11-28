
"use server";

import {
  AdjustmentType,
  ChargeStatus,
  EraAdjustmentTreatment,
  EraExceptionStatus,
  EraMatchStatus,
  EraPostingBatchStatus,
  Prisma,
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

async function billingUser() {
  const user = await currentUser();

  if (!user || !user.active) redirect("/login");
  if (!["ADMIN", "BILLING"].includes(user.role)) redirect("/");

  return user;
}

function redirectToImport(importId: string, result: string): never {
  revalidatePath("/billing/era");
  revalidatePath(`/billing/era/${importId}`);
  redirect(`/billing/era/${importId}?result=${result}`);
}

function money(value: Prisma.Decimal | number | string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function add(
  current: Prisma.Decimal,
  value: Prisma.Decimal
): Prisma.Decimal {
  return current.plus(value);
}

function adjustmentSnapshot(
  adjustment: {
    id: string;
    groupCode: string;
    reasonCode: string;
    amount: Prisma.Decimal;
    quantity: Prisma.Decimal | null;
    treatment: EraAdjustmentTreatment;
    description: string;
  }
): Prisma.InputJsonObject {
  return {
    eraAdjustmentId: adjustment.id,
    groupCode: adjustment.groupCode,
    reasonCode: adjustment.reasonCode,
    amount: adjustment.amount.toFixed(2),
    quantity: adjustment.quantity?.toFixed(3) ?? null,
    treatment: adjustment.treatment,
    description: adjustment.description,
  };
}

type PostingLine = {
  eraServiceLineId: string;
  chargeLineId: string;
  chargeId: string;
  chargeAmount: Prisma.Decimal;
  insurancePayment: Prisma.Decimal;
  patientResponsibility: Prisma.Decimal;
  contractualAdjustment: Prisma.Decimal;
  adjustmentSnapshot: Prisma.InputJsonObject[];
};

type PostingCharge = {
  chargeId: string;
  chargeAmount: Prisma.Decimal;
  insurancePayment: Prisma.Decimal;
  patientResponsibility: Prisma.Decimal;
  contractualAdjustment: Prisma.Decimal;
  serviceLineIds: string[];
  adjustmentSnapshot: Prisma.InputJsonObject[];
};

export async function createEraPostingPreview(formData: FormData) {
  const user = await billingUser();
  const importId = String(formData.get("importId") ?? "").trim();

  if (!importId) redirectToImport("", "invalid-data");

  const result = await db.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "EraImport"
        WHERE "id" = ${importId}
          AND "practiceId" = ${user.practiceId}
        FOR UPDATE
      `;

      if (locked.length === 0) return "not-found";

      const eraImport = await tx.eraImport.findFirst({
        where: {
          id: importId,
          practiceId: user.practiceId,
        },
        include: {
          claims: {
            include: {
              serviceLines: {
                include: {
                  adjustments: true,
                  chargeLine: {
                    include: {
                      charge: {
                        include: {
                          adjustments: {
                            where: { status: "POSTED" },
                          },
                          paymentAllocations: {
                            where: {
                              payment: { status: "POSTED" },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              adjustments: true,
              exceptions: true,
            },
          },
          exceptions: true,
          providerAdjustments: true,
          postingBatch: true,
        },
      });

      if (!eraImport) return "not-found";

      if (
        eraImport.status === "POSTED" ||
        eraImport.status === "VOIDED"
      ) {
        return "already-processed";
      }

      const approval = await tx.auditEvent.findFirst({
        where: {
          practiceId: user.practiceId,
          entityType: "EraImport",
          entityId: eraImport.id,
          action: "ERA_RECONCILIATION_APPROVED",
        },
        select: { id: true },
      });

      if (!approval) return "reconciliation-not-approved";

      if (!eraImport.paymentAmount || eraImport.paymentAmount.lessThanOrEqualTo(0)) {
        return "invalid-payment-total";
      }

      const blockers: string[] = [];

      if (eraImport.currency !== "USD") {
        blockers.push(
          `Unsupported currency for this posting workflow: ${eraImport.currency}`
        );
      }

      if (eraImport.claims.length === 0) {
        blockers.push("The ERA import contains no claims.");
      }

      if (eraImport.exceptions.some((item) => item.status === EraExceptionStatus.OPEN)) {
        blockers.push("The ERA import contains open exceptions.");
      }

      if (eraImport.providerAdjustments.some((item) => !item.amount.isZero())) {
        blockers.push(
          "Provider-level adjustments require separate review and cannot be included in this posting preview."
        );
      }

      const claimPaymentTotal = eraImport.claims.reduce(
        (total, claim) => total.plus(claim.paymentAmount),
        money(0)
      );

      if (!claimPaymentTotal.equals(eraImport.paymentAmount)) {
        blockers.push(
          "The ERA deposit amount does not equal the sum of claim payment amounts."
        );
      }

      const adjustmentKeys = new Set<string>();

      for (const claim of eraImport.claims) {
        if (!claim.insuranceClaimId || !claim.patientId) {
          blockers.push(
            `Claim ${claim.patientControlNumber} is not linked to an internal claim and patient.`
          );
        }

        if (claim.matchStatus !== EraMatchStatus.MATCHED) {
          blockers.push(
            `Claim ${claim.patientControlNumber} is not fully matched.`
          );
        }

        if (claim.exceptions.some((item) => item.status === EraExceptionStatus.OPEN)) {
          blockers.push(
            `Claim ${claim.patientControlNumber} has an open exception.`
          );
        }

        if (claim.serviceLines.length === 0) {
          blockers.push(
            `Claim ${claim.patientControlNumber} has no service lines.`
          );
        }

        for (const adjustment of claim.adjustments) {
          if (!adjustment.eraServiceLineId) {
            blockers.push(
              `Claim ${claim.patientControlNumber} has a claim-level adjustment that requires manual review.`
            );
          }

          adjustmentKeys.add(
            `${adjustment.groupCode}|${adjustment.reasonCode}`
          );
        }

        for (const line of claim.serviceLines) {
          if (
            line.matchStatus !== EraMatchStatus.MATCHED ||
            !line.chargeLineId ||
            !line.chargeLine
          ) {
            blockers.push(
              `Service line ${line.procedureCode ?? line.id} on claim ${claim.patientControlNumber} is not fully matched to a charge line.`
            );
            continue;
          }

          if (line.chargeLine.charge.status !== ChargeStatus.POSTED) {
            blockers.push(
              `The matched charge for service line ${line.procedureCode ?? line.id} is not posted.`
            );
          }

          if (
            line.chargeLine.charge.practiceId !== user.practiceId ||
            line.chargeLine.charge.patientId !== claim.patientId
          ) {
            blockers.push(
              `The matched charge for claim ${claim.patientControlNumber} does not belong to the expected patient and practice.`
            );
          }

          if (line.linePaymentAmount.lessThan(0) || line.lineChargeAmount.lessThan(0)) {
            blockers.push(
              `Service line ${line.procedureCode ?? line.id} contains a negative amount.`
            );
          }

          if (line.linePaymentAmount.greaterThan(line.lineChargeAmount)) {
            blockers.push(
              `Service line ${line.procedureCode ?? line.id} has a payment greater than its billed amount.`
            );
          }

          if (line.lineChargeAmount.greaterThan(line.chargeLine.lineTotal)) {
            blockers.push(
              `ERA billed amount exceeds the matched internal charge line for ${line.procedureCode ?? line.id}.`
            );
          }

          for (const adjustment of line.adjustments) {
            adjustmentKeys.add(
              `${adjustment.groupCode}|${adjustment.reasonCode}`
            );
          }
        }

        const serviceLinePaymentTotal = claim.serviceLines.reduce(
          (total, line) => total.plus(line.linePaymentAmount),
          money(0)
        );

        if (!serviceLinePaymentTotal.equals(claim.paymentAmount)) {
          blockers.push(
            `Service-line payments do not equal the claim payment for ${claim.patientControlNumber}.`
          );
        }

        const patientResponsibilityFromAdjustments = claim.adjustments
          .filter((item) => item.groupCode === "PR")
          .reduce((total, item) => total.plus(item.amount), money(0));

        if (
          !patientResponsibilityFromAdjustments.equals(
            claim.patientResponsibilityAmount
          )
        ) {
          blockers.push(
            `Patient responsibility adjustments do not equal the claim-level patient responsibility for ${claim.patientControlNumber}.`
          );
        }
      }

      const mappingRows = await tx.eraAdjustmentMapping.findMany({
        where: {
          practiceId: user.practiceId,
          active: true,
        },
      });

      const mappingByKey = new Map(
        mappingRows.map((mapping) => [
          `${mapping.groupCode}|${mapping.reasonCode}`,
          mapping,
        ])
      );

      for (const key of adjustmentKeys) {
        const mapping = mappingByKey.get(key);

        if (!mapping) {
          blockers.push(
            `Adjustment code ${key.replace("|", "/")} has no active practice mapping.`
          );
        } else if (
          mapping.treatment === EraAdjustmentTreatment.REVIEW_REQUIRED
        ) {
          blockers.push(
            `Adjustment code ${key.replace("|", "/")} is configured for manual review.`
          );
        }
      }

      const linePlans: Array<{
        claimId: string;
        patientId: string;
        line: PostingLine;
      }> = [];

      for (const claim of eraImport.claims) {
        for (const line of claim.serviceLines) {
          if (!line.chargeLineId || !line.chargeLine) continue;

          let patientResponsibility = money(0);
          let contractualAdjustment = money(0);
          const snapshots: Prisma.InputJsonObject[] = [];

          for (const adjustment of line.adjustments) {
            const mapping = mappingByKey.get(
              `${adjustment.groupCode}|${adjustment.reasonCode}`
            );

            if (!mapping) continue;

            const snapshot = adjustmentSnapshot({
              ...adjustment,
              treatment: mapping.treatment,
              description: mapping.description,
            });

            snapshots.push(snapshot);

            if (
              mapping.treatment ===
              EraAdjustmentTreatment.PATIENT_RESPONSIBILITY
            ) {
              patientResponsibility = patientResponsibility.plus(
                adjustment.amount
              );
            } else if (
              mapping.treatment === EraAdjustmentTreatment.CONTRACTUAL_CREDIT ||
              mapping.treatment === EraAdjustmentTreatment.CONTRACTUAL_DEBIT
            ) {
              contractualAdjustment = contractualAdjustment.plus(
                adjustment.amount
              );
            }
          }

          linePlans.push({
            claimId: claim.id,
            patientId: claim.patientId ?? "",
            line: {
              eraServiceLineId: line.id,
              chargeLineId: line.chargeLineId,
              chargeId: line.chargeLine.chargeId,
              chargeAmount: line.lineChargeAmount,
              insurancePayment: line.linePaymentAmount,
              patientResponsibility,
              contractualAdjustment,
              adjustmentSnapshot: snapshots,
            },
          });
        }
      }

      const chargePlans = new Map<string, PostingCharge>();

      for (const entry of linePlans) {
        const line = entry.line;
        const existing = chargePlans.get(line.chargeId);

        if (existing) {
          existing.chargeAmount = add(existing.chargeAmount, line.chargeAmount);
          existing.insurancePayment = add(
            existing.insurancePayment,
            line.insurancePayment
          );
          existing.patientResponsibility = add(
            existing.patientResponsibility,
            line.patientResponsibility
          );
          existing.contractualAdjustment = add(
            existing.contractualAdjustment,
            line.contractualAdjustment
          );
          existing.serviceLineIds.push(line.eraServiceLineId);
          existing.adjustmentSnapshot.push(...line.adjustmentSnapshot);
        } else {
          chargePlans.set(line.chargeId, {
            chargeId: line.chargeId,
            chargeAmount: line.chargeAmount,
            insurancePayment: line.insurancePayment,
            patientResponsibility: line.patientResponsibility,
            contractualAdjustment: line.contractualAdjustment,
            serviceLineIds: [line.eraServiceLineId],
            adjustmentSnapshot: [...line.adjustmentSnapshot],
          });
        }
      }

      for (const plan of chargePlans.values()) {
        const charge = await tx.charge.findFirst({
          where: {
            id: plan.chargeId,
            practiceId: user.practiceId,
            status: ChargeStatus.POSTED,
          },
          include: {
            adjustments: {
              where: { status: "POSTED" },
            },
            paymentAllocations: {
              where: {
                payment: { status: "POSTED" },
              },
            },
          },
        });

        if (!charge) {
          blockers.push(
            `A matched charge (${plan.chargeId}) could not be verified.`
          );
          continue;
        }

        let adjustedChargeAmount = money(charge.totalAmount);

        for (const adjustment of charge.adjustments) {
          adjustedChargeAmount =
            adjustment.type === AdjustmentType.CREDIT
              ? adjustedChargeAmount.minus(adjustment.amount)
              : adjustedChargeAmount.plus(adjustment.amount);
        }

        const alreadyAllocated = charge.paymentAllocations.reduce(
          (total, allocation) => total.plus(allocation.amount),
          money(0)
        );

        const outstanding = adjustedChargeAmount.minus(alreadyAllocated);

        if (outstanding.lessThan(0)) {
          blockers.push(
            `Charge ${charge.id} already has an invalid negative outstanding balance.`
          );
        } else if (plan.insurancePayment.greaterThan(outstanding)) {
          blockers.push(
            `ERA payment exceeds the current outstanding balance for charge ${charge.id}.`
          );
        }

        const contractualCredits = plan.adjustmentSnapshot.reduce(
          (total, snapshot) => {
            const treatment = String(snapshot.treatment ?? "");
            const amount = money(String(snapshot.amount ?? "0"));

            return treatment === EraAdjustmentTreatment.CONTRACTUAL_CREDIT
              ? total.plus(amount)
              : total;
          },
          money(0)
        );

        if (contractualCredits.greaterThan(outstanding.minus(plan.insurancePayment))) {
          blockers.push(
            `Contractual credit exceeds the remaining balance for charge ${charge.id}.`
          );
        }
      }

      const totalPatientResponsibility = eraImport.claims.reduce(
        (total, claim) => total.plus(claim.patientResponsibilityAmount),
        money(0)
      );

      const totalContractualAdjustments = linePlans.reduce(
        (total, entry) => total.plus(entry.line.contractualAdjustment),
        money(0)
      );

      const batchData = {
        currency: eraImport.currency,
        totalInsurancePayment: eraImport.paymentAmount,
        totalPatientResponsibility,
        totalContractualAdjustments,
        blockingNotes: blockers.length > 0 ? blockers.join("\n") : null,
        status:
          blockers.length > 0
            ? EraPostingBatchStatus.BLOCKED
            : EraPostingBatchStatus.READY_FOR_REVIEW,
      };

      let batch = eraImport.postingBatch;

      if (batch) {
        const batchLocked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "EraPostingBatch"
          WHERE "id" = ${batch.id}
            AND "practiceId" = ${user.practiceId}
          FOR UPDATE
        `;

        if (batchLocked.length === 0) return "not-found";

        batch = await tx.eraPostingBatch.findUnique({
          where: { id: batch.id },
        });

        if (!batch) return "not-found";

        if (
          batch.status === EraPostingBatchStatus.APPROVED ||
          batch.status === EraPostingBatchStatus.POSTED ||
          batch.status === EraPostingBatchStatus.REVERSED
        ) {
          return "batch-already-processed";
        }

        await tx.eraPostingItem.deleteMany({
          where: {
            postingClaim: { batchId: batch.id },
          },
        });

        await tx.eraPostingClaim.deleteMany({
          where: { batchId: batch.id },
        });

        batch = await tx.eraPostingBatch.update({
          where: { id: batch.id },
          data: batchData,
        });
      } else {
        batch = await tx.eraPostingBatch.create({
          data: {
            practiceId: user.practiceId,
            eraImportId: eraImport.id,
            preparedById: user.id,
            ...batchData,
          },
        });
      }

      if (blockers.length === 0) {
        for (const claim of eraImport.claims) {
          const postingClaim = await tx.eraPostingClaim.create({
            data: {
              batchId: batch.id,
              eraClaimId: claim.id,
              insuranceClaimId: claim.insuranceClaimId,
              patientId: claim.patientId,
              paymentAmount: claim.paymentAmount,
              patientResponsibilityAmount:
                claim.patientResponsibilityAmount,
              currency: eraImport.currency,
            },
          });

          const plansForClaim = linePlans.filter(
            (entry) => entry.claimId === claim.id
          );

          const byCharge = new Map<string, PostingCharge>();

          for (const entry of plansForClaim) {
            const line = entry.line;
            const existing = byCharge.get(line.chargeId);

            if (existing) {
              existing.chargeAmount = add(existing.chargeAmount, line.chargeAmount);
              existing.insurancePayment = add(
                existing.insurancePayment,
                line.insurancePayment
              );
              existing.patientResponsibility = add(
                existing.patientResponsibility,
                line.patientResponsibility
              );
              existing.contractualAdjustment = add(
                existing.contractualAdjustment,
                line.contractualAdjustment
              );
              existing.serviceLineIds.push(line.eraServiceLineId);
              existing.adjustmentSnapshot.push(...line.adjustmentSnapshot);
            } else {
              byCharge.set(line.chargeId, {
                chargeId: line.chargeId,
                chargeAmount: line.chargeAmount,
                insurancePayment: line.insurancePayment,
                patientResponsibility: line.patientResponsibility,
                contractualAdjustment: line.contractualAdjustment,
                serviceLineIds: [line.eraServiceLineId],
                adjustmentSnapshot: [...line.adjustmentSnapshot],
              });
            }
          }

          for (const plan of byCharge.values()) {
            const item = await tx.eraPostingItem.create({
              data: {
                postingClaimId: postingClaim.id,
                chargeId: plan.chargeId,
                chargeAmount: plan.chargeAmount,
                insurancePayment: plan.insurancePayment,
                patientResponsibility: plan.patientResponsibility,
                contractualAdjustment: plan.contractualAdjustment,
                adjustmentSnapshot:
                  plan.adjustmentSnapshot as Prisma.InputJsonArray,
              },
            });

            await tx.eraServiceLine.updateMany({
              where: {
                id: { in: plan.serviceLineIds },
                eraClaimId: claim.id,
              },
              data: {
                postingItemId: item.id,
              },
            });
          }
        }
      }

      await tx.auditEvent.create({
        data: {
          action:
            blockers.length > 0
              ? "ERA_POSTING_PREVIEW_BLOCKED"
              : "ERA_POSTING_PREVIEW_CREATED",
          entityType: "EraPostingBatch",
          entityId: batch.id,
          practiceId: user.practiceId,
          actorId: user.id,
          metadata: {
            eraImportId: eraImport.id,
            fileName: eraImport.fileName,
            traceNumber: eraImport.traceNumber ?? "",
            batchStatus: batch.status,
            totalInsurancePayment: eraImport.paymentAmount.toFixed(2),
            totalPatientResponsibility:
              totalPatientResponsibility.toFixed(2),
            totalContractualAdjustments:
              totalContractualAdjustments.toFixed(2),
            claimCount: eraImport.claims.length,
            postingItemCount:
              blockers.length === 0 ? linePlans.length : 0,
            blockers,
            financialPostingPerformed: false,
            paymentsCreated: false,
            allocationsCreated: false,
            adjustmentsCreated: false,
            patientBalancesChanged: false,
          },
        },
      });

      return blockers.length > 0
        ? "preview-blocked"
        : "preview-created";
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10000,
      timeout: 30000,
    }
  );

  if (result === "not-found") redirectToImport(importId, "not-found");
  if (result === "already-processed") {
    redirectToImport(importId, "already-processed");
  }
  if (result === "reconciliation-not-approved") {
    redirectToImport(importId, "reconciliation-not-approved");
  }
  if (result === "invalid-payment-total") {
    redirectToImport(importId, "invalid-payment-total");
  }
  if (result === "batch-already-processed") {
    redirectToImport(importId, "batch-already-processed");
  }
  if (result === "preview-blocked") {
    redirectToImport(importId, "posting-preview-blocked");
  }

  redirectToImport(importId, "posting-preview-created");
}