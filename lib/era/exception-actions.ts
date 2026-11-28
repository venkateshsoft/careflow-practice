
"use server";

import { EraExceptionStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

const exceptionActionSchema = z.object({
  exceptionId: z.string().trim().min(1),
  resolutionNote: z.string().trim().min(10).max(2000),
  decision: z.enum(["RESOLVED", "IGNORED"]),
});

type ActionResult =
  | "success"
  | "not-found"
  | "already-processed"
  | "invalid-data";

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

export async function resolveEraException(formData: FormData) {
  const user = await billingUser();

  const parsed = exceptionActionSchema.safeParse({
    exceptionId: formData.get("exceptionId"),
    resolutionNote: formData.get("resolutionNote"),
    decision: formData.get("decision"),
  });

  if (!parsed.success) {
    redirect("/billing/era?result=invalid-data");
  }

  const data = parsed.data;

  const result = await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "EraException"
      WHERE "id" = ${data.exceptionId}
        AND "practiceId" = ${user.practiceId}
      FOR UPDATE
    `;

    if (locked.length === 0) {
      return {
        status: "not-found" as ActionResult,
        importId: null,
      };
    }

    const exception = await tx.eraException.findFirst({
      where: {
        id: data.exceptionId,
        practiceId: user.practiceId,
      },
      select: {
        id: true,
        eraImportId: true,
        eraClaimId: true,
        eraServiceLineId: true,
        category: true,
        code: true,
        status: true,
      },
    });

    if (!exception) {
      return {
        status: "not-found" as ActionResult,
        importId: null,
      };
    }

    if (exception.status !== EraExceptionStatus.OPEN) {
      return {
        status: "already-processed" as ActionResult,
        importId: exception.eraImportId,
      };
    }

    const now = new Date();

    await tx.eraException.update({
      where: {
        id: exception.id,
      },
      data: {
        status: data.decision,
        resolutionNote: data.resolutionNote,
        resolvedById: user.id,
        resolvedAt: now,
      },
    });

    await tx.auditEvent.create({
      data: {
        action:
          data.decision === "RESOLVED"
            ? "ERA_EXCEPTION_RESOLVED"
            : "ERA_EXCEPTION_IGNORED",
        entityType: "EraException",
        entityId: exception.id,
        practiceId: user.practiceId,
        actorId: user.id,
        metadata: {
          eraImportId: exception.eraImportId,
          eraClaimId: exception.eraClaimId,
          eraServiceLineId: exception.eraServiceLineId,
          category: exception.category,
          code: exception.code,
          previousStatus: exception.status,
          newStatus: data.decision,
          resolutionNote: data.resolutionNote,
          serviceLineMatchChanged: false,
          financialPostingPerformed: false,
        },
      },
    });

    return {
      status: "success" as ActionResult,
      importId: exception.eraImportId,
    };
  });

  if (!result.importId) {
    redirect("/billing/era?result=not-found");
  }

  if (result.status !== "success") {
    redirect(
      `/billing/era/${result.importId}?result=${result.status}`
    );
  }

  revalidatePath("/billing/era");
  revalidatePath(`/billing/era/${result.importId}`);

  redirect(
    `/billing/era/${result.importId}?result=exception-${data.decision.toLowerCase()}`
  );
}