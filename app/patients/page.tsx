import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    q?: string;
    created?: string;
    error?: string;
  }>;
};

export default async function PatientsPage({ searchParams }: PageProps) {
  const user = await currentUser();

  if (!user || !user.active) redirect("/login");

  const params = await searchParams;
  const query = (params.q ?? "").trim();

  const patients = await db.patient.findMany({
    where: {
      practiceId: user.practiceId,
      ...(query
        ? {
            OR: [
              { firstName: { contains: query, mode: "insensitive" } },
              { lastName: { contains: query, mode: "insensitive" } },
              { mrn: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 100,
  });

  const canCreate = ["ADMIN", "RECEPTIONIST"].includes(user.role);

  return (
    <AppShell user={user} active="Patients">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-teal">PRACTICE MANAGEMENT</p>
          <h1 className="mt-2 text-3xl font-semibold">Patients</h1>
          <p className="mt-2 text-slate-500">
            Search and manage your practice&apos;s synthetic patient records.
          </p>
        </div>

        {canCreate && (
          <Link
            href="/patients/new"
            className="rounded-lg bg-teal px-5 py-3 text-sm font-semibold text-white hover:opacity-90"
          >
            + Register patient
          </Link>
        )}
      </div>

      {params.created === "1" && (
        <div className="mb-5 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          Patient registered successfully.
        </div>
      )}

      {params.error && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {params.error === "unauthorized"
            ? "You do not have permission to perform that action."
            : params.error === "notfound"
              ? "The requested patient could not be found."
              : "The request could not be completed. Please check the information and try again."}
        </div>
      )}

      <section className="card p-5">
        <form method="GET" className="flex flex-wrap gap-3">
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search by patient name or MRN..."
            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-4 py-3 text-sm outline-none focus:border-teal"
          />
          <button
            type="submit"
            className="rounded-lg bg-ink px-5 py-3 text-sm font-semibold text-white"
          >
            Search
          </button>
          {query && (
            <Link
              href="/patients"
              className="rounded-lg border border-slate-200 px-5 py-3 text-sm"
            >
              Clear
            </Link>
          )}
        </form>

        <div className="mt-5 flex flex-wrap justify-between gap-2 text-sm text-slate-500">
          <span>
            {patients.length} patient{patients.length === 1 ? "" : "s"} found
          </span>
          <span>Showing up to 100 records</span>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[650px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-3">Patient</th>
                <th className="px-3 py-3">MRN</th>
                <th className="px-3 py-3">Date of birth</th>
                <th className="px-3 py-3">Phone</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((patient) => (
                <tr
                  key={patient.id}
                  className="border-b border-slate-100 hover:bg-slate-50"
                >
                  <td className="px-3 py-4 font-semibold">
                    {patient.firstName} {patient.lastName}
                  </td>
                  <td className="px-3 py-4 font-mono text-xs">
                    {patient.mrn}
                  </td>
                  <td className="px-3 py-4">
                    {patient.dateOfBirth.toLocaleDateString("en-US", {
                      month: "short",
                      day: "2-digit",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </td>
                  <td className="px-3 py-4">{patient.phone}</td>
                  <td className="px-3 py-4">
                    <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
                      {patient.status}
                    </span>
                  </td>
                  <td className="px-3 py-4">
                    <Link
                      href={`/patients/${patient.id}`}
                      className="font-semibold text-teal hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}

              {patients.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-12 text-center text-slate-500"
                  >
                    No patients found. Try another search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}