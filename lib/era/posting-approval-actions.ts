
"use server";

import {
  EraExceptionStatus,
  EraMatchStatus,
  EraPostingBatchStatus,
  Prisma,
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

const approvalSchema = z.object({
  batchId: z.string().min(1),
  reviewNote: z.string().trim().min(10).max(2000),
});

function approvalRedirect(eraImportId: string, result: string): never {
  revalidatePath("/billing/era");
  revalidatePath(`/billing/era/${eraImportId}`);
  redirect(`/billing/era/${eraImportId}?result=${result}`);
}

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

export async function approveEraPostingBatch(formData: FormData) {
  const user = await billingUser();

  const parsed = approvalSchema.safeParse({
    batchId: formData.get("batchId"),
    reviewNote: formData.get("reviewNote"),
  });

  if (!parsed.success) {
    redirect("/billing/era?result=posting-approval-invalid");
  }

  const { batchId, reviewNote } = parsed.data;

  // Resolve the parent ERA import ID. The detail route uses this ID,
  // not the posting batch ID.
  const batchReference = await db.eraPostingBatch.findFirst({
    where: {
      id: batchId,
      practiceId: user.practiceId,
    },
    select: {
      eraImportId: true,
    },
  });

  if (!batchReference) {
    redirect("/billing/era?result=posting-batch-not-found");
  }

  const eraImportId = batchReference.eraImportId;

  try {
    const result = await db.$transaction(
      async (tx) => {
        // Serialize approval attempts for this batch.
        const lockedRows = await tx.$queryRaw<
          Array<{ id: string }>
        >`
          SELECT id
          FROM "EraPostingBatch"
          WHERE id = ${batchId}
            AND "practiceId" = ${user.practiceId}
          FOR UPDATE
        `;

        if (lockedRows.length === 0) {
          return "posting-batch-not-found";
        }

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
                providerAdjustments: true,
                exceptions: true,
              },
            },
          },
        });

        if (!batch) {
          return "posting-batch-not-found";
        }

        if (
          batch.status === EraPostingBatchStatus.APPROVED ||
          batch.status === EraPostingBatchStatus.POSTED ||
          batch.status === EraPostingBatchStatus.REVERSED
        ) {
          return "posting-batch-already-processed";
        }

        if (batch.status !== EraPostingBatchStatus.READY_FOR_REVIEW) {
          return "posting-batch-not-ready";
        }

        // Enforce separation of duties.
        if (batch.preparedById === user.id) {
          return "posting-approver-must-differ";
        }

        // The reconciliation itself must already have been approved.
        const reconciliationApproval =
          await tx.auditEvent.findFirst({
            where: {
              practiceId: user.practiceId,
              entityType: "EraImport",
              entityId: batch.eraImportId,
              action: "ERA_RECONCILIATION_APPROVED",
            },
            select: { id: true },
          });

        if (!reconciliationApproval) {
          return "reconciliation-not-approved";
        }

        // Do not approve a batch containing unresolved exceptions.
        const openImportExceptions =
          batch.eraImport.exceptions.filter(
            (exception) =>
              exception.status === EraExceptionStatus.OPEN
          );

        const openClaimExceptions = batch.claims.flatMap(
          (claim) =>
            claim.eraClaim.exceptions.filter(
              (exception) =>
                exception.status === EraExceptionStatus.OPEN
            )
        );

        if (
          openImportExceptions.length > 0 ||
          openClaimExceptions.length > 0
        ) {
          return "posting-batch-open-exceptions";
        }

        // Provider-level adjustments remain outside patient-level posting.
        const hasProviderAdjustments =
          batch.eraImport.providerAdjustments.some(
            (adjustment) => !adjustment.amount.isZero()
          );

        if (hasProviderAdjustments) {
          return "posting-batch-provider-adjustments";
        }

        if (batch.claims.length === 0) {
          return "posting-batch-empty";
        }

        // Recheck every claim and service line before approval.
        for (const postingClaim of batch.claims) {
          if (
            !postingClaim.insuranceClaimId ||
            !postingClaim.eraClaim.insuranceClaimId ||
            postingClaim.eraClaim.matchStatus !==
              EraMatchStatus.MATCHED
          ) {
            return "posting-batch-claim-unmatched";
          }

          if (postingClaim.items.length === 0) {
            return "posting-batch-no-items";
          }

          if (
            postingClaim.eraClaim.serviceLines.length === 0 ||
            postingClaim.eraClaim.serviceLines.some(
              (line) =>
                line.matchStatus !== EraMatchStatus.MATCHED ||
                !line.chargeLineId
            )
          ) {
            return "posting-batch-service-lines-unmatched";
          }
        }

        const claimPaymentTotal = batch.claims.reduce(
          (total, claim) =>
            total.add(claim.paymentAmount),
          new Prisma.Decimal(0)
        );

        const claimResponsibilityTotal = batch.claims.reduce(
          (total, claim) =>
            total.add(claim.patientResponsibilityAmount),
          new Prisma.Decimal(0)
        );

        const itemPaymentTotal = batch.claims.reduce(
          (claimTotal, claim) =>
            claimTotal.add(
              claim.items.reduce(
                (itemTotal, item) =>
                  itemTotal.add(item.insurancePayment),
                new Prisma.Decimal(0)
              )
            ),
          new Prisma.Decimal(0)
        );

        if (
          claimPaymentTotal
            .minus(batch.totalInsurancePayment)
            .abs()
            .greaterThan("0.01") ||
          itemPaymentTotal
            .minus(batch.totalInsurancePayment)
            .abs()
            .greaterThan("0.01")
        ) {
          return "posting-batch-payment-total-mismatch";
        }

        if (
          claimResponsibilityTotal
            .minus(batch.totalPatientResponsibility)
            .abs()
            .greaterThan("0.01")
        ) {
          return "posting-batch-responsibility-total-mismatch";
        }

        // Protect against a second approval, including concurrent requests.
        const existingApproval = await tx.auditEvent.findFirst({
          where: {
            practiceId: user.practiceId,
            entityType: "EraPostingBatch",
            entityId: batch.id,
            action: "ERA_POSTING_BATCH_APPROVED",
          },
          select: { id: true },
        });

        if (existingApproval) {
          return "posting-batch-already-processed";
        }

        const approvedAt = new Date();

        await tx.eraPostingBatch.update({
          where: { id: batch.id },
          data: {
            status: EraPostingBatchStatus.APPROVED,
            approvedById: user.id,
            approvedAt,
            reviewNote,
          },
        });

        await tx.auditEvent.create({
          data: {
            action: "ERA_POSTING_BATCH_APPROVED",
            entityType: "EraPostingBatch",
            entityId: batch.id,
            practiceId: user.practiceId,
            actorId: user.id,
            metadata: {
              eraImportId: batch.eraImportId,
              preparedById: batch.preparedById,
              approvedById: user.id,
              approvedAt: approvedAt.toISOString(),
              reviewNote,
              claimCount: batch.claims.length,
              totalInsurancePayment:
                batch.totalInsurancePayment.toFixed(2),
              totalPatientResponsibility:
                batch.totalPatientResponsibility.toFixed(2),
              totalContractualAdjustments:
                batch.totalContractualAdjustments.toFixed(2),
              financialPostingPerformed: false,
              paymentsCreated: false,
              allocationsCreated: false,
              adjustmentsCreated: false,
              patientBalancesChanged: false,
            },
          },
        });

        return "posting-approval-success";
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 30000,
      }
    );

    approvalRedirect(eraImportId, result);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      approvalRedirect(eraImportId, "posting-approval-retry");
    }

    throw error;
  }
}