
import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();

  if (!user || !user.active) redirect("/login");

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [patients, appointments, providers, nextAppointments] =
    await Promise.all([
      db.patient.count({
        where: {
          practiceId: user.practiceId,
          status: "ACTIVE",
        },
      }),
      db.appointment.count({
        where: {
          practiceId: user.practiceId,
          startsAt: { gte: startOfDay },
        },
      }),
      db.provider.count({
        where: {
          practiceId: user.practiceId,
          active: true,
        },
      }),
      db.appointment.findMany({
        where: {
          practiceId: user.practiceId,
          startsAt: { gte: new Date() },
        },
        include: { patient: true, provider: true },
        orderBy: { startsAt: "asc" },
        take: 5,
      }),
    ]);

  return (
    <AppShell user={user} active="Dashboard">
      <div className="mb-8">
        <div className="mb-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
          DEMO / SYNTHETIC DATA ENVIRONMENT
        </div>

        <h1 className="text-3xl font-semibold tracking-tight">
          Good morning, {user.displayName.split(" ")[0]}
        </h1>

        <p className="mt-2 text-slate-500">
          Here is today&apos;s operating picture for {user.practice.name}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Active patients" value={patients} />
        <Metric label="Today's visits" value={appointments} />
        <Metric label="Active providers" value={providers} />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <section className="card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Upcoming schedule</h2>
              <p className="mt-1 text-sm text-slate-500">
                The next appointments in your practice.
              </p>
            </div>

            <span className="rounded-lg bg-mist px-3 py-2 text-xs font-semibold text-teal">
              LIVE FROM DATABASE
            </span>
          </div>

          <div className="mt-5 divide-y divide-slate-100">
            {nextAppointments.map((appointment) => (
              <div
                key={appointment.id}
                className="flex items-center justify-between gap-4 py-4"
              >
                <div>
                  <p className="font-semibold">
                    {appointment.patient.firstName}{" "}
                    {appointment.patient.lastName}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {appointment.visitType} ·{" "}
                    {appointment.provider.displayName}
                  </p>
                </div>

                <div className="text-right">
                  <p className="font-semibold">
                    {appointment.startsAt.toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                  <p className="text-xs text-slate-400">
                    {appointment.status}
                  </p>
                </div>
              </div>
            ))}

            {nextAppointments.length === 0 && (
              <p className="py-8 text-sm text-slate-500">
                No upcoming appointments.
              </p>
            )}
          </div>
        </section>

        <section className="card p-6">
          <h2 className="text-lg font-semibold">Quick actions</h2>
          <p className="mt-2 text-sm text-slate-500">
            Access frequently used practice workflows.
          </p>

          <div className="mt-5 space-y-3">
            <Link
              href="/patients"
              className="block rounded-lg border border-slate-200 p-4 hover:border-teal"
            >
              <p className="font-semibold">Patient directory</p>
              <p className="mt-1 text-sm text-slate-500">
                Search and manage patient records
              </p>
            </Link>

            <Link
              href="/patients/new"
              className="block rounded-lg border border-slate-200 p-4 hover:border-teal"
            >
              <p className="font-semibold">Register patient</p>
              <p className="mt-1 text-sm text-slate-500">
                Create a new synthetic patient record
              </p>
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="card p-5">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-3 text-3xl font-semibold">{value}</div>
      <div className="mt-2 text-xs font-medium text-teal">
        Retrieved from PostgreSQL
      </div>
    </div>
  );
}