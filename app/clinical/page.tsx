
import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { startClinicalEncounter } from "@/lib/clinical-actions";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  dateInTimeZone,
  formatAppointmentTime,
  startOfDayInTimeZone,
  addCalendarDays,
} from "@/lib/schedule-time";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function ClinicalPage({ searchParams }: PageProps) {
  const user = await currentUser();

  if (!user || !user.active) redirect("/login");

  if (!["ADMIN", "PROVIDER", "CLINICAL_STAFF"].includes(user.role)) {
    redirect("/?error=unauthorized");
  }

  const query = await searchParams;
  const timeZone = user.practice.timezone || "America/New_York";
  const today = dateInTimeZone(new Date(), timeZone);
  const start = startOfDayInTimeZone(today, timeZone);
  const end = startOfDayInTimeZone(addCalendarDays(today, 1), timeZone);

  const providerFilter =
    user.role === "PROVIDER"
      ? {
          provider: {
            displayName: user.displayName,
          },
        }
      : {};

  const appointments = await db.appointment.findMany({
    where: {
      practiceId: user.practiceId,
      status: "CHECKED_IN",
      startsAt: {
        gte: start,
        lt: end,
      },
      ...providerFilter,
    },
    include: {
      patient: true,
      provider: true,
      encounter: true,
    },
    orderBy: { startsAt: "asc" },
  });

  const errorMessages: Record<string, string> = {
    unauthorized: "You do not have permission to access clinical encounters.",
    invalid: "The requested clinical operation contains invalid information.",
    "not-checked-in": "Only checked-in appointments can start an encounter.",
    "provider-access": "You are not authorized for this provider's encounter.",
    "encounter-exists": "An encounter already exists for this appointment.",
    notfound: "The requested encounter could not be found.",
    "signing-unauthorized": "Only the assigned provider can sign an encounter.",
  };

  return (
    <AppShell user={user} active="Clinical">
      <div className="mb-8">
        <p className="text-sm font-medium text-teal">
          CLINICAL OPERATIONS
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">
          Clinical Encounters
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Review checked-in patients and document their clinical encounters.
        </p>
      </div>

      <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        DEMO ENVIRONMENT — Synthetic patient and clinical information only.
        Not for live clinical use.
      </div>

      {query.error && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errorMessages[query.error] ??
            "There was a problem processing the clinical request."}
        </div>
      )}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
          <div>
            <h2 className="text-lg font-semibold text-ink">
              Checked-in patients
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {today} · {timeZone}
            </p>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
            {appointments.length} patient(s)
          </span>
        </div>

        {appointments.length === 0 ? (
          <div className="p-10 text-center">
            <h3 className="font-semibold text-ink">
              No checked-in appointments today
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Check in a patient from the Schedule module to start a clinical encounter.
            </p>
            <Link
              href="/schedule"
              className="mt-5 inline-block rounded-lg bg-teal px-5 py-3 text-sm font-semibold text-white"
            >
              Open Schedule
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {appointments.map((appointment) => (
              <div
                key={appointment.id}
                className="flex flex-wrap items-center justify-between gap-4 p-5"
              >
                <div>
                  <p className="font-semibold text-ink">
                    {appointment.patient.firstName}{" "}
                    {appointment.patient.lastName}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    MRN: {appointment.patient.mrn}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {appointment.provider.displayName} ·{" "}
                    {appointment.visitType}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {formatAppointmentTime(appointment.startsAt, timeZone)}
                    {" · "}
                    {appointment.durationMin} minutes
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {appointment.encounter ? (
                    <>
                      <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700">
                        {appointment.encounter.status.replace("_", " ")}
                      </span>
                      <Link
                        href={`/clinical/${appointment.encounter.id}`}
                        className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-50"
                      >
                        Open encounter
                      </Link>
                    </>
                  ) : (
                    <form action={startClinicalEncounter}>
                      <input
                        type="hidden"
                        name="appointmentId"
                        value={appointment.id}
                      />
                      <button
                        type="submit"
                        className="rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                      >
                        Start encounter
                      </button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}