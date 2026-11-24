
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import DiagnosisCoding from "@/components/DiagnosisCoding";
import {
  saveClinicalEncounter,
  signClinicalEncounter,
} from "@/lib/clinical-actions";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    saved?: string;
    signed?: string;
    error?: string;
  }>;
};

function vitalValue(vitals: unknown, key: string): string {
  if (
    vitals &&
    typeof vitals === "object" &&
    !Array.isArray(vitals) &&
    key in vitals
  ) {
    const value = (vitals as Record<string, unknown>)[key];
    return typeof value === "number" ? String(value) : "";
  }

  return "";
}

export default async function ClinicalEncounterPage({
  params,
  searchParams,
}: PageProps) {
  const user = await currentUser();

  if (!user || !user.active) redirect("/login");

  if (!["ADMIN", "PROVIDER", "CLINICAL_STAFF"].includes(user.role)) {
    redirect("/?error=unauthorized");
  }

  const { id } = await params;
  const query = await searchParams;

  const encounter = await db.clinicalEncounter.findFirst({
    where: {
      id,
      practiceId: user.practiceId,
    },
    include: {
  patient: true,
  provider: true,
  appointment: true,
  author: true,
  diagnoses: {
    include: {
      diagnosisCode: true,
    },
    orderBy: {
      sequence: "asc",
    },
  },
},
  });

  if (!encounter) notFound();

  if (
    user.role === "PROVIDER" &&
    encounter.provider.displayName !== user.displayName
  ) {
    redirect("/clinical?error=provider-access");
  }

  const signed = encounter.status === "SIGNED";
  const canSign =
    user.role === "PROVIDER" &&
    encounter.provider.displayName === user.displayName;

  const activity = await db.auditEvent.findMany({
    where: {
      practiceId: user.practiceId,
      entityType: "ClinicalEncounter",
      entityId: encounter.id,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const errorMessages: Record<string, string> = {
    signed: "This encounter has already been signed and is read-only.",
    "invalid-vitals": "Please enter valid positive vital measurements.",
    "required-sections":
      "Chief complaint, assessment and plan are required before signing.",
    "provider-access": "You are not authorized to access this encounter.",
  };

  const vitals = encounter.vitals;

  return (
    <AppShell user={user} active="Clinical">
      <div className="mb-8">
        <Link
          href="/clinical"
          className="text-sm font-medium text-teal hover:underline"
        >
          ← Back to clinical encounters
        </Link>

        <p className="mt-6 text-sm font-medium text-teal">
          CLINICAL DOCUMENTATION
        </p>

        <h1 className="mt-2 text-3xl font-semibold text-ink">
          {encounter.patient.firstName} {encounter.patient.lastName}
        </h1>

        <p className="mt-2 text-sm text-slate-500">
          MRN: {encounter.patient.mrn} · {encounter.provider.displayName}
        </p>
      </div>

      <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        SYNTHETIC DEMO — Do not enter real patient or clinical information.
        This is not a production medical record.
      </div>

      {query.saved === "1" && (
        <div className="mb-5 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
          Clinical documentation saved successfully.
        </div>
      )}

      {query.signed === "1" && (
        <div className="mb-5 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
          Encounter signed successfully.
        </div>
      )}

      {query.error && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errorMessages[query.error] ??
            "There was a problem with the clinical encounter."}
        </div>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <section className="card p-4">
          <p className="text-xs text-slate-500">Encounter status</p>
          <p className="mt-2 font-semibold text-ink">
            {encounter.status.replace("_", " ")}
          </p>
        </section>

        <section className="card p-4">
          <p className="text-xs text-slate-500">Appointment type</p>
          <p className="mt-2 font-semibold text-ink">
            {encounter.appointment.visitType}
          </p>
        </section>

        <section className="card p-4">
          <p className="text-xs text-slate-500">Documentation author</p>
          <p className="mt-2 font-semibold text-ink">
            {encounter.author?.displayName ?? "Not assigned"}
          </p>
        </section>
      </div>
	<DiagnosisCoding
  	encounterId={encounter.id}
  	signed={signed}
  	diagnoses={encounter.diagnoses.map((item) => ({
    		id: item.id,
    		code: item.diagnosisCode.code,
    		description: item.diagnosisCode.description,
    		sequence: item.sequence,
  		}))}
	/>
      <form action={saveClinicalEncounter} className="space-y-6">
        <input type="hidden" name="encounterId" value={encounter.id} />

        <fieldset disabled={signed} className="space-y-6">
          <section className="card p-6">
            <h2 className="text-lg font-semibold text-ink">
              Clinical notes
            </h2>

            <div className="mt-5 space-y-5">
              <div>
                <label className="mb-2 block text-sm font-medium">
                  Chief complaint *
                </label>
                <textarea
                  name="chiefComplaint"
                  required
                  maxLength={2000}
                  rows={3}
                  defaultValue={encounter.chiefComplaint ?? ""}
                  placeholder="Enter the primary reason for today's visit..."
                  className="w-full rounded-lg border border-slate-200 p-3 text-sm"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  History of present illness
                </label>
                <textarea
                  name="historyOfPresentIllness"
                  maxLength={10000}
                  rows={4}
                  defaultValue={encounter.historyOfPresentIllness ?? ""}
                  placeholder="Document the history of the current concern..."
                  className="w-full rounded-lg border border-slate-200 p-3 text-sm"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Review of systems
                </label>
                <textarea
                  name="reviewOfSystems"
                  maxLength={10000}
                  rows={4}
                  defaultValue={encounter.reviewOfSystems ?? ""}
                  placeholder="Document relevant review of systems..."
                  className="w-full rounded-lg border border-slate-200 p-3 text-sm"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Physical examination
                </label>
                <textarea
                  name="physicalExam"
                  maxLength={10000}
                  rows={4}
                  defaultValue={encounter.physicalExam ?? ""}
                  placeholder="Document examination findings..."
                  className="w-full rounded-lg border border-slate-200 p-3 text-sm"
                />
              </div>
            </div>
          </section>

          <section className="card p-6">
            <h2 className="text-lg font-semibold text-ink">
              Vital signs
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Enter synthetic demonstration measurements only.
            </p>

            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["systolic", "Systolic BP", "mmHg"],
                ["diastolic", "Diastolic BP", "mmHg"],
                ["pulse", "Pulse", "bpm"],
                ["temperature", "Temperature", "°C"],
                ["respiratoryRate", "Respiratory rate", "/min"],
                ["oxygenSaturation", "Oxygen saturation", "%"],
                ["heightCm", "Height", "cm"],
                ["weightKg", "Weight", "kg"],
              ].map(([name, label, unit]) => (
                <div key={name}>
                  <label
                    htmlFor={name}
                    className="mb-2 block text-sm font-medium"
                  >
                    {label} ({unit})
                  </label>
                  <input
                    id={name}
                    name={name}
                    type="number"
                    min="0"
                    step="any"
                    defaultValue={vitalValue(vitals, name)}
                    className="w-full rounded-lg border border-slate-200 p-3 text-sm"
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="card p-6">
            <h2 className="text-lg font-semibold text-ink">
              Assessment and plan
            </h2>

            <div className="mt-5 space-y-5">
              <div>
                <label className="mb-2 block text-sm font-medium">
                  Clinical assessment *
                </label>
                <textarea
                  name="assessment"
                  required
                  maxLength={10000}
                  rows={4}
                  defaultValue={encounter.assessment ?? ""}
                  placeholder="Enter the clinical assessment..."
                  className="w-full rounded-lg border border-slate-200 p-3 text-sm"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Diagnosis
                </label>
                <textarea
                  name="diagnosis"
                  maxLength={5000}
                  rows={3}
                  defaultValue={encounter.diagnosis ?? ""}
                  placeholder="Enter diagnosis text for this demonstration..."
                  className="w-full rounded-lg border border-slate-200 p-3 text-sm"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Treatment plan *
                </label>
                <textarea
                  name="plan"
                  required
                  maxLength={10000}
                  rows={4}
                  defaultValue={encounter.plan ?? ""}
                  placeholder="Document the treatment and follow-up plan..."
                  className="w-full rounded-lg border border-slate-200 p-3 text-sm"
                />
              </div>
            </div>
          </section>
        </fieldset>

        {signed ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-5">
            <p className="font-semibold text-green-800">
              This encounter has been signed.
            </p>
            <p className="mt-1 text-sm text-green-700">
              Signed at: {encounter.signedAt?.toLocaleString() ?? "Recorded"}
            </p>
            <p className="mt-1 text-sm text-green-700">
              Documentation is read-only.
            </p>
          </div>
        ) : (
          <div className="card flex flex-wrap justify-between gap-3 p-5">
            <button
              type="submit"
              className="rounded-lg bg-teal px-5 py-3 text-sm font-semibold text-white"
            >
              Save clinical documentation
            </button>

            <span className="self-center text-xs text-slate-500">
              Signing is a separate action available to the assigned provider.
            </span>
          </div>
        )}
      </form>

      {!signed && canSign && (
        <section className="card mt-6 p-5">
          <h2 className="font-semibold text-ink">
            Provider signature
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Review the saved chief complaint, assessment and plan before signing.
            Signing locks the encounter in this demo workflow.
          </p>

          <form action={signClinicalEncounter} className="mt-4">
            <input
              type="hidden"
              name="encounterId"
              value={encounter.id}
            />
            <button
              type="submit"
              className="rounded-lg bg-green-700 px-5 py-3 text-sm font-semibold text-white"
            >
              Sign encounter
            </button>
          </form>
        </section>
      )}

      <section className="card mt-6 p-6">
        <h2 className="text-lg font-semibold text-ink">
          Encounter activity
        </h2>

        <div className="mt-4 space-y-3">
          {activity.length === 0 ? (
            <p className="text-sm text-slate-500">
              No encounter activity recorded yet.
            </p>
          ) : (
            activity.map((event) => (
              <div
                key={event.id}
                className="border-l-2 border-teal py-1 pl-4"
              >
                <p className="text-sm font-medium text-ink">
                  {event.action.replaceAll("_", " ")}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {event.createdAt.toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
      </section>
    </AppShell>
  );
}