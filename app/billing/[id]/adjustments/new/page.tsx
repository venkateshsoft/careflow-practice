
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChargeStatus } from "@prisma/client";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { createChargeAdjustment } from "@/lib/adjustment-actions";

type PageProps = {
  params: Promise<{ id: string }>;
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export default async function NewChargeAdjustmentPage({
  params,
}: PageProps) {
  const user = await currentUser();

  if (!user || !user.active) {
    redirect("/login");
  }

  if (!["ADMIN", "BILLING"].includes(user.role)) {
    redirect("/");
  }

  const { id } = await params;

  const charge = await db.charge.findFirst({
    where: {
      id,
      practiceId: user.practiceId,
    },
    include: {
      patient: true,
    },
  });

  if (!charge) {
    notFound();
  }

  if (charge.status !== ChargeStatus.POSTED) {
    return (
      <main className="mx-auto max-w-3xl space-y-5">
        <Link
          href={`/billing/${charge.id}/adjustments`}
          className="text-sm font-medium text-blue-700 hover:underline"
        >
          ← Back to adjustments
        </Link>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
          <h1 className="text-xl font-semibold text-amber-900">
            Adjustment unavailable
          </h1>
          <p className="mt-2 text-sm text-amber-800">
            Adjustments can only be created for posted charges. This charge is
            currently {charge.status}.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href={`/billing/${charge.id}/adjustments`}
          className="text-sm font-medium text-blue-700 hover:underline"
        >
          ← Back to adjustment ledger
        </Link>

        <h1 className="mt-3 text-2xl font-semibold text-gray-900">
          Create Charge Adjustment
        </h1>

        <p className="mt-1 text-sm text-gray-500">
          Record a credit or debit correction against an existing posted charge.
        </p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-semibold text-gray-900">
          Original charge
        </h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-gray-500">Patient</p>
            <p className="mt-1 font-medium text-gray-900">
              {charge.patient.firstName} {charge.patient.lastName}
            </p>
          </div>

          <div>
            <p className="text-xs text-gray-500">Original charge amount</p>
            <p className="mt-1 font-semibold text-gray-900">
              {money(charge.totalAmount.toNumber())}
            </p>
          </div>

          <div>
            <p className="text-xs text-gray-500">Charge status</p>
            <p className="mt-1 font-medium text-green-700">
              {charge.status}
            </p>
          </div>

          <div>
            <p className="text-xs text-gray-500">Charge reference</p>
            <p className="mt-1 break-all font-mono text-xs text-gray-700">
              {charge.id}
            </p>
          </div>
        </div>
      </section>

      <form
        action={createChargeAdjustment}
        className="space-y-5 rounded-xl border border-gray-200 bg-white p-5"
      >
        <input type="hidden" name="chargeId" value={charge.id} />

        <div>
          <label
            htmlFor="type"
            className="mb-2 block text-sm font-medium text-gray-800"
          >
            Adjustment type <span className="text-red-600">*</span>
          </label>

          <select
            id="type"
            name="type"
            required
            defaultValue="CREDIT"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          >
            <option value="CREDIT">
              Credit — reduce the original charge
            </option>
            <option value="DEBIT">
              Debit — increase the original charge
            </option>
          </select>

          <p className="mt-1 text-xs text-gray-500">
            A credit reduces the net charge. A debit increases it.
          </p>
        </div>

        <div>
          <label
            htmlFor="amount"
            className="mb-2 block text-sm font-medium text-gray-800"
          >
            Adjustment amount (USD){" "}
            <span className="text-red-600">*</span>
          </label>

          <input
            id="amount"
            name="amount"
            type="number"
            min="0.01"
            max="999999.99"
            step="0.01"
            required
            placeholder="For example, 20.00"
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          />

          <p className="mt-1 text-xs text-gray-500">
            Enter a positive amount with up to two decimal places.
          </p>
        </div>

        <div>
          <label
            htmlFor="reason"
            className="mb-2 block text-sm font-medium text-gray-800"
          >
            Reason for adjustment{" "}
            <span className="text-red-600">*</span>
          </label>

          <input
            id="reason"
            name="reason"
            type="text"
            required
            minLength={5}
            maxLength={1000}
            placeholder="For example, billing correction"
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div>
          <label
            htmlFor="notes"
            className="mb-2 block text-sm font-medium text-gray-800"
          >
            Additional notes
          </label>

          <textarea
            id="notes"
            name="notes"
            rows={4}
            maxLength={5000}
            placeholder="Provide supporting details for the adjustment..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <p className="font-semibold">Adjustment workflow</p>
          <ol className="mt-2 list-inside list-decimal space-y-1">
            <li>Create the adjustment as a draft.</li>
            <li>Review the adjustment.</li>
            <li>Post the reviewed adjustment.</li>
          </ol>
          <p className="mt-2">
            The original posted charge will not be modified. Only posted
            adjustments affect the net charge amount.
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-gray-100 pt-4">
          <Link
            href={`/billing/${charge.id}/adjustments`}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </Link>

          <button
            type="submit"
            className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-800"
          >
            Create draft adjustment
          </button>
        </div>
      </form>
    </main>
  );
}