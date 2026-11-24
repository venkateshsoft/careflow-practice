
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  AdjustmentStatus,
  AdjustmentType,
  ChargeStatus,
} from "@prisma/client";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ result?: string }>;
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function dateTime(value: Date | null) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function statusStyle(status: string) {
  switch (status) {
    case "POSTED":
      return "bg-green-100 text-green-800";
    case "DRAFT":
      return "bg-amber-100 text-amber-800";
    case "VOIDED":
      return "bg-gray-100 text-gray-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function resultMessage(result?: string) {
  const messages: Record<string, string> = {
    created: "Adjustment draft created successfully.",
    updated: "Adjustment draft updated successfully.",
    "adjustment-reviewed": "Adjustment reviewed successfully.",
    "adjustment-posted": "Adjustment posted successfully.",
    "adjustment-voided": "Adjustment voided successfully.",
    "not-found": "The requested record could not be found.",
    "not-posted": "Adjustments can only be created for posted charges.",
    "already-processed": "This adjustment has already been processed.",
    "not-reviewed": "Review the adjustment before posting it.",
    "negative-balance": "This credit would make the net charge negative.",
    "invalid-data": "Please check the information and try again.",
  };

  return result ? messages[result] ?? null : null;
}

export default async function ChargeAdjustmentsPage({
  params,
  searchParams,
}: PageProps) {
  const user = await currentUser();

  if (!user || !user.active) {
    redirect("/login");
  }

  if (!["ADMIN", "BILLING"].includes(user.role)) {
    redirect("/");
  }

  const { id } = await params;
  const { result } = await searchParams;

  const charge = await db.charge.findFirst({
    where: {
      id,
      practiceId: user.practiceId,
    },
    include: {
      patient: true,
      encounter: true,
      adjustments: {
        orderBy: {
          createdAt: "desc",
        },
        include: {
          createdBy: {
            select: {
              displayName: true,
            },
          },
          reviewedBy: {
            select: {
              displayName: true,
            },
          },
          postedBy: {
            select: {
              displayName: true,
            },
          },
        },
      },
    },
  });

  if (!charge) {
    notFound();
  }

  const originalAmount = charge.totalAmount.toNumber();

  const postedCredits = charge.adjustments
    .filter(
      (adjustment) =>
        adjustment.status === AdjustmentStatus.POSTED &&
        adjustment.type === AdjustmentType.CREDIT
    )
    .reduce((total, adjustment) => total + adjustment.amount.toNumber(), 0);

  const postedDebits = charge.adjustments
    .filter(
      (adjustment) =>
        adjustment.status === AdjustmentStatus.POSTED &&
        adjustment.type === AdjustmentType.DEBIT
    )
    .reduce((total, adjustment) => total + adjustment.amount.toNumber(), 0);

  const netAmount = originalAmount - postedCredits + postedDebits;

  const canCreateAdjustment = charge.status === ChargeStatus.POSTED;
  const message = resultMessage(result);

  return (
    <main className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={`/billing/${charge.id}`}
            className="text-sm font-medium text-blue-700 hover:underline"
          >
            ← Back to charge details
          </Link>

          <h1 className="mt-3 text-2xl font-semibold text-gray-900">
            Charge Adjustments
          </h1>

          <p className="mt-1 text-sm text-gray-500">
            Review credits and debits associated with this posted charge.
          </p>
        </div>

        {canCreateAdjustment && (
          <Link
            href={`/billing/${charge.id}/adjustments/new`}
            className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800"
          >
            + Create adjustment
          </Link>
        )}
      </div>

      {message && (
        <div
          className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"
          role="status"
        >
          {message}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Original charge</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">
            {money(originalAmount)}
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Posted credits</p>
          <p className="mt-2 text-2xl font-semibold text-red-700">
            −{money(postedCredits)}
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Posted debits</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">
            +{money(postedDebits)}
          </p>
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm text-blue-800">Net charge amount</p>
          <p className="mt-2 text-2xl font-semibold text-blue-900">
            {money(netAmount)}
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">
          Original charge information
        </h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="text-xs text-gray-500">Patient</p>
            <p className="mt-1 font-medium text-gray-900">
              {charge.patient.firstName} {charge.patient.lastName}
            </p>
          </div>

          <div>
            <p className="text-xs text-gray-500">Charge ID</p>
            <p className="mt-1 break-all font-mono text-sm text-gray-800">
              {charge.id}
            </p>
          </div>

          <div>
            <p className="text-xs text-gray-500">Charge status</p>
            <p className="mt-1">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle(charge.status)}`}
              >
                {charge.status}
              </span>
            </p>
          </div>
        </div>

        {charge.status !== ChargeStatus.POSTED && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Adjustments can only be created for posted charges.
          </p>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="font-semibold text-gray-900">
            Adjustment history
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {charge.adjustments.length} adjustment
            {charge.adjustments.length === 1 ? "" : "s"} recorded
          </p>
        </div>

        {charge.adjustments.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="font-medium text-gray-800">
              No adjustments recorded
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Create a credit or debit adjustment when a correction is needed.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Reason</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Created</th>
                  <th className="px-5 py-3">Created by</th>
                  <th className="px-5 py-3">Reviewed / Posted</th>
                  <th className="px-5 py-3">Action</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {charge.adjustments.map((adjustment) => (
                  <tr key={adjustment.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-5 py-4">
                      <span
                        className={
                          adjustment.type === AdjustmentType.CREDIT
                            ? "font-medium text-red-700"
                            : "font-medium text-blue-700"
                        }
                      >
                        {adjustment.type}
                      </span>
                    </td>

                    <td className="max-w-xs px-5 py-4">
                      <p className="font-medium text-gray-900">
                        {adjustment.reason}
                      </p>
                      {adjustment.notes && (
                        <p className="mt-1 whitespace-pre-wrap text-xs text-gray-500">
                          {adjustment.notes}
                        </p>
                      )}
                    </td>

                    <td className="whitespace-nowrap px-5 py-4 text-right font-semibold text-gray-900">
                      {money(adjustment.amount.toNumber())}
                    </td>

                    <td className="whitespace-nowrap px-5 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle(adjustment.status)}`}
                      >
                        {adjustment.status}
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-5 py-4 text-gray-600">
                      {dateTime(adjustment.createdAt)}
                    </td>

                    <td className="whitespace-nowrap px-5 py-4 text-gray-600">
                      {adjustment.createdBy.displayName}
                    </td>

                    <td className="min-w-44 px-5 py-4 text-xs text-gray-600">
                      {adjustment.reviewedBy && (
                        <p>
                          Reviewed by {adjustment.reviewedBy.displayName}
                        </p>
                      )}
                      {adjustment.postedBy && (
                        <p className="mt-1">
                          Posted by {adjustment.postedBy.displayName}
                        </p>
                      )}
                      {!adjustment.reviewedBy && !adjustment.postedBy && "—"}
                    </td>

                    <td className="whitespace-nowrap px-5 py-4">
                      <Link
                        href={`/billing/adjustments/${adjustment.id}`}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        View details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        <strong className="text-gray-800">Accounting rule:</strong> The
        original posted charge is never modified. Only posted adjustments
        affect the net charge amount. Draft and voided adjustments are
        excluded from the calculation.
      </div>
    </main>
  );
}