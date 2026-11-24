
import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { updateAppointmentStatus } from "@/lib/appointment-actions";
import {
  addCalendarDays,
  dateInTimeZone,
  formatAppointmentTime,
  formatCalendarDate,
  isValidCalendarDate,
  startOfDayInTimeZone,
} from "@/lib/schedule-time";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    date?: string;
    provider?: string;
    created?: string;
    updated?: string;
    error?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  invalid: "The scheduling request contains invalid information.",
  unauthorized: "You do not have permission to perform this action.",
  notfound: "The appointment could not be found.",
  "invalid-transition": "This appointment has already changed status or this transition is not allowed.",
  retry: "Another scheduling operation occurred at the same time. Please try again.",
};

export default async function SchedulePage({ searchParams }: PageProps) {
  const user = await currentUser();

  if (!user || !user.active) redirect("/login");

  const query = await searchParams;
  const timeZone = user.practice.timezone || "America/New_York";

  const today = dateInTimeZone(new Date(), timeZone);
  const selectedDate =
    query.date && isValidCalendarDate(query.date)
      ? query.date
      : today;

  const providers = await db.provider.findMany({
    where: {
      practiceId: user.practiceId,
      active: true,
    },
    orderBy: { displayName: "asc" },
  });

  const selectedProvider =
    query.provider &&
    providers.some((provider) => provider.id === query.provider)
      ? query.provider
      : "all";

  const visibleProviders =
    selectedProvider === "all"
      ? providers
      : providers.filter((provider) => provider.id === selectedProvider);

  const start = startOfDayInTimeZone(selectedDate, timeZone);
  const end = startOfDayInTimeZone(
    addCalendarDays(selectedDate, 1),
    timeZone
  );

  const appointments = visibleProviders.length
    ? await db.appointment.findMany({
        where: {
          practiceId: user.practiceId,
          providerId: { in: visibleProviders.map((provider) => provider.id) },
          startsAt: {
            gte: start,
            lt: end,
          },
        },
        include: {
          patient: true,
          provider: true,
        },
        orderBy: { startsAt: "asc" },
      })
    : [];

  const previousDate = addCalendarDays(selectedDate, -1);
  const nextDate = addCalendarDays(selectedDate, 1);
  const dayLabel = formatCalendarDate(selectedDate, timeZone);

  const canCheckIn = ["ADMIN", "RECEPTIONIST"].includes(user.role);
  const canComplete = [
    "ADMIN",
    "PROVIDER",
    "CLINICAL_STAFF",
  ].includes(user.role);
  const canCancel = [
    "ADMIN",
    "RECEPTIONIST",
    "PROVIDER",
  ].includes(user.role);

  return (
    <AppShell user={user} active="Schedule">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-teal">
            PRACTICE MANAGEMENT
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">
            Appointment Schedule
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Manage patient appointments across all providers.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            DEMO — Synthetic data only
          </div>

          {["ADMIN", "RECEPTIONIST", "PROVIDER"].includes(user.role) && (
            <Link
              href={`/schedule/new?date=${selectedDate}`}
              className="rounded-lg bg-teal px-5 py-3 text-sm font-semibold text-white hover:opacity-90"
            >
              + New Appointment
            </Link>
          )}
        </div>
      </div>

      {query.created === "1" && (
        <div className="mb-5 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
          Appointment created successfully.
        </div>
      )}

      {query.updated === "1" && (
        <div className="mb-5 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
          Appointment status updated successfully.
        </div>
      )}

      {query.error && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errorMessages[query.error] ??
            "There was a problem processing your scheduling request."}
        </div>
      )}

      <section className="card mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">
              {dayLabel}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Practice timezone: {timeZone}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/schedule?date=${previousDate}${selectedProvider !== "all" ? `&provider=${selectedProvider}` : ""}`}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
            >
              ← Previous
            </Link>

            <Link
              href={`/schedule${selectedProvider !== "all" ? `?provider=${selectedProvider}` : ""}`}
              className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Today
            </Link>

            <Link
              href={`/schedule?date=${nextDate}${selectedProvider !== "all" ? `&provider=${selectedProvider}` : ""}`}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
            >
              Next →
            </Link>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="mr-2 text-sm font-medium text-slate-600">
            Provider:
          </span>

          <Link
            href={`/schedule?date=${selectedDate}`}
            className={`rounded-full px-4 py-2 text-sm ${
              selectedProvider === "all"
                ? "bg-teal text-white"
                : "border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            All providers
          </Link>

          {providers.map((provider) => (
            <Link
              key={provider.id}
              href={`/schedule?date=${selectedDate}&provider=${provider.id}`}
              className={`rounded-full px-4 py-2 text-sm ${
                selectedProvider === provider.id
                  ? "bg-teal text-white"
                  : "border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {provider.displayName}
            </Link>
          ))}
        </div>
      </section>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">
          Provider calendar
        </h2>
        <span className="text-sm text-slate-500">
          {appointments.length} appointment(s)
        </span>
      </div>

      {visibleProviders.length === 0 ? (
        <section className="card p-8 text-center">
          <h3 className="font-semibold text-ink">
            No active providers found
          </h3>
          <p className="mt-2 text-sm text-slate-500">
            Add an active provider before scheduling appointments.
          </p>
        </section>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleProviders.map((provider) => {
            const providerAppointments = appointments.filter(
              (appointment) => appointment.providerId === provider.id
            );

            return (
              <section
                key={provider.id}
                className="card min-w-0 overflow-hidden"
              >
                <div className="border-b border-slate-100 bg-slate-50 p-4">
                  <h3 className="font-semibold text-ink">
                    {provider.displayName}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {provider.specialty} · {provider.credential}
                  </p>
                  <p className="mt-2 text-xs font-medium text-teal">
                    {providerAppointments.length} appointment(s)
                  </p>
                </div>

                <div className="space-y-3 p-4">
                  {providerAppointments.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center">
                      <p className="text-sm text-slate-500">
                        No appointments scheduled
                      </p>
                    </div>
                  ) : (
                    providerAppointments.map((appointment) => {
                      const status = appointment.status;
                      const isScheduled = status === "SCHEDULED";
                      const isCheckedIn = status === "CHECKED_IN";
                      const isTerminal =
                        status === "COMPLETED" ||
                        status === "CANCELLED";

                      const statusStyle =
                        status === "COMPLETED"
                          ? "bg-green-50 text-green-700"
                          : status === "CANCELLED"
                            ? "bg-red-50 text-red-700"
                            : status === "CHECKED_IN"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-slate-100 text-slate-700";

                      return (
                        <article
                          key={appointment.id}
                          className="rounded-lg border border-slate-200 p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-teal">
                              {formatAppointmentTime(
                                appointment.startsAt,
                                timeZone
                              )}
                            </span>

                            <span
                              className={`rounded-full px-2 py-1 text-xs font-medium ${statusStyle}`}
                            >
                              {status.replace("_", " ")}
                            </span>
                          </div>

                          <p className="mt-3 font-semibold text-ink">
                            {appointment.patient.firstName}{" "}
                            {appointment.patient.lastName}
                          </p>

                          <p className="mt-1 text-sm text-slate-500">
                            {appointment.visitType}
                          </p>

                          <p className="mt-2 text-xs text-slate-400">
                            {appointment.durationMin} minutes
                          </p>

                          {!isTerminal && (
                            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                              {isScheduled && canCheckIn && (
                                <form action={updateAppointmentStatus}>
                                  <input
                                    type="hidden"
                                    name="appointmentId"
                                    value={appointment.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="status"
                                    value="CHECKED_IN"
                                  />
                                  <button
                                    type="submit"
                                    className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                                  >
                                    Check in
                                  </button>
                                </form>
                              )}

                              {isCheckedIn && canComplete && (
                                <form action={updateAppointmentStatus}>
                                  <input
                                    type="hidden"
                                    name="appointmentId"
                                    value={appointment.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="status"
                                    value="COMPLETED"
                                  />
                                  <button
                                    type="submit"
                                    className="rounded-md bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700"
                                  >
                                    Complete visit
                                  </button>
                                </form>
                              )}

                              {canCancel && (
                                <form action={updateAppointmentStatus}>
                                  <input
                                    type="hidden"
                                    name="appointmentId"
                                    value={appointment.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="status"
                                    value="CANCELLED"
                                  />
                                  <button
                                    type="submit"
                                    className="rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                                  >
                                    Cancel
                                  </button>
                                </form>
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}