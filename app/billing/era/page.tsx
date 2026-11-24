
import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { importEra835 } from "@/lib/era/import-actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  result?: string;
}>;

const resultMessages: Record<
  string,
  { title: string; message: string; style: string }
> = {
  "import-success": {
    title: "ERA file imported successfully",
    message:
      "The 835 file and its parsed records have been saved. No payments or adjustments have been posted.",
    style: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  "invalid-upload": {
    title: "Invalid upload",
    message:
      "Select a file and confirm that it contains synthetic demonstration data.",
    style: "border-red-200 bg-red-50 text-red-800",
  },
  "file-too-large": {
    title: "File size limit exceeded",
    message: "The maximum permitted file size is 5 MB.",
    style: "border-red-200 bg-red-50 text-red-800",
  },
  "invalid-file-type": {
    title: "Unsupported file type",
    message: "Upload a file with an .835, .txt or .x12 extension.",
    style: "border-red-200 bg-red-50 text-red-800",
  },
  "file-read-error": {
    title: "Unable to read file",
    message: "The uploaded file could not be read. Please try again.",
    style: "border-red-200 bg-red-50 text-red-800",
  },
  "empty-file": {
    title: "Empty file",
    message: "The selected file does not contain any content.",
    style: "border-red-200 bg-red-50 text-red-800",
  },
  "duplicate-file": {
    title: "Duplicate ERA file",
    message:
      "An identical file has already been imported for this practice.",
    style: "border-amber-200 bg-amber-50 text-amber-800",
  },
  "validation-failed": {
    title: "835 validation failed",
    message:
      "The file could not be parsed as a supported X12 835 transaction. Check the file structure and try again.",
    style: "border-red-200 bg-red-50 text-red-800",
  },
};

function money(value: number | null) {
  return value === null ? "—" : `$${value.toFixed(2)}`;
}

function formatDate(value: Date | null) {
  return value
    ? value.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
}

function Status({ status }: { status: string }) {
  const styles: Record<string, string> = {
    RECEIVED: "bg-slate-100 text-slate-700",
    VALIDATION_FAILED: "bg-red-100 text-red-800",
    VALIDATED: "bg-blue-100 text-blue-800",
    RECONCILIATION_READY: "bg-indigo-100 text-indigo-800",
    RECONCILED: "bg-emerald-100 text-emerald-800",
    POSTED: "bg-emerald-100 text-emerald-800",
    VOIDED: "bg-slate-100 text-slate-600",
  };

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
        styles[status] ?? "bg-slate-100 text-slate-600"
      }`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

export default async function EraImportPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await currentUser();

  if (!user || !user.active) {
    redirect("/login");
  }

  if (!["ADMIN", "BILLING"].includes(user.role)) {
    redirect("/?error=unauthorized");
  }

  const params = await searchParams;
  const result = params.result
    ? resultMessages[params.result]
    : undefined;

  const imports = await db.eraImport.findMany({
    where: {
      practiceId: user.practiceId,
    },
    include: {
      payer: {
        select: {
          name: true,
          payerCode: true,
        },
      },
      _count: {
        select: {
          claims: true,
          exceptions: true,
        },
      },
    },
    orderBy: {
      receivedAt: "desc",
    },
    take: 50,
  });

  const totalImports = imports.length;
  const validatedCount = imports.filter(
    (item) => item.status === "VALIDATED"
  ).length;
  const reconciliationCount = imports.filter(
    (item) => item.status === "RECONCILIATION_READY"
  ).length;
  const postedCount = imports.filter(
    (item) => item.status === "POSTED"
  ).length;

  return (
    <AppShell user={user} active="Billing">
      <div className="mb-8">
        <Link
          href="/billing"
          className="text-sm font-medium text-teal hover:underline"
        >
          ← Back to Billing
        </Link>

        <div className="mt-6 text-xs font-bold tracking-wider text-teal">
          REVENUE CYCLE MANAGEMENT
        </div>

        <h1 className="mt-2 text-3xl font-semibold">
          ERA / 835 Import
        </h1>

        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
          Import synthetic electronic remittance advice files, validate
          their X12 structure and stage claim-level and service-line
          payment information for reconciliation.
        </p>
      </div>

      {result && (
        <div
          role="status"
          className={`mb-6 rounded-xl border p-4 ${result.style}`}
        >
          <div className="font-semibold">{result.title}</div>
          <p className="mt-1 text-sm leading-5">{result.message}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Recent imports" value={totalImports} />
        <Metric label="Validated imports" value={validatedCount} />
        <Metric
          label="Ready for reconciliation"
          value={reconciliationCount}
        />
        <Metric label="Posted imports" value={postedCount} />
      </div>

      <section className="card mt-8 overflow-hidden">
        <div className="border-b border-slate-100 p-6">
          <div className="text-xs font-bold tracking-wider text-teal">
            FILE INTAKE
          </div>

          <h2 className="mt-2 text-xl font-semibold">
            Upload an X12 835 file
          </h2>

          <p className="mt-2 text-sm text-slate-500">
            Select a synthetic remittance file for server-side
            validation and import.
          </p>
        </div>

        <form
          action={importEra835}
          encType="multipart/form-data"
          className="space-y-6 p-6"
        >
          <div>
            <label
              htmlFor="eraFile"
              className="mb-2 block text-sm font-semibold text-slate-700"
            >
              Select ERA file
            </label>

            <input
              id="eraFile"
              name="eraFile"
              type="file"
              accept=".835,.txt,.x12,text/plain"
              required
              className="block w-full rounded-lg border border-slate-200 bg-white p-3 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-mist file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-700"
            />

            <p className="mt-2 text-xs text-slate-500">
              Supported extensions: .835, .txt and .x12. Maximum
              file size: 5 MB.
            </p>
          </div>

          <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <input
              type="checkbox"
              name="syntheticOnly"
              value="on"
              required
              className="mt-1 h-4 w-4 accent-teal"
            />

            <span className="leading-6">
              <strong>Synthetic data confirmation</strong>
              <br />
              I confirm this file contains fictional demonstration
              data only. It does not contain real patient,
              provider, payer or banking information.
            </span>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-5">
            <p className="max-w-xl text-xs leading-5 text-slate-500">
              Imported records are staged for review. This action
              does not create payments, post adjustments or change
              patient balances.
            </p>

            <button
              type="submit"
              className="rounded-lg bg-teal px-6 py-3 text-sm font-semibold text-white hover:opacity-90"
            >
              Validate and import 835
            </button>
          </div>
        </form>
      </section>

      <section className="card mt-8 overflow-hidden">
        <div className="border-b border-slate-100 p-6">
          <h2 className="text-lg font-semibold">
            Recent ERA imports
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Latest 50 imported remittance files for this practice.
          </p>
        </div>

        {imports.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-lg font-semibold">
              No ERA files imported
            </div>

            <p className="mt-2 text-sm text-slate-500">
              Uploaded files will appear here after successful
              validation and import.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-mist text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-4">File</th>
                  <th className="px-5 py-4">Payer</th>
                  <th className="px-5 py-4">Trace number</th>
                  <th className="px-5 py-4">Payment amount</th>
                  <th className="px-5 py-4">Claims</th>
                  <th className="px-5 py-4">Exceptions</th>
                  <th className="px-5 py-4">Received</th>
                  <th className="px-5 py-4">Status</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {imports.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="max-w-64 px-5 py-4">
                      <div
                        className="truncate font-semibold"
                        title={item.fileName}
                      >
                        {item.fileName}
                      </div>

                      <div className="mt-1 text-xs text-slate-400">
                        {item.id}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      {item.payer?.name ?? "Not assigned"}
                    </td>

                    <td className="px-5 py-4">
                      {item.traceNumber || "—"}
                    </td>

                    <td className="whitespace-nowrap px-5 py-4 font-semibold">
                      {money(item.paymentAmount?.toNumber() ?? null)}
                    </td>

                    <td className="px-5 py-4">
                      {item._count.claims}
                    </td>

                    <td className="px-5 py-4">
                      {item._count.exceptions}
                    </td>

                    <td className="whitespace-nowrap px-5 py-4">
                      {formatDate(item.receivedAt)}
                    </td>

                    <td className="px-5 py-4">
                      <Status status={item.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="font-semibold">Import processing safeguards</h3>

        <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
          <li>• Practice-scoped import records and duplicate detection.</li>
          <li>• Server-side X12 parsing and transaction validation.</li>
          <li>• Original file retained for audit and later review.</li>
          <li>• Claim and service-line records remain unmatched until reconciliation.</li>
          <li>• No automatic financial posting during import.</li>
        </ul>
      </div>

      <p className="mt-8 text-xs text-slate-400">
        DEMO ENVIRONMENT · Synthetic data only · No live payer
        connections or financial transactions.
      </p>
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
      <div className="mt-3 text-2xl font-semibold">{value}</div>
    </div>
  );
}