
"use server";

import { createHash } from "crypto";
import {
  EraImportStatus,
  Prisma,
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseEra835 } from "./parser";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".835", ".txt", ".x12"];

function importRedirect(result: string): never {
  revalidatePath("/billing");
  revalidatePath("/billing/era");
  redirect(`/billing/era?result=${result}`);
}

function dateFromIso(value: string | null): Date | null {
  if (!value) return null;

  const date = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? null : date;
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

export async function importEra835(formData: FormData) {
  const user = await billingUser();

  const file = formData.get("eraFile");
  const syntheticOnly = formData.get("syntheticOnly");

  if (
    !(file instanceof File) ||
    file.size === 0 ||
    syntheticOnly !== "on"
  ) {
    importRedirect("invalid-upload");
  }

  if (file.size > MAX_FILE_SIZE) {
    importRedirect("file-too-large");
  }

  const fileName = file.name.trim();

  if (
    !fileName ||
    fileName.length > 255 ||
    !ALLOWED_EXTENSIONS.some((extension) =>
      fileName.toLowerCase().endsWith(extension)
    )
  ) {
    importRedirect("invalid-file-type");
  }

  let rawContent: string;

  try {
    rawContent = await file.text();
  } catch {
    importRedirect("file-read-error");
  }

  if (!rawContent.trim()) {
    importRedirect("empty-file");
  }

  const fileHash = createHash("sha256")
    .update(rawContent, "utf8")
    .digest("hex");

  const existingImport = await db.eraImport.findFirst({
    where: {
      practiceId: user.practiceId,
      fileHash,
    },
    select: {
      id: true,
    },
  });

  if (existingImport) {
    importRedirect("duplicate-file");
  }

  let parsed;

  try {
    parsed = parseEra835(rawContent);
  } catch {
    importRedirect("validation-failed");
  }

  try {
    await db.$transaction(
      async (tx) => {
        const eraImport = await tx.eraImport.create({
          data: {
            practiceId: user.practiceId,
            status: EraImportStatus.VALIDATED,
            fileName,
            fileHash,
            rawContent,
            parserVersion: "careflow-835-v1",

            interchangeControlNumber:
              parsed.envelope.interchangeControlNumber,

            groupControlNumber:
              parsed.envelope.functionalGroupControlNumber,

            transactionControlNumber:
              parsed.envelope.transactionControlNumber,

            senderId: parsed.envelope.senderId,
            receiverId: parsed.envelope.receiverId,

            paymentAmount: new Prisma.Decimal(
              parsed.payment.totalPaymentAmount.toFixed(2)
            ),

            paymentMethodCode:
              parsed.payment.paymentMethodCode || null,

            paymentEffectiveDate: dateFromIso(
              parsed.payment.paymentDate
            ),

            traceNumber: parsed.payment.traceNumber,

            importedById: user.id,
            validatedAt: new Date(),
          },
        });

        for (const claim of parsed.claims) {
          const eraClaim = await tx.eraClaim.create({
            data: {
              eraImportId: eraImport.id,

              patientControlNumber:
                claim.patientControlNumber,

              payerClaimControlNumber:
                claim.payerClaimControlNumber,

              claimStatusCode: claim.claimStatusCode,

              totalChargeAmount: new Prisma.Decimal(
                claim.totalChargeAmount.toFixed(2)
              ),

              paymentAmount: new Prisma.Decimal(
                claim.paymentAmount.toFixed(2)
              ),

              patientResponsibilityAmount:
                new Prisma.Decimal(
                  claim.patientResponsibilityAmount.toFixed(2)
                ),

              claimStatementFrom: dateFromIso(
                claim.statementFromDate
              ),

              claimStatementThrough: dateFromIso(
                claim.statementThroughDate
              ),
            },
          });

          let adjustmentSequence = 0;

          for (const adjustment of claim.adjustments) {
            adjustmentSequence += 1;

            await tx.eraAdjustment.create({
              data: {
                eraClaimId: eraClaim.id,
                adjustmentSequence,
                groupCode: adjustment.groupCode,
                reasonCode: adjustment.reasonCode,
                amount: new Prisma.Decimal(
                  adjustment.amount.toFixed(2)
                ),
                quantity:
                  adjustment.quantity === null
                    ? null
                    : new Prisma.Decimal(
                        adjustment.quantity.toString()
                      ),
              },
            });
          }

          for (const serviceLine of claim.serviceLines) {
            const eraServiceLine =
              await tx.eraServiceLine.create({
                data: {
                  eraClaimId: eraClaim.id,

                  procedureIdentifierQualifier:
                    serviceLine.procedureQualifier,

                  procedureCode: serviceLine.procedureCode,

                  modifiers: serviceLine.modifiers,

                  revenueCode: serviceLine.revenueCode,

                  lineChargeAmount: new Prisma.Decimal(
                    serviceLine.lineChargeAmount.toFixed(2)
                  ),

                  linePaymentAmount: new Prisma.Decimal(
                    serviceLine.linePaymentAmount.toFixed(2)
                  ),

                  unitsPaid:
                    serviceLine.units === null
                      ? null
                      : new Prisma.Decimal(
                          serviceLine.units.toString()
                        ),

                  serviceDateFrom: dateFromIso(
                    serviceLine.serviceDate
                  ),
                },
              });

            for (const adjustment of serviceLine.adjustments) {
              adjustmentSequence += 1;

              await tx.eraAdjustment.create({
                data: {
                  eraClaimId: eraClaim.id,
                  eraServiceLineId: eraServiceLine.id,
                  adjustmentSequence,
                  groupCode: adjustment.groupCode,
                  reasonCode: adjustment.reasonCode,
                  amount: new Prisma.Decimal(
                    adjustment.amount.toFixed(2)
                  ),
                  quantity:
                    adjustment.quantity === null
                      ? null
                      : new Prisma.Decimal(
                          adjustment.quantity.toString()
                        ),
                },
              });
            }
          }
        }

        for (
          let index = 0;
          index < parsed.providerAdjustments.length;
          index += 1
        ) {
          const adjustment = parsed.providerAdjustments[index];

          await tx.eraProviderAdjustment.create({
            data: {
              eraImportId: eraImport.id,
              adjustmentSequence: index + 1,

              providerIdentifierQualifier:
                adjustment.providerIdentifierQualifier,

              providerIdentifier:
                adjustment.providerIdentifier,

              fiscalPeriodDate: dateFromIso(
                adjustment.fiscalPeriodDate
              ),

              reasonCode: adjustment.reasonCode,

              amount: new Prisma.Decimal(
                adjustment.amount.toFixed(2)
              ),
            },
          });
        }

        await tx.auditEvent.create({
          data: {
            action: "ERA_835_IMPORTED",
            entityType: "EraImport",
            entityId: eraImport.id,
            practiceId: user.practiceId,
            actorId: user.id,
            metadata: {
              fileName,
              fileHash,
              claimCount: parsed.claims.length,
              providerAdjustmentCount:
                parsed.providerAdjustments.length,
              paymentAmount:
                parsed.payment.totalPaymentAmount.toFixed(2),
              traceNumber: parsed.payment.traceNumber,
              parserVersion: "careflow-835-v1",
            },
          },
        });
      },
      {
        maxWait: 10000,
        timeout: 60000,
      }
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      importRedirect("duplicate-file");
    }

    throw error;
  }

  importRedirect("import-success");
}