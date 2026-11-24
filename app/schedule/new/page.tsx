
import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import AppointmentForm from "@/components/AppointmentForm";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateInTimeZone, isValidCalendarDate } from "@/lib/schedule-time";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    error?: string;
    date?: string;
  }>;
};

const CREATE_ROLES = ["ADMIN", "RECEPTIONIST", "PROVIDER"];

export default async function NewAppointmentPage({
  searchParams,
}: PageProps) {
  const user = await currentUser();

  if (!user || !user.active) redirect("/login");

  if (!CREATE_ROLES.includes(user.role)) {
    redirect("/schedule?error=unauthorized");
  }

  const query = await searchParams;
  const timeZone = user.practice.timezone || "America/New_York";

  const today = dateInTimeZone(new Date(), timeZone);

  const defaultDate =
    query.date && isValidCalendarDate(query.date)
      ? query.date
      : today;

  const [patients, providers] = await Promise.all([
    db.patient.findMany({
      where: {
        practiceId: user.practiceId,
        status: "ACTIVE",
      },
      orderBy: [
        { lastName: "asc" },
        { firstName: "asc" },
      ],
      take: 200,
      select: {
        id: true,
        mrn: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
      },
    }),
    db.provider.findMany({
      where: {
        practiceId: user.practiceId,
        active: true,
      },
      orderBy: { displayName: "asc" },
      select: {
        id: true,
        displayName: true,
        specialty: true,
      },
    }),
  ]);

  const patientOptions = patients.map((patient) => ({
    ...patient,
    dateOfBirth: patient.dateOfBirth.toISOString().slice(0, 10),
  }));

  return (
    <AppShell user={user} active="Schedule">
      <div className="mb-8">
        <Link
          href="/schedule"
          className="text-sm font-medium text-teal hover:underline"
        >
          ← Back to schedule
        </Link>

        <p className="mt-6 text-sm font-medium text-teal">
          PRACTICE MANAGEMENT
        </p>

        <h1 className="mt-2 text-3xl font-semibold text-ink">
          New Appointment
        </h1>

        <p className="mt-2 text-sm text-slate-500">
          Schedule a patient appointment with an available provider.
        </p>
      </div>

      <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        DEMO ENVIRONMENT — Use synthetic patient information only.
      </div>

      <div className="mb-5 text-sm text-slate-500">
        Practice timezone: <strong>{timeZone}</strong>
      </div>

      <AppointmentForm
        patients={patientOptions}
        providers={providers}
        defaultDate={defaultDate}
        error={query.error}
      />
    </AppShell>
  );
}