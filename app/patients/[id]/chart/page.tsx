
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import AppShell from "@/components/AppShell";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

function formatDate(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone,
  }).format(value);
}

function formatDateTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(value);
}

function formatIcdCode(code: string) {
  if (code.length <= 3) return code;
  return `${code.slice(0, 3)}.${code.slice(3)}`;
}

function getVitals(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const labels: Record<string, string> = {
    systolic: "Systolic BP",
    diastolic: "Diastolic BP",
    pulse: "Pulse",
    temperature: "Temperature",
    respiratoryRate: "Respiratory rate",
    oxygenSaturation: "Oxygen saturation",
    heightCm: "Height",
    weightKg: "Weight",
  };

  return Object.entries(value)
    .filter(
      ([key, item]) =>
        key in labels &&
        typeof item === "number" &&
        Number.isFinite(item)
    )
    .map(([key, item]) => [labels[key], String(item)]);
}

const noteSections = [
  ["Chief complaint", "chiefComplaint"],
  ["History of present illness", "historyOfPresentIllness"],
  ["Review of systems", "reviewOfSystems"],
  ["Physical examination", "physicalExam"],
  ["Clinical assessment", "assessment"],
  ["Diagnosis", "diagnosis"],
  ["Treatment plan", "plan"],
] as const;

