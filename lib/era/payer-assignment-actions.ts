"use server";

import { EraImportStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

async function billingUser() {
  const user = await currentUser();

  if (!user || !user.active) redirect("/login");

  if (!["ADMIN", "BILLING"].includes(user.role)) {
    redirect("/");
  }

  return user;
}

export async function assignEraPayer(formData: FormData) {
  const user = await billingUser();

  const importId = String(formData.get("importId") ?? "").trim();
  const payerId = String(formData.get("payerId") ?? "").trim();

  if (!importId || !payerId) {
    redirect("/billing/era?result=payer-assignment-invalid");
  }

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
        select: {
          id: true,
          payerId: true,
          status: true,
          fileName: true,
        },
      });

      if (!eraImport) return "not-found";

      if (
        eraImport.status === EraImportStatus.POSTED ||
        eraImport.status === EraImportStatus.VOIDED
      ) {
        return "already-processed";
      }

      const matchingAudit = await tx.auditEvent.findFirst({
        where: {
          practiceId: user.practiceId,
          entityType: "EraImport",
          entityId: importId,
          action: "ERA_CLAIM_MATCHING_COMPLETED",
        },
        select: { id: true },
      });

      const approvalAudit = await tx.auditEvent.findFirst({
        where: {
          practiceId: user.practiceId,
          entityType: "EraImport",
          entityId: importId,
          action: "ERA_RECONCILIATION_APPROVED",
        },
        select: { id: true },
      });

      const postingBatch = await tx.eraPostingBatch.findUnique({
        where: { eraImportId: importId },
        select: { id: true },
      });

      if (matchingAudit || approvalAudit || postingBatch) {
        return "assignment-locked";
      }

      const payer = await tx.insurancePayer.findFirst({
        where: {
          id: payerId,
          practiceId: user.practiceId,
          active: true,
        },
        select: {
          id: true,
          name: true,
          payerCode: true,
        },
      });

      if (!payer) return "not-found";

      if (eraImport.payerId === payer.id) {
        return "already-assigned";
      }

      const previousPayerId = eraImport.payerId;

      await tx.eraImport.update({
        where: { id: importId },
        data: { payerId: payer.id },
      });

      await tx.auditEvent.create({
        data: {
          action: "ERA_PAYER_ASSIGNED",
          entityType: "EraImport",
          entityId: importId,
          practiceId: user.practiceId,
          actorId: user.id,
          metadata: {
            fileName: eraImport.fileName,
            previousPayerId,
            payerId: payer.id,
            payerName: payer.name,
            payerCode: payer.payerCode,
            financialPostingPerformed: false,
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

  if (result === "success") {
    revalidatePath("/billing/era");
    revalidatePath(`/billing/era/${importId}`);
    redirect(`/billing/era/${importId}?result=payer-assignment-success`);
  }

  if (result === "already-assigned") {
    redirect(`/billing/era/${importId}?result=payer-already-assigned`);
  }

  if (result === "assignment-locked") {
    redirect(`/billing/era/${importId}?result=payer-assignment-locked`);
  }

  if (result === "already-processed") {
    redirect(`/billing/era/${importId}?result=payer-already-processed`);
  }

  redirect(`/billing/era/${importId}?result=payer-not-found`);
}
