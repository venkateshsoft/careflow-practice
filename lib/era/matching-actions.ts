
"use server";

import {
  EraExceptionSeverity,
  EraExceptionStatus,
  EraMatchStatus,
  EraImportStatus,
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

export async function matchEraImport(formData: FormData) {
  const user = await billingUser();
  const importId = String(formData.get("importId") ?? "").trim();

  if (!importId) redirect("/billing/era?result=invalid-data");

  const result = await db.$transaction(async (tx) => {
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
            serviceLines: true,
          },
        },
      },
    });

    if (!eraImport) return "not-found";

    if (
      eraImport.status === EraImportStatus.POSTED ||
      eraImport.status === EraImportStatus.VOIDED
    ) {
      return "already-processed";
    }

    if (!eraImport.payerId) return "payer-not-assigned";

    let matched = 0;
    let partial = 0;
    let unmatched = 0;
    let exceptions = 0;

    for (const eraClaim of eraImport.claims) {
      const existingLink = await tx.eraClaim.findFirst({
        where: {
          id: eraClaim.id,
          insuranceClaimId: { not: null },
        },
        select: { id: true },
      });

      if (existingLink) continue;

      const candidates = await tx.insuranceClaim.findMany({
        where: {
          practiceId: user.practiceId,
          payerId: eraImport.payerId,
          patientControlNumber: eraClaim.patientControlNumber,
          status: { not: "VOIDED" },
        },
        include: {
          patient: true,
          lines: {
            include: {
              chargeLine: {
                include: {
                  charge: true,
                },
              },
            },
          },
        },
        take: 2,
      });

      if (candidates.length !== 1) {
        unmatched += 1;

        await tx.eraClaim.update({
          where: { id: eraClaim.id },
          data: {
            matchStatus: EraMatchStatus.UNMATCHED,
            notes:
              candidates.length === 0
                ? "No internal claim matched the payer and patient control number."
                : "Multiple internal claims matched. Manual review is required.",
          },
        });

        await tx.eraException.create({
          data: {
            practiceId: user.practiceId,
            eraImportId: eraImport.id,
            eraClaimId: eraClaim.id,
            category: "CLAIM_MATCH",
            code:
              candidates.length === 0
                ? "CLAIM_NOT_FOUND"
                : "AMBIGUOUS_CLAIM",
            message:
              candidates.length === 0
                ? "No internal claim matched this ERA claim."
                : "More than one internal claim matched. No automatic link was created.",
            severity: EraExceptionSeverity.WARNING,
            status: EraExceptionStatus.OPEN,
          },
        });

        exceptions += 1;
        continue;
      }

      const claim = candidates[0];

      const payerControlMatches =
        !eraClaim.payerClaimControlNumber ||
        !claim.payerClaimControlNumber ||
        eraClaim.payerClaimControlNumber ===
          claim.payerClaimControlNumber;

      const billedAmountMatches =
        new Prisma.Decimal(eraClaim.totalChargeAmount).equals(
          new Prisma.Decimal(claim.totalBilled)
        );

      if (!payerControlMatches || !billedAmountMatches) {
        unmatched += 1;

        const reasons = [
          !payerControlMatches
            ? "Payer claim control number differs."
            : null,
          !billedAmountMatches
            ? "Billed amount differs from the internal claim."
            : null,
        ].filter(Boolean);

        await tx.eraClaim.update({
          where: { id: eraClaim.id },
          data: {
            matchStatus: EraMatchStatus.EXCEPTION,
            notes: reasons.join(" "),
          },
        });

        await tx.eraException.create({
          data: {
            practiceId: user.practiceId,
            eraImportId: eraImport.id,
            eraClaimId: eraClaim.id,
            category: "CLAIM_VALIDATION",
            code: "CLAIM_DETAILS_DIFFER",
            message: reasons.join(" "),
            severity: EraExceptionSeverity.ERROR,
            status: EraExceptionStatus.OPEN,
          },
        });

        exceptions += 1;
        continue;
      }

      const patientMatches =
        claim.patient.practiceId === user.practiceId;

      if (!patientMatches) {
        unmatched += 1;
        continue;
      }

      let allServiceLinesMatch = true;

      for (const eraLine of eraClaim.serviceLines) {
        const lineCandidates = claim.lines.filter((line) => {
          const codeMatches =
            line.chargeLine.codeSnapshot === eraLine.procedureCode;

          const amountMatches =
            new Prisma.Decimal(line.submittedAmount).equals(
              new Prisma.Decimal(eraLine.lineChargeAmount)
            );

          const unitsMatch =
            eraLine.unitsPaid === null ||
            new Prisma.Decimal(line.units ?? 1).equals(
              new Prisma.Decimal(eraLine.unitsPaid)
            );

          return codeMatches && amountMatches && unitsMatch;
        });

        if (lineCandidates.length === 1) {
          const matchedLine = lineCandidates[0];

          await tx.eraServiceLine.update({
            where: { id: eraLine.id },
            data: {
              insuranceClaimLineId: matchedLine.id,
              chargeLineId: matchedLine.chargeLineId,
              matchStatus: EraMatchStatus.MATCHED,
              matchedAt: new Date(),
            },
          });
        } else {
          allServiceLinesMatch = false;

          await tx.eraServiceLine.update({
            where: { id: eraLine.id },
            data: {
              matchStatus: EraMatchStatus.EXCEPTION,
            },
          });

          await tx.eraException.create({
            data: {
              practiceId: user.practiceId,
              eraImportId: eraImport.id,
              eraClaimId: eraClaim.id,
              eraServiceLineId: eraLine.id,
              category: "SERVICE_LINE_MATCH",
              code:
                lineCandidates.length === 0
                  ? "SERVICE_LINE_NOT_MATCHED"
                  : "AMBIGUOUS_SERVICE_LINE",
              message:
                lineCandidates.length === 0
                  ? `No exact internal service-line match for procedure ${eraLine.procedureCode ?? "not supplied"} and amount $${new Prisma.Decimal(eraLine.lineChargeAmount).toFixed(2)}.`
                  : "Multiple internal service lines matched. Manual review is required.",
              severity: EraExceptionSeverity.WARNING,
              status: EraExceptionStatus.OPEN,
            },
          });

          exceptions += 1;
        }
      }

      const claimMatchStatus = allServiceLinesMatch
        ? EraMatchStatus.MATCHED
        : EraMatchStatus.PARTIALLY_MATCHED;

      await tx.eraClaim.update({
        where: { id: eraClaim.id },
        data: {
          patientId: claim.patientId,
          insuranceClaimId: claim.id,
          matchStatus: claimMatchStatus,
          matchedAt: new Date(),
          notes: allServiceLinesMatch
            ? "Claim and all service lines matched."
            : "Claim matched. One or more service lines require manual review.",
        },
      });

      if (allServiceLinesMatch) {
        matched += 1;
      } else {
        partial += 1;
      }
    }

    const remaining = await tx.eraClaim.count({
      where: {
        eraImportId: eraImport.id,
        matchStatus: {
          in: [
            EraMatchStatus.UNMATCHED,
            EraMatchStatus.PARTIALLY_MATCHED,
            EraMatchStatus.EXCEPTION,
          ],
        },
      },
    });

    await tx.eraImport.update({
      where: { id: eraImport.id },
      data: {
        status:
          remaining === 0
            ? EraImportStatus.RECONCILIATION_READY
            : EraImportStatus.VALIDATED,
      },
    });

    await tx.auditEvent.create({
      data: {
        action: "ERA_CLAIM_MATCHING_COMPLETED",
        entityType: "EraImport",
        entityId: eraImport.id,
        practiceId: user.practiceId,
        actorId: user.id,
        metadata: {
          matchedClaims: matched,
          partiallyMatchedClaims: partial,
          unmatchedClaims: unmatched,
          exceptions,
          financialPostingPerformed: false,
        },
      },
    });

    return "success";
  });

  if (result !== "success") {
    redirect(`/billing/era?result=${result}`);
  }

  revalidatePath("/billing/era");
  revalidatePath(`/billing/era/${importId}`);

  redirect(`/billing/era/${importId}?result=matching-complete`);
}