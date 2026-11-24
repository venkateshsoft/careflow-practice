
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  AdjustmentStatus,
  AdjustmentType,
} from "@prisma/client";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  postChargeAdjustment,
  reviewChargeAdjustment,
  updateDraftChargeAdjustment,
  voidChargeAdjustment,
} from "@/lib/adjustment-actions";

type PageProps = {
  params: Promise<{ adjustmentId: string }>;
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
    updated: "Adjustment draft updated successfully. Any previous review was cleared.",
    "not-found": "The requested adjustment could not be found.",
    "not-posted": "The original charge must be posted before this action.",
    "already-processed": "This adjustment has already been processed.",
    "not-reviewed": "Review this adjustment before posting it.",
    "negative-balance": "This credit would make the net charge negative.",
    "invalid-data": "Please check the submitted information and try again.",
  };

  return result ? messages[result] ?? null : null;
}

export default async function ChargeAdjustmentDetailPage({
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

  const { adjustmentId } = await params;
  const { result } = await searchParams;

  const adjustment = await db.chargeAdjustment.findFirst({
    where: {
      id: adjustmentId,
      practiceId: user.practiceId,
    },
    include: {
      charge: {
        include: {
          patient: true,
        },
      },
      patient: true,
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
  });

  if (!adjustment) {
    notFound();
  }

  const auditEvents = await db.auditEvent.findMany({
    where: {
      entityType: "ChargeAdjustment",
      entityId: adjustment.id,
      practiceId: user.practiceId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const isDraft = adjustment.status === AdjustmentStatus.DRAFT;
  const isPosted = adjustment.status === AdjustmentStatus.POSTED;
  const isVoided = adjustment.status === AdjustmentStatus.VOIDED;
  const isCredit = adjustment.type === AdjustmentType.CREDIT;

  const message = resultMessage(result);

  return (
    <main className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href={`/billing/${adjustment.chargeId}/adjustments`}
          className="text-sm font-medium text-blue-700 hover:underline"
        >
          ← Back to adjustment ledger
        </Link>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              Adjustment Details
            </h1>
            <p className="mt-1 break-all font-mono text-xs text-gray-500">
              {adjustment.id}
            </p>
          </div>

          <span
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${statusStyle(adjustment.status)}`}
          >
            {adjustment.status}
          </span>
        </div>
      </div>

      {message && (
        <div
          className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"
          role="status"
        >
          {message}
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-semibold text-gray-900">
          Adjustment summary
        </h2>

        <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="text-xs text-gray-500">Adjustment type</p>
            <p
              className={`mt-1 font-semibold ${isCredit ? "text-red-700" : "text-blue-700"}`}
            >
              {adjustment.type}
            </p>
          </div>

          <div>
            <p className="text-xs text-gray-500">Adjustment amount</p>
            <p className="mt-1 text-xl font-semibold text-gray-900">
              {money(adjustment.amount.toNumber())}
            </p>
          </div>

          <div>
            <p className="text-xs text-gray-500">Effect on net charge</p>
            <p className="mt-1 font-semibold text-gray-900">
              {isCredit ? "Reduces charge" : "Increases charge"}
            </p>
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <p className="text-xs text-gray-500">Reason</p>
            <p className="mt-1 text-sm font-medium text-gray-900">
              {adjustment.reason}
            </p>
          </div>

          {adjustment.notes && (
            <div className="sm:col-span-2 lg:col-span-3">
              <p className="text-xs text-gray-500">Notes</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
                {adjustment.notes}
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-semibold text-gray-900">
          Original charge and patient
        </h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-gray-500">Patient</p>
            <p className="mt-1 font-medium text-gray-900">
              {adjustment.patient.firstName} {adjustment.patient.lastName}
            </p>
          </div>

          <div>
            <p className="text-xs text-gray-500">Original charge amount</p>
            <p className="mt-1 font-medium text-gray-900">
              {money(adjustment.charge.totalAmount.toNumber())}
            </p>
          </div>

          <div>
            <p className="text-xs text-gray-500">Original charge status</p>
            <p className="mt-1 font-medium text-gray-900">
              {adjustment.charge.status}
            </p>
          </div>

          <div>
            <p className="text-xs text-gray-500">Original charge reference</p>
            <Link
              href={`/billing/${adjustment.chargeId}`}
              className="mt-1 inline-block break-all text-sm font-medium text-blue-700 hover:underline"
            >
              {adjustment.chargeId}
            </Link>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-semibold text-gray-900">
          Workflow history
        </h2>

        <div className="mt-4 space-y-4">
          <div className="flex justify-between gap-4 border-b border-gray-100 pb-3">
            <div>
              <p className="text-sm font-medium text-gray-800">
                Created
              </p>
              <p className="mt-1 text-xs text-gray-500">
                By {adjustment.createdBy.displayName}
              </p>
            </div>
            <p className="text-right text-xs text-gray-500">
              {dateTime(adjustment.createdAt)}
            </p>
          </div>

          <div className="flex justify-between gap-4 border-b border-gray-100 pb-3">
            <div>
              <p className="text-sm font-medium text-gray-800">
                Reviewed
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {adjustment.reviewedBy
                  ? `By ${adjustment.reviewedBy.displayName}`
                  : "Not yet reviewed"}
              </p>
            </div>
            <p className="text-right text-xs text-gray-500">
              {dateTime(adjustment.reviewedAt)}
            </p>
          </div>

          <div className="flex justify-between gap-4 border-b border-gray-100 pb-3">
            <div>
              <p className="text-sm font-medium text-gray-800">
                Posted
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {adjustment.postedBy
                  ? `By ${adjustment.postedBy.displayName}`
                  : "Not yet posted"}
              </p>
            </div>
            <p className="text-right text-xs text-gray-500">
              {dateTime(adjustment.postedAt)}
            </p>
          </div>

          {isVoided && (
            <div className="flex justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-800">
                  Voided
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  See the audit event below for the void reason and actor.
                </p>
              </div>
              <p className="text-right text-xs text-gray-500">
                {dateTime(adjustment.voidedAt)}
              </p>
            </div>
          )}
        </div>
      </section>

      {isDraft && (
        <>
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="font-semibold text-gray-900">
              Edit draft adjustment
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              Editing a draft clears its previous review. It must be reviewed
              again before posting.
            </p>

            <form
              action={updateDraftChargeAdjustment}
              className="mt-5 space-y-4"
            >
              <input
                type="hidden"
                name="adjustmentId"
                value={adjustment.id}
              />

              <div>
                <label
                  htmlFor="amount"
                  className="mb-2 block text-sm font-medium text-gray-800"
                >
                  Adjustment amount (USD)
                </label>
                <input
                  id="amount"
                  name="amount"
                  type="number"
                  min="0.01"
                  max="999999.99"
                  step="0.01"
                  required
                  defaultValue={adjustment.amount.toString()}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div>
                <label
                  htmlFor="reason"
                  className="mb-2 block text-sm font-medium text-gray-800"
                >
                  Reason
                </label>
                <input
                  id="reason"
                  name="reason"
                  type="text"
                  minLength={5}
                  maxLength={1000}
                  required
                  defaultValue={adjustment.reason}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
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
                  defaultValue={adjustment.notes ?? ""}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <button
                type="submit"
                className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-800"
              >
                Save draft changes
              </button>
            </form>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="font-semibold text-gray-900">
                Review adjustment
              </h2>
              <p className="mt-2 text-sm text-gray-500">
                Confirm the adjustment details before allowing it to be posted.
              </p>

              <form action={reviewChargeAdjustment} className="mt-4">
                <input
                  type="hidden"
                  name="adjustmentId"
                  value={adjustment.id}
                />
                <button
                  type="submit"
                  className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800"
                >
                  Mark as reviewed
                </button>
              </form>
            </div>

            <div className="rounded-xl border border-red-200 bg-white p-5">
              <h2 className="font-semibold text-gray-900">
                Void draft adjustment
              </h2>
              <p className="mt-2 text-sm text-gray-500">
                Voiding is permanent for this draft. A voided adjustment cannot
                be posted.
              </p>

              <form action={voidChargeAdjustment} className="mt-4 space-y-3">
                <input
                  type="hidden"
                  name="adjustmentId"
                  value={adjustment.id}
                />
                <label
                  htmlFor="voidReason"
                  className="block text-sm font-medium text-gray-800"
                >
                  Void reason
                </label>
                <textarea
                  id="voidReason"
                  name="reason"
                  rows={2}
                  minLength={5}
                  maxLength={1000}
                  required
                  placeholder="Explain why this draft is being voided"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                />
                <button
                  type="submit"
                  className="w-full rounded-lg border border-red-300 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50"
                >
                  Void draft adjustment
                </button>
              </form>
            </div>
          </section>
        </>
      )}

      {isDraft && adjustment.reviewedAt && (
        <section className="rounded-xl border border-green-200 bg-green-50 p-5">
          <h2 className="font-semibold text-green-900">
            Ready to post
          </h2>
          <p className="mt-1 text-sm text-green-800">
            This adjustment has been reviewed. Posting will make it part of
            the net charge calculation.
          </p>

          <form action={postChargeAdjustment} className="mt-4">
            <input
              type="hidden"
              name="adjustmentId"
              value={adjustment.id}
            />
            <button
              type="submit"
              className="rounded-lg bg-green-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-green-800"
            >
              Post adjustment
            </button>
          </form>
        </section>
      )}

      {isPosted && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          This adjustment is posted and immutable. It contributes to the net
          charge amount. Corrections should be recorded through a separate
          adjustment.
        </div>
      )}

      {isVoided && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          This adjustment is voided. It does not affect the net charge amount.
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-semibold text-gray-900">
          Audit trail
        </h2>

        {auditEvents.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            No audit events are available for this adjustment.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {auditEvents.map((event) => (
              <div
                key={event.id}
                className="border-l-2 border-blue-300 pl-4"
              >
                <p className="text-sm font-semibold text-gray-900">
                  {event.action.replaceAll("_", " ")}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {dateTime(event.createdAt)}
                </p>
                {event.metadata !== null && (
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                    {JSON.stringify(event.metadata, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}