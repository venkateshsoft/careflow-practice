
import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  updateDraftCharge,
  reviewCharge,
  postCharge,
  voidCharge,
} from "@/lib/charge-actions";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const money = (value: unknown) => `$${Number(value).toFixed(2)}`;

export default async function ChargeDetailPage({
  params,
  searchParams,
}: PageProps) {
  const user = await currentUser();

  if (!user || !user.active) redirect("/login");

  const allowedRoles = ["ADMIN", "BILLING", "PROVIDER"];

  if (!allowedRoles.includes(user.role)) {
    redirect("/?error=unauthorized");
  }

  const { id } = await params;
  const query = await searchParams;
  const canManage = ["ADMIN", "BILLING"].includes(user.role);

  const charge = await db.charge.findFirst({
    where: {
      id,
      practiceId: user.practiceId,
      ...(user.role === "PROVIDER"
        ? { provider: { displayName: user.displayName } }
        : {}),
    },
    include: {
      patient: true,
      provider: true,
      createdBy: true,
      reviewedBy: true,
      postedBy: true,
      voidedBy: true,
      encounter: {
        include: {
          appointment: true,
        },
      },
      lines: {
        include: {
          procedureCode: true,
        },
        orderBy: { sequence: "asc" },
      },
      adjustments: {
        orderBy: { createdAt: "desc" },
        include: {
          createdBy: {
            select: { displayName: true },
          },
          reviewedBy: {
            select: { displayName: true },
          },
          postedBy: {
            select: { displayName: true },
          },
        },
      },
    },
  });

  if (!charge) redirect("/billing?error=notfound");

  const auditEvents = await db.auditEvent.findMany({
    where: {
      practiceId: user.practiceId,
      entityType: "Charge",
      entityId: charge.id,
    },
    include: { actor: true },
    orderBy: { createdAt: "desc" },
  });

  const isDraft = charge.status === "DRAFT";
  const isReviewed = Boolean(charge.reviewedAt && charge.reviewedById);

  const postedCredits = charge.adjustments
    .filter(
      (adjustment) =>
        adjustment.status === "POSTED" && adjustment.type === "CREDIT"
    )
    .reduce(
      (total, adjustment) => total + adjustment.amount.toNumber(),
      0
    );

  const postedDebits = charge.adjustments
    .filter(
      (adjustment) =>
        adjustment.status === "POSTED" && adjustment.type === "DEBIT"
    )
    .reduce(
      (total, adjustment) => total + adjustment.amount.toNumber(),
      0
    );

  const netChargeAmount =
    charge.totalAmount.toNumber() - postedCredits + postedDebits;

  const messages: Record<string, string> = {
    updated: "Draft charge updated. It must be reviewed again before posting.",
    reviewed: "Charge review recorded successfully.",
    posted: "Charge posted successfully.",
    voided: "Draft charge voided successfully.",
    locked: "This charge is no longer editable.",
    "review-required": "Review this charge before posting.",
    "invalid-line": "The selected charge line could not be found.",
    "empty-charge": "A charge must contain at least one line before posting.",
  };

  const messageKey = Object.keys(messages).find(
    (key) => query[key] === "1"
  );

  return (
    <AppShell user={user} active="Billing">
      <div className="mb-6">
        <Link
          href="/billing"
          className="text-sm font-semibold text-teal hover:underline"
        >
          ← Back to Billing
        </Link>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold tracking-wider text-teal">
              REVENUE CYCLE MANAGEMENT
            </div>
            <h1 className="mt-2 text-3xl font-semibold">
              Charge Review
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Charge ID: {charge.id}
            </p>
          </div>

          <Status status={charge.status} />
        </div>
      </div>

      {messageKey && (
        <div className="mb-5 rounded-lg border border-teal/30 bg-teal/5 p-4 text-sm text-slate-700">
          {messages[messageKey]}
        </div>
      )}

      {query.error === "invalid" && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          The submitted information is invalid.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="text-lg font-semibold">Patient information</h2>
          <div className="mt-4 space-y-3 text-sm">
            <Detail label="Patient">
              {charge.patient.firstName} {charge.patient.lastName}
            </Detail>
            <Detail label="MRN">{charge.patient.mrn}</Detail>
            <Detail label="Provider">{charge.provider.displayName}</Detail>
            <Detail label="Visit type">
              {charge.encounter.appointment.visitType}
            </Detail>
            <Detail label="Encounter status">
              {charge.encounter.status}
            </Detail>
            <Detail label="Encounter signed">
              {charge.encounter.signedAt?.toLocaleString("en-US") ?? "—"}
            </Detail>
          </div>
        </section>

        <section className="card p-6">
          <h2 className="text-lg font-semibold">Charge summary</h2>
          <div className="mt-4 space-y-3 text-sm">
            <Detail label="Currency">{charge.currency}</Detail>
            <Detail label="Subtotal">{money(charge.subtotal)}</Detail>
            <Detail label="Original total amount">
              <span className="text-xl font-bold">
                {money(charge.totalAmount)}
              </span>
            </Detail>
            <Detail label="Created">
              {charge.generatedAt.toLocaleString("en-US")}
            </Detail>
            <Detail label="Created by">
              {charge.createdBy.displayName}
            </Detail>
            <Detail label="Last reviewed">
              {charge.reviewedAt
                ? `${charge.reviewedAt.toLocaleString("en-US")} by ${charge.reviewedBy?.displayName ?? "Unknown"}`
                : "Not reviewed"}
            </Detail>
            <Detail label="Posted">
              {charge.postedAt
                ? `${charge.postedAt.toLocaleString("en-US")} by ${charge.postedBy?.displayName ?? "Unknown"}`
                : "Not posted"}
            </Detail>
            {charge.voidedAt && (
              <Detail label="Voided">
                {charge.voidedAt.toLocaleString("en-US")} by{" "}
                {charge.voidedBy?.displayName ?? "Unknown"}
              </Detail>
            )}
          </div>
        </section>
      </div>

      {/* Charge adjustment summary */}
      <section className="card mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-6">
          <div>
            <h2 className="text-lg font-semibold">Charge adjustments</h2>
            <p className="mt-1 text-sm text-slate-500">
              Credits and debits associated with this original charge.
            </p>
          </div>

          {canManage && charge.status === "POSTED" && (
            <Link
              href={`/billing/${charge.id}/adjustments`}
              className="rounded-lg border border-teal px-4 py-2 text-sm font-semibold text-teal hover:bg-teal/5"
            >
              Manage adjustments
            </Link>
          )}
        </div>

        <div className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryMetric
            label="Original charge"
            value={money(charge.totalAmount)}
          />
          <SummaryMetric
            label="Posted credits"
            value={`−${money(postedCredits)}`}
            valueClass="text-red-700"
          />
          <SummaryMetric
            label="Posted debits"
            value={`+${money(postedDebits)}`}
          />
          <SummaryMetric
            label="Net charge amount"
            value={money(netChargeAmount)}
            valueClass="text-teal"
            highlighted
          />
        </div>

        {charge.adjustments.length === 0 ? (
          <div className="border-t border-slate-100 px-6 py-5 text-sm text-slate-500">
            No adjustments have been recorded for this charge.
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Reason</th>
                  <th className="px-6 py-3 text-right">Amount</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Created by</th>
                  <th className="px-6 py-3">Reviewed / Posted</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {charge.adjustments.map((adjustment) => (
                  <tr key={adjustment.id}>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span
                        className={
                          adjustment.type === "CREDIT"
                            ? "font-semibold text-red-700"
                            : "font-semibold text-blue-700"
                        }
                      >
                        {adjustment.type}
                      </span>
                    </td>

                    <td className="px-6 py-4">
                      <p className="font-medium text-slate-800">
                        {adjustment.reason}
                      </p>
                      {adjustment.notes && (
                        <p className="mt-1 max-w-xs whitespace-pre-wrap text-xs text-slate-500">
                          {adjustment.notes}
                        </p>
                      )}
                    </td>

                    <td className="whitespace-nowrap px-6 py-4 text-right font-semibold">
                      {money(adjustment.amount)}
                    </td>

                    <td className="whitespace-nowrap px-6 py-4">
                      <Status status={adjustment.status} />
                    </td>

                    <td className="whitespace-nowrap px-6 py-4 text-slate-600">
                      {adjustment.createdBy.displayName}
                    </td>

                    <td className="min-w-48 px-6 py-4 text-xs text-slate-600">
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-slate-100 bg-slate-50 px-6 py-3 text-xs text-slate-500">
          Only posted adjustments affect the net charge. Draft and voided
          adjustments are excluded. The original posted charge is never
          modified.
        </div>
      </section>

      <section className="card mt-6 overflow-hidden">
        <div className="border-b border-slate-100 p-6">
          <h2 className="text-lg font-semibold">Charge line items</h2>
          <p className="mt-1 text-sm text-slate-500">
            Procedure codes and fee snapshots associated with this encounter.
          </p>
        </div>

        {charge.lines.map((line) => (
          <div
            key={line.id}
            className="border-b border-slate-100 p-6 last:border-0"
          >
            {canManage && isDraft ? (
              <form action={updateDraftCharge} className="space-y-4">
                <input type="hidden" name="chargeId" value={charge.id} />
                <input type="hidden" name="lineId" value={line.id} />

                <div className="grid gap-4 sm:grid-cols-2">
                  <Detail label="Procedure code">
                    {line.codeSnapshot}
                  </Detail>
                  <Detail label="Description">
                    {line.descriptionSnapshot}
                  </Detail>

                  <label className="block text-sm">
                    <span className="mb-1 block font-semibold">Units</span>
                    <input
                      name="units"
                      type="number"
                      min="1"
                      max="100"
                      required
                      defaultValue={line.units}
                      className="w-full rounded-lg border border-slate-300 p-2"
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="mb-1 block font-semibold">
                      Unit price (USD)
                    </span>
                    <input
                      name="unitPrice"
                      type="number"
                      min="0"
                      max="999999"
                      step="0.01"
                      required
                      defaultValue={Number(line.unitPrice).toFixed(2)}
                      className="w-full rounded-lg border border-slate-300 p-2"
                    />
                  </label>
                </div>

                <label className="block text-sm">
                  <span className="mb-1 block font-semibold">
                    Billing notes
                  </span>
                  <textarea
                    name="notes"
                    rows={2}
                    maxLength={2000}
                    defaultValue={charge.notes ?? ""}
                    className="w-full rounded-lg border border-slate-300 p-3"
                    placeholder="Optional billing notes"
                  />
                </label>

                <button className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white">
                  Save draft changes
                </button>
              </form>
            ) : (
              <div className="grid gap-4 sm:grid-cols-5">
                <Detail label="Procedure">{line.codeSnapshot}</Detail>
                <div className="sm:col-span-2">
                  <Detail label="Description">
                    {line.descriptionSnapshot}
                  </Detail>
                </div>
                <Detail label="Units">{line.units}</Detail>
                <Detail label="Unit price">
                  {money(line.unitPrice)}
                </Detail>
                <Detail label="Line total">
                  {money(line.lineTotal)}
                </Detail>
              </div>
            )}
          </div>
        ))}
      </section>

      {charge.notes && (
        <section className="card mt-6 p-6">
          <h2 className="font-semibold">Charge notes</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
            {charge.notes}
          </p>
        </section>
      )}

      {canManage && isDraft && (
        <section className="card mt-6 p-6">
          <h2 className="text-lg font-semibold">Review and posting actions</h2>
          <p className="mt-1 text-sm text-slate-500">
            Review the charge before posting. Any subsequent edit resets the review.
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <form action={reviewCharge}>
              <input type="hidden" name="chargeId" value={charge.id} />
              <button className="rounded-lg border border-teal px-5 py-2.5 text-sm font-semibold text-teal">
                {isReviewed ? "Review again" : "Mark as reviewed"}
              </button>
            </form>

            <form action={postCharge}>
              <input type="hidden" name="chargeId" value={charge.id} />
              <button
                disabled={!isReviewed}
                className="rounded-lg bg-teal px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Post charge
              </button>
            </form>
          </div>

          {!isReviewed && (
            <p className="mt-3 text-xs text-amber-700">
              Posting is disabled until the charge has been reviewed.
            </p>
          )}

          <div className="mt-7 border-t border-slate-100 pt-6">
            <h3 className="font-semibold text-red-700">Void draft charge</h3>
            <p className="mt-1 text-sm text-slate-500">
              Voiding is permanent in this demo workflow. A reason is required.
            </p>

            <form action={voidCharge} className="mt-4 space-y-3">
              <input type="hidden" name="chargeId" value={charge.id} />
              <textarea
                name="reason"
                required
                minLength={5}
                maxLength={1000}
                rows={3}
                placeholder="Enter the reason for voiding this charge"
                className="w-full rounded-lg border border-slate-300 p-3 text-sm"
              />
              <button className="rounded-lg border border-red-300 px-5 py-2.5 text-sm font-semibold text-red-700">
                Void draft charge
              </button>
            </form>
          </div>
        </section>
      )}

      {!isDraft && (
        <section className="card mt-6 p-6">
          <h2 className="font-semibold">Charge is locked</h2>
          <p className="mt-2 text-sm text-slate-500">
            {charge.status === "POSTED"
              ? "This charge has been posted and cannot be edited or voided. Corrections require a separate adjustment workflow."
              : "This charge has been voided and cannot be edited or posted."}
          </p>
        </section>
      )}

      <section className="card mt-6 p-6">
        <h2 className="text-lg font-semibold">Charge audit history</h2>
        {auditEvents.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No audit events found.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {auditEvents.map((event) => (
              <div key={event.id} className="border-l-2 border-teal/40 pl-4">
                <div className="text-sm font-semibold">
                  {event.action.replaceAll("_", " ")}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {event.actor?.displayName ?? "System"} ·{" "}
                  {event.createdAt.toLocaleString("en-US")}
                </div>
                {event.metadata && (
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-slate-500">
                    {JSON.stringify(event.metadata, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="mt-5 text-xs text-slate-400">
        DEMO ENVIRONMENT · Synthetic data only · USD · No live claims or financial transactions.
      </p>
    </AppShell>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 font-medium text-slate-800">{children}</div>
    </div>
  );
}

function Status({ status }: { status: string }) {
  const styles: Record<string, string> = {
    DRAFT: "bg-amber-100 text-amber-800",
    POSTED: "bg-emerald-100 text-emerald-800",
    VOIDED: "bg-slate-100 text-slate-600",
  };

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
        styles[status] ?? "bg-slate-100 text-slate-600"
      }`}
    >
      {status}
    </span>
  );
}

function SummaryMetric({
  label,
  value,
  valueClass = "",
  highlighted = false,
}: {
  label: string;
  value: string;
  valueClass?: string;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        highlighted
          ? "border-teal/30 bg-teal/5"
          : "border-slate-200 bg-white"
      }`}
    >
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-2 text-xl font-bold ${valueClass || "text-slate-900"}`}>
        {value}
      </p>
    </div>
  );
}