export default async function PatientChartPage({ params }: PageProps) {
  const user = await currentUser();

  if (!user || !user.active) redirect("/login");

  if (!["ADMIN", "PROVIDER", "CLINICAL_STAFF"].includes(user.role)) {
    redirect("/?error=unauthorized");
  }

  const { id } = await params;
  const timeZone = user.practice.timezone || "America/New_York";

  const patient = await db.patient.findFirst({
    where: {
      id,
      practiceId: user.practiceId,
    },
  });

  if (!patient) notFound();

  let providerId: string | undefined;

  if (user.role === "PROVIDER") {
    const provider = await db.provider.findFirst({
      where: {
        practiceId: user.practiceId,
        displayName: user.displayName,
        active: true,
      },
      select: { id: true },
    });

    if (!provider) redirect("/clinical?error=provider-access");

    providerId = provider.id;
  }

  const providerFilter = providerId ? { providerId } : {};

  const [appointments, encounters] = await Promise.all([
    db.appointment.findMany({
      where: {
        patientId: patient.id,
        practiceId: user.practiceId,
        ...providerFilter,
      },
      include: {
        provider: true,
      },
      orderBy: { startsAt: "desc" },
      take: 50,
    }),
    db.clinicalEncounter.findMany({
      where: {
        patientId: patient.id,
        practiceId: user.practiceId,
        ...providerFilter,
      },
      include: {
        provider: true,
        author: true,
        appointment: true,
        diagnoses: {
          include: {
            diagnosisCode: true,
          },
          orderBy: {
            sequence: "asc",
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const latestVitalsEncounter = encounters.find(
    (encounter) => encounter.vitals !== null
  );

  const totalCodedDiagnoses = encounters.reduce(
    (total, encounter) => total + encounter.diagnoses.length,
    0
  );

  return (
    <AppShell user={user} active="Patients">
      <div className="mb-6">
        <Link
          href={`/patients/${patient.id}`}
          className="text-sm font-medium text-teal hover:underline"
        >
          ← Back to patient profile
        </Link>
      </div>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-teal">
            LONGITUDINAL PATIENT CHART
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">
            {patient.firstName} {patient.lastName}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            MRN: {patient.mrn}
          </p>
        </div>

        <span className="rounded-full bg-green-50 px-4 py-2 text-sm font-medium text-green-700">
          {patient.status}
        </span>
      </div>

      <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        SYNTHETIC DEMO — This chart contains fictional demonstration data.
        Not for live clinical use.
      </div>

      <section className="card mb-6 p-6">
        <h2 className="text-lg font-semibold text-ink">
          Patient overview
        </h2>

        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">Medical record number</p>
            <p className="mt-1 font-medium">{patient.mrn}</p>
          </div>

          <div>
            <p className="text-xs text-slate-500">Date of birth</p>
            <p className="mt-1 font-medium">
              {formatDate(patient.dateOfBirth, timeZone)}
            </p>
          </div>

          <div>
            <p className="text-xs text-slate-500">Phone</p>
            <p className="mt-1 font-medium">{patient.phone}</p>
          </div>

          <div>
            <p className="text-xs text-slate-500">Patient status</p>
            <p className="mt-1 font-medium">{patient.status}</p>
          </div>
        </div>
      </section>

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <section className="card p-5">
          <p className="text-sm text-slate-500">Appointments</p>
          <p className="mt-2 text-3xl font-semibold text-ink">
            {appointments.length}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Up to 50 recent records
          </p>
        </section>

        <section className="card p-5">
          <p className="text-sm text-slate-500">Clinical encounters</p>
          <p className="mt-2 text-3xl font-semibold text-ink">
            {encounters.length}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Up to 50 recent records
          </p>
        </section>

        <section className="card p-5">
          <p className="text-sm text-slate-500">Signed encounters</p>
          <p className="mt-2 text-3xl font-semibold text-ink">
            {encounters.filter((item) => item.status === "SIGNED").length}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Provider-signed records
          </p>
        </section>

        <section className="card p-5">
          <p className="text-sm text-slate-500">Coded diagnoses</p>
          <p className="mt-2 text-3xl font-semibold text-ink">
            {totalCodedDiagnoses}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Across recent encounters
          </p>
        </section>
      </div>

      <section className="card mb-6 p-6">
        <h2 className="text-lg font-semibold text-ink">
          Latest recorded vital signs
        </h2>

        {!latestVitalsEncounter ||
        getVitals(latestVitalsEncounter.vitals).length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            No vital signs have been recorded yet.
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs text-slate-500">
              From encounter on{" "}
              {formatDateTime(latestVitalsEncounter.createdAt, timeZone)}
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {getVitals(latestVitalsEncounter.vitals).map(
                ([label, value]) => (
                  <div
                    key={label}
                    className="rounded-lg bg-slate-50 p-4"
                  >
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="mt-1 text-lg font-semibold text-ink">
                      {value}
                    </p>
                  </div>
                )
              )}
            </div>
          </>
        )}
      </section>

      <section className="card mb-6 overflow-hidden">
        <div className="border-b border-slate-100 p-5">
          <h2 className="text-lg font-semibold text-ink">
            Appointment history
          </h2>
        </div>

        {appointments.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            No appointments found.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {appointments.map((appointment) => (
              <div
                key={appointment.id}
                className="flex flex-wrap items-center justify-between gap-3 p-5"
              >
                <div>
                  <p className="font-medium text-ink">
                    {appointment.visitType}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {appointment.provider.displayName}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {formatDateTime(appointment.startsAt, timeZone)} ·{" "}
                    {appointment.durationMin} minutes
                  </p>
                </div>

                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                  {appointment.status.replace("_", " ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card mb-6 overflow-hidden">
        <div className="border-b border-slate-100 p-5">
          <h2 className="text-lg font-semibold text-ink">
            Coded diagnosis history
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            ICD-10-CM diagnoses recorded for this patient, grouped by encounter.
          </p>
        </div>

        {totalCodedDiagnoses === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            No coded diagnoses have been recorded for this patient.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {encounters
              .filter((encounter) => encounter.diagnoses.length > 0)
              .map((encounter) => (
                <article key={encounter.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-ink">
                        {encounter.appointment.visitType}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {encounter.provider.displayName}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        Encounter date:{" "}
                        {formatDateTime(encounter.createdAt, timeZone)}
                      </p>
                    </div>

                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        encounter.status === "SIGNED"
                          ? "bg-green-50 text-green-700"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {encounter.status.replace("_", " ")}
                    </span>
                  </div>

                  <div className="mt-4 space-y-3">
                    {encounter.diagnoses.map((diagnosis) => (
                      <div
                        key={diagnosis.id}
                        className="rounded-lg border border-slate-200 p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink">
                            {formatIcdCode(diagnosis.diagnosisCode.code)}
                          </span>

                          <span
                            className={
                              diagnosis.sequence === 1
                                ? "rounded-full bg-teal/10 px-2 py-1 text-xs font-semibold text-teal"
                                : "rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600"
                            }
                          >
                            {diagnosis.sequence === 1
                              ? "Primary"
                              : "Secondary"}
                          </span>
                        </div>

                        <p className="mt-2 text-sm text-slate-600">
                          {diagnosis.diagnosisCode.description}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4">
                    <Link
                      href={`/clinical/${encounter.id}`}
                      className="text-sm font-medium text-teal hover:underline"
                    >
                      Open encounter details →
                    </Link>
                  </div>
                </article>
              ))}
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-100 p-5">
          <h2 className="text-lg font-semibold text-ink">
            Clinical encounter history
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Previous clinical documentation, assessments and plans.
          </p>
        </div>

        {encounters.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            No clinical encounters found.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {encounters.map((encounter) => (
              <article key={encounter.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-ink">
                      {encounter.appointment.visitType}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {encounter.provider.displayName}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Created:{" "}
                      {formatDateTime(encounter.createdAt, timeZone)}
                    </p>
                    {encounter.signedAt && (
                      <p className="mt-1 text-xs text-slate-400">
                        Signed:{" "}
                        {formatDateTime(encounter.signedAt, timeZone)}
                      </p>
                    )}
                  </div>

                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      encounter.status === "SIGNED"
                        ? "bg-green-50 text-green-700"
                        : encounter.status === "IN_PROGRESS"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {encounter.status.replace("_", " ")}
                  </span>
                </div>

                <div className="mt-5 space-y-4">
                  {noteSections.map(([label, field]) => {
                    const value = encounter[field];

                    if (!value) return null;

                    return (
                      <div key={field}>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {label}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">
                          {value}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {getVitals(encounter.vitals).length > 0 && (
                  <div className="mt-5 rounded-lg bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Recorded vital signs
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {getVitals(encounter.vitals).map(
                        ([label, value]) => (
                          <span
                            key={label}
                            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
                          >
                            <strong>{label}:</strong> {value}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-5">
                  <Link
                    href={`/clinical/${encounter.id}`}
                    className="text-sm font-medium text-teal hover:underline"
                  >
                    Open encounter details →
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <p className="mt-5 text-xs text-slate-400">
        Display limited to the 50 most recent appointments and encounters.
        Provider accounts see records associated with their own provider profile.
        Historical signed documentation is displayed as recorded.
      </p>
    </AppShell>
  );
}