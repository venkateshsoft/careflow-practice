
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { updatePatient } from "@/lib/patient-actions";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ updated?: string }>;
};

export default async function PatientDetailPage({
  params,
  searchParams,
}: PageProps) {
  const user = await currentUser();

  if (!user || !user.active) redirect("/login");

  const { id } = await params;
  const query = await searchParams;

  const patient = await db.patient.findFirst({
    where: {
      id,
      practiceId: user.practiceId,
    },
  });

  if (!patient) notFound();

  const canEdit = [
    "ADMIN",
    "RECEPTIONIST",
    "PROVIDER",
    "CLINICAL_STAFF",
  ].includes(user.role);

  const canViewChart = [
    "ADMIN",
    "PROVIDER",
    "CLINICAL_STAFF",
  ].includes(user.role);

  const canViewAccount = [
    "ADMIN",
    "BILLING",
    "PROVIDER",
  ].includes(user.role);

  const recentActivity = await db.auditEvent.findMany({
    where: {
      practiceId: user.practiceId,
      entityType: "Patient",
      entityId: patient.id,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const dateOfBirth = patient.dateOfBirth.toISOString().slice(0, 10);

  return (
    <AppShell user={user} active="Patients">
      <div className="mb-8">
        <Link
          href="/patients"
          className="text-sm font-medium text-teal hover:underline"
        >
          ← Back to patients
        </Link>

        <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-teal">
              PATIENT PROFILE
            </p>
            <h1 className="mt-2 text-3xl font-semibold">
              {patient.firstName} {patient.lastName}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Medical Record Number: {patient.mrn}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-green-50 px-4 py-2 text-sm font-medium text-green-700">
              {patient.status}
            </span>

            {canViewChart && (
              <Link
                href={`/patients/${patient.id}/chart`}
                className="rounded-lg bg-teal px-5 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90"
              >
                Open Longitudinal Chart
              </Link>
            )}
          </div>
        </div>
      </div>

      {query.updated === "1" && (
        <div className="mb-5 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          Patient information updated successfully.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <section className="card p-6">
          <h2 className="text-lg font-semibold">Patient demographics</h2>
          <p className="mt-1 text-sm text-slate-500">
            Review or update this synthetic patient record.
          </p>

          {canEdit ? (
            <form action={updatePatient} className="mt-6 space-y-5">
              <input
                type="hidden"
                name="patientId"
                value={patient.id}
              />

              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block text-sm font-medium">
                  First name
                  <input
                    name="firstName"
                    required
                    maxLength={80}
                    defaultValue={patient.firstName}
                    className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-3 font-normal outline-none focus:border-teal"
                  />
                </label>

                <label className="block text-sm font-medium">
                  Last name
                  <input
                    name="lastName"
                    required
                    maxLength={80}
                    defaultValue={patient.lastName}
                    className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-3 font-normal outline-none focus:border-teal"
                  />
                </label>

                <label className="block text-sm font-medium">
                  Date of birth
                  <input
                    type="date"
                    name="dateOfBirth"
                    required
                    max={new Date().toISOString().slice(0, 10)}
                    defaultValue={dateOfBirth}
                    className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-3 font-normal outline-none focus:border-teal"
                  />
                </label>

                <label className="block text-sm font-medium">
                  Phone number
                  <input
                    type="tel"
                    name="phone"
                    required
                    maxLength={25}
                    defaultValue={patient.phone}
                    className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-3 font-normal outline-none focus:border-teal"
                  />
                </label>
              </div>

              <div className="rounded-lg bg-mist p-4 text-xs leading-5 text-slate-600">
                Patient MRN: {patient.mrn}
                <br />
                The MRN is system-generated and cannot be changed here.
              </div>

              <button
                type="submit"
                className="rounded-lg bg-teal px-6 py-3 text-sm font-semibold text-white hover:opacity-90"
              >
                Save changes
              </button>
            </form>
          ) : (
            <dl className="mt-6 space-y-4 text-sm">
              <div>
                <dt className="text-slate-500">First name</dt>
                <dd className="mt-1 font-medium">{patient.firstName}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Last name</dt>
                <dd className="mt-1 font-medium">{patient.lastName}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Date of birth</dt>
                <dd className="mt-1 font-medium">{dateOfBirth}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Phone</dt>
                <dd className="mt-1 font-medium">{patient.phone}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className="card p-6">
          <h2 className="text-lg font-semibold">Record information</h2>

          <dl className="mt-5 space-y-5 text-sm">
            <div>
              <dt className="text-slate-500">Medical record number</dt>
              <dd className="mt-1 font-mono font-semibold">
                {patient.mrn}
              </dd>
            </div>

            <div>
              <dt className="text-slate-500">Patient status</dt>
              <dd className="mt-1 font-medium">{patient.status}</dd>
            </div>

            <div>
              <dt className="text-slate-500">Registered on</dt>
              <dd className="mt-1 font-medium">
                {patient.createdAt.toLocaleString("en-US")}
              </dd>
            </div>

            <div>
              <dt className="text-slate-500">Practice</dt>
              <dd className="mt-1 font-medium">{user.practice.name}</dd>
            </div>
          </dl>

          <div className="mt-8 border-t border-slate-100 pt-5">
            <h3 className="font-semibold">Audit activity</h3>

            {recentActivity.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                No audit events recorded for this patient.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                {recentActivity.map((event) => (
                  <div
                    key={event.id}
                    className="border-l-2 border-teal pl-3"
                  >
                    <p className="text-sm font-medium">
                      {event.action.replaceAll("_", " ")}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {event.createdAt.toLocaleString("en-US")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {canViewAccount && (
        <section className="card mt-6 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold tracking-wider text-teal">
                REVENUE CYCLE MANAGEMENT
              </p>

              <h2 className="mt-2 text-xl font-semibold">
                Financial & Billing
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Review posted charges, adjustments, payment allocations
                and the patient's outstanding account balance.
              </p>
            </div>

            <Link
              href={`/patients/${patient.id}/account`}
              className="inline-flex items-center rounded-lg bg-teal px-5 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90"
            >
              View Account Ledger
            </Link>
          </div>
        </section>
      )}
    </AppShell>
  );
}