import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { currentUser } from "@/lib/auth";
import { createPatient } from "@/lib/patient-actions";

export const dynamic = "force-dynamic";

export default async function NewPatientPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();

  if (!user || !user.active) redirect("/login");

  if (!["ADMIN", "RECEPTIONIST"].includes(user.role)) {
    redirect("/patients?error=unauthorized");
  }

  const params = await searchParams;

  return (
    <AppShell user={user} active="Patients">
      <div className="mb-8">
        <Link
          href="/patients"
          className="text-sm font-medium text-teal hover:underline"
        >
          ← Back to patients
        </Link>
        <p className="mt-6 text-sm font-medium text-teal">
          PATIENT MANAGEMENT
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Register patient</h1>
        <p className="mt-2 text-slate-500">
          Create a new synthetic patient record for this practice.
        </p>
      </div>

      {params.error === "invalid" && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Please enter valid patient information. Date of birth must be a real
          date and cannot be in the future.
        </div>
      )}

      <section className="card max-w-3xl p-6">
        <form action={createPatient} className="space-y-6">
          <div>
            <h2 className="font-semibold">Patient demographics</h2>
            <p className="mt-1 text-sm text-slate-500">
              All fields are required for this demo registration.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              First name
              <input
                name="firstName"
                required
                maxLength={80}
                autoComplete="off"
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-3 font-normal outline-none focus:border-teal"
                placeholder="Enter first name"
              />
            </label>

            <label className="block text-sm font-medium">
              Last name
              <input
                name="lastName"
                required
                maxLength={80}
                autoComplete="off"
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-3 font-normal outline-none focus:border-teal"
                placeholder="Enter last name"
              />
            </label>

            <label className="block text-sm font-medium">
              Date of birth
              <input
                type="date"
                name="dateOfBirth"
                required
                max={new Date().toISOString().slice(0, 10)}
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
                autoComplete="off"
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-3 font-normal outline-none focus:border-teal"
                placeholder="Enter demo phone number"
              />
            </label>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
            Demo safety notice: use fictional names and fictional contact
            information only. Do not enter real patient information.
          </div>

          <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-5">
            <button
              type="submit"
              className="rounded-lg bg-teal px-6 py-3 text-sm font-semibold text-white hover:opacity-90"
            >
              Save patient
            </button>

            <Link
              href="/patients"
              className="rounded-lg border border-slate-200 px-6 py-3 text-sm font-semibold"
            >
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </AppShell>
  );
}