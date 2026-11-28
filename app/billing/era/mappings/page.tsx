import Link from "next/link";
import { redirect } from "next/navigation";
import { EraAdjustmentTreatment } from "@prisma/client";
import AppShell from "@/components/AppShell";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveEraAdjustmentMapping } from "@/lib/era/adjustment-mapping-actions";

export const dynamic = "force-dynamic";

const treatmentOptions: {
  value: EraAdjustmentTreatment;
  label: string;
  description: string;
}[] = [
  {
    value: "PATIENT_RESPONSIBILITY",
    label: "Patient responsibility",
    description:
      "Classifies the amount as the patient's responsibility. It does not create a contractual adjustment.",
  },
  {
    value: "CONTRACTUAL_CREDIT",
    label: "Contractual credit",
    description:
      "A contractual reduction to the charge, subject to the posting workflow's approval controls.",
  },
  {
    value: "CONTRACTUAL_DEBIT",
    label: "Contractual debit",
    description:
      "A contractual increase requiring controlled review before posting.",
  },
  {
    value: "REVIEW_REQUIRED",
    label: "Review required",
    description:
      "Holds the adjustment for manual review. It blocks posting preview readiness.",
  },
  {
    value: "INFORMATIONAL",
    label: "Informational",
    description:
      "Retains the adjustment as informational and does not change patient balances.",
  },
];

const resultMessages: Record<string, string> = {
  "mapping-saved": "Adjustment mapping saved.",
  "mapping-already-exists":
    "A mapping with this group and reason code already exists for this practice.",
  "mapping-not-found": "The selected mapping could not be found.",
  "invalid-data": "Please review the mapping details and try again.",
};

function treatmentLabel(value: EraAdjustmentTreatment) {
  return (
    treatmentOptions.find((option) => option.value === value)?.label ??
    value.replaceAll("_", " ")
  );
}

function treatmentDescription(value: EraAdjustmentTreatment) {
  return (
    treatmentOptions.find((option) => option.value === value)
      ?.description ?? ""
  );
}

export default async function EraAdjustmentMappingsPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  const user = await currentUser();

  if (!user || !user.active) redirect("/login");

  if (!["ADMIN", "BILLING"].includes(user.role)) {
    redirect("/");
  }

  const params = await searchParams;
  const resultMessage = params.result
    ? resultMessages[params.result]
    : undefined;

  const mappings = await db.eraAdjustmentMapping.findMany({
    where: {
      practiceId: user.practiceId,
    },
    orderBy: [
      { groupCode: "asc" },
      { reasonCode: "asc" },
    ],
  });

  return (
    <AppShell user={user} active="Billing">
      <div className="mb-6">
        <Link
          href="/billing/era"
          className="text-sm font-semibold text-teal hover:underline"
        >
          ← Back to ERA imports
        </Link>

        <div className="mt-6 text-xs font-bold tracking-wider text-teal">
          REVENUE CYCLE MANAGEMENT
        </div>

        <h1 className="mt-2 text-3xl font-semibold">
          ERA adjustment mappings
        </h1>

        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
          Configure how imported 835 adjustment group and reason codes are
          classified during the posting preview. These mappings are specific
          to your practice.
        </p>
      </div>

      {resultMessage && (
        <div
          role="status"
          className={`mb-6 rounded-xl border p-4 text-sm ${
            params.result === "mapping-saved"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {resultMessage}
        </div>
      )}

      <section className="card mb-8 p-6">
        <div className="mb-5">
          <h2 className="text-lg font-semibold">
            Add adjustment mapping
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Enter the exact ERA group and reason code combination.
          </p>
        </div>

        <form action={saveEraAdjustmentMapping} className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Adjustment group code">
              <input
                name="groupCode"
                required
                maxLength={10}
                defaultValue="PR"
                placeholder="PR"
                className="form-input uppercase"
              />
            </Field>

            <Field label="Adjustment reason code">
              <input
                name="reasonCode"
                required
                maxLength={20}
                defaultValue="3"
                placeholder="3"
                className="form-input"
              />
            </Field>

            <Field label="Treatment">
              <select
                name="treatment"
                required
                defaultValue="PATIENT_RESPONSIBILITY"
                className="form-input"
              >
                {treatmentOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Description">
              <input
                name="description"
                required
                minLength={3}
                maxLength={500}
                defaultValue="Patient responsibility"
                placeholder="Describe how this adjustment is treated"
                className="form-input"
              />
            </Field>
          </div>

          <input type="hidden" name="active" value="true" />

          <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
            <strong>Patient responsibility is not a contractual adjustment.</strong>
            <p className="mt-1">
              The PR/3 mapping classifies the amount as patient responsibility.
              It must not create a contractual credit or debit.
            </p>
          </div>

          <div className="flex justify-end border-t border-slate-100 pt-5">
            <button
              type="submit"
              className="rounded-lg bg-teal px-5 py-3 text-sm font-semibold text-white hover:opacity-90"
            >
              Save mapping
            </button>
          </div>
        </form>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-100 p-6">
          <h2 className="text-lg font-semibold">
            Practice adjustment mappings
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {mappings.length} mapping{mappings.length === 1 ? "" : "s"} configured
            for {user.practice.name}.
          </p>
        </div>

        {mappings.length === 0 ? (
          <div className="p-10 text-center">
            <h3 className="font-semibold">No mappings configured</h3>
            <p className="mt-2 text-sm text-slate-500">
              Add an ERA adjustment mapping above to classify adjustment codes
              during posting preview.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {mappings.map((mapping) => (
              <div key={mapping.id} className="space-y-4 p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-slate-100 px-3 py-1 font-mono text-sm font-bold">
                        {mapping.groupCode}/{mapping.reasonCode}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          mapping.active
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {mapping.active ? "ACTIVE" : "INACTIVE"}
                      </span>
                    </div>
                    <h3 className="mt-2 font-semibold">
                      {mapping.description}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {treatmentLabel(mapping.treatment)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {treatmentDescription(mapping.treatment)}
                    </p>
                  </div>
                </div>

                <form
                  action={saveEraAdjustmentMapping}
                  className="grid gap-4 rounded-lg bg-slate-50 p-4 md:grid-cols-2"
                >
                  <input
                    type="hidden"
                    name="id"
                    value={mapping.id}
                  />
                  <input
                    type="hidden"
                    name="groupCode"
                    value={mapping.groupCode}
                  />
                  <input
                    type="hidden"
                    name="reasonCode"
                    value={mapping.reasonCode}
                  />

                  <Field label="Treatment">
                    <select
                      name="treatment"
                      defaultValue={mapping.treatment}
                      className="form-input"
                    >
                      {treatmentOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Description">
                    <input
                      name="description"
                      required
                      minLength={3}
                      maxLength={500}
                      defaultValue={mapping.description}
                      className="form-input"
                    />
                  </Field>

                  <Field label="Status">
                    <select
                      name="active"
                      defaultValue={mapping.active ? "true" : "false"}
                      className="form-input"
                    >
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </Field>

                  <div className="flex items-end justify-end">
                    <button
                      type="submit"
                      className="rounded-lg border border-teal px-4 py-2.5 text-sm font-semibold text-teal hover:bg-teal/5"
                    >
                      Update mapping
                    </button>
                  </div>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        <strong>Financial safety:</strong> Saving a mapping changes only
        configuration. It does not create payments, allocations, charge
        adjustments, or patient balance changes. The posting preview must be
        recalculated after a mapping is changed.
      </div>
    </AppShell>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex w-full min-w-0 flex-col items-stretch gap-2">
      <span className="block text-sm font-medium text-slate-700">
        {label}
      </span>
      <span className="block w-full min-w-0 [&_.form-input]:w-full">
        {children}
      </span>
    </label>
  );
}