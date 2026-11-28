
"use server";

import { Prisma, EraMatchStatus, EraExceptionStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

const approvalSchema = z.object({
  importId: z.string().min(1),
  reviewNote: z.string().trim().min(10).max(2000),
});

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

export async function approveEraReconciliation(formData: FormData) {
  const user = await billingUser();

  const parsed = approvalSchema.safeParse({
    importId: formData.get("importId"),
    reviewNote: formData.get("reviewNote"),
  });

  if (!parsed.success) {
    redirect("/billing/era?result=approval-invalid");
  }

  const { importId, reviewNote } = parsed.data;

  const result = await db.$transaction(async (tx) => {
    // Serialize approval attempts for this import.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "EraImport"
      WHERE "id" = ${importId}
        AND "practiceId" = ${user.practiceId}
      FOR UPDATE
    `;

    if (locked.length === 0) {
      return "not-found";
    }

    const previousApproval = await tx.auditEvent.findFirst({
      where: {
        practiceId: user.practiceId,
        entityType: "EraImport",
        entityId: importId,
        action: "ERA_RECONCILIATION_APPROVED",
      },
      select: { id: true },
    });

    if (previousApproval) {
      return "already-approved";
    }

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
                exceptions: {
                  select: {
                    status: true,
                  },
                },
              },
            },
          },
        },
        exceptions: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!eraImport) {
      return "not-found";
    }

    if (eraImport.status !== "VALIDATED" &&
        eraImport.status !== "RECONCILIATION_READY") {
      return "invalid-status";
    }

    if (eraImport.paymentAmount === null) {
      return "missing-payment-total";
    }

    if (eraImport.claims.length === 0) {
      return "no-claims";
    }

    // Every ERA claim must be linked to an internal claim.
    const unmatchedClaim = eraImport.claims.some(
      (claim) =>
        !claim.insuranceClaimId ||
        claim.matchStatus === EraMatchStatus.UNMATCHED ||
        claim.matchStatus === EraMatchStatus.EXCEPTION
    );

    if (unmatchedClaim) {
      return "claims-unmatched";
    }

    // All recorded exceptions must be explicitly closed.
    const openExceptions = eraImport.exceptions.filter(
      (exception) => exception.status === EraExceptionStatus.OPEN
    );

    if (openExceptions.length > 0) {
      return "open-exceptions";
    }

    // A non-matched service line must have a closed exception.
    const unresolvedServiceLine = eraImport.claims.some((claim) =>
      claim.serviceLines.some((line) => {
        if (line.matchStatus === EraMatchStatus.MATCHED) {
          return false;
        }

        return (
          line.exceptions.length === 0 ||
          line.exceptions.some(
            (exception) =>
              exception.status === EraExceptionStatus.OPEN
          )
        );
      })
    );

    if (unresolvedServiceLine) {
      return "service-lines-unreviewed";
    }

    const claimPaymentTotal = eraImport.claims.reduce(
      (total, claim) =>
        total.add(new Prisma.Decimal(claim.paymentAmount)),
      new Prisma.Decimal(0)
    );

    const filePaymentTotal = new Prisma.Decimal(
      eraImport.paymentAmount
    );

    if (!claimPaymentTotal.equals(filePaymentTotal)) {
      return "payment-total-mismatch";
    }

    const patientResponsibilityTotal = eraImport.claims.reduce(
      (total, claim) =>
        total.add(
          new Prisma.Decimal(claim.patientResponsibilityAmount)
        ),
      new Prisma.Decimal(0)
    );

    await tx.auditEvent.create({
      data: {
        action: "ERA_RECONCILIATION_APPROVED",
        entityType: "EraImport",
        entityId: importId,
        practiceId: user.practiceId,
        actorId: user.id,
        metadata: {
          reviewNote,
          fileName: eraImport.fileName,
          traceNumber: eraImport.traceNumber,
          currency: eraImport.currency,
          filePaymentAmount: filePaymentTotal.toFixed(2),
          claimPaymentTotal: claimPaymentTotal.toFixed(2),
          patientResponsibilityTotal:
            patientResponsibilityTotal.toFixed(2),
          claimCount: eraImport.claims.length,
          exceptionCount: eraImport.exceptions.length,
          openExceptionCount: 0,
          financialPostingPerformed: false,
          paymentsCreated: false,
          adjustmentsCreated: false,
          allocationsCreated: false,
          patientBalancesChanged: false,
        },
      },
    });

    return "success";
  });

  if (result !== "success") {
    redirect(`/billing/era/${importId}?result=${result}`);
  }

  revalidatePath("/billing/era");
  revalidatePath(`/billing/era/${importId}`);

  redirect(`/billing/era/${importId}?result=approval-success`);
}