"use server";

import { EraAdjustmentTreatment, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

const mappingSchema = z.object({
  id: z.string().optional(),
  groupCode: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .transform((value) => value.toUpperCase()),
  reasonCode: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((value) => value.toUpperCase()),
  treatment: z.nativeEnum(EraAdjustmentTreatment),
  description: z.string().trim().min(3).max(500),
  active: z.enum(["true", "false"]),
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

export async function saveEraAdjustmentMapping(formData: FormData) {
  const user = await billingUser();

  const parsed = mappingSchema.safeParse({
    id: formData.get("id") || undefined,
    groupCode: formData.get("groupCode"),
    reasonCode: formData.get("reasonCode"),
    treatment: formData.get("treatment"),
    description: formData.get("description"),
    active: formData.get("active"),
  });

  if (!parsed.success) {
    redirect("/billing/era/mappings?result=invalid-data");
  }

  const data = parsed.data;

  let result = "mapping-saved";

  try {
    await db.$transaction(async (tx) => {
      if (data.id) {
        const existing = await tx.eraAdjustmentMapping.findFirst({
          where: {
            id: data.id,
            practiceId: user.practiceId,
          },
        });

        if (!existing) {
          throw new Error("MAPPING_NOT_FOUND");
        }

        await tx.eraAdjustmentMapping.update({
          where: { id: existing.id },
          data: {
            treatment: data.treatment,
            description: data.description,
            active: data.active === "true",
          },
        });
      } else {
        await tx.eraAdjustmentMapping.create({
          data: {
            practiceId: user.practiceId,
            groupCode: data.groupCode,
            reasonCode: data.reasonCode,
            treatment: data.treatment,
            description: data.description,
            active: data.active === "true",
          },
        });
      }

      await tx.auditEvent.create({
        data: {
          action: data.id
            ? "ERA_ADJUSTMENT_MAPPING_UPDATED"
            : "ERA_ADJUSTMENT_MAPPING_CREATED",
          entityType: "EraAdjustmentMapping",
          entityId: data.id ?? `${data.groupCode}/${data.reasonCode}`,
          practiceId: user.practiceId,
          actorId: user.id,
          metadata: {
            groupCode: data.groupCode,
            reasonCode: data.reasonCode,
            treatment: data.treatment,
            description: data.description,
            active: data.active === "true",
          },
        },
      });
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      result = "mapping-already-exists";
    } else if (
      error instanceof Error &&
      error.message === "MAPPING_NOT_FOUND"
    ) {
      result = "mapping-not-found";
    } else {
      throw error;
    }
  }

  revalidatePath("/billing/era/mappings");
  revalidatePath("/billing/era");

  redirect(`/billing/era/mappings?result=${result}`);
}