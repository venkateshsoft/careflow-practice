import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ paymentId: string }>;
};

function money(value: { toNumber(): number } | null | undefined) {
  if (value == null) return "—";
  const amount = value.toNumber();
  return `${amount < 0 ? "-" : ""}$${Math.abs(amount).toFixed(2)}`;
}

function dateTime(value: Date | null | undefined) {
  return value
    ? value.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-2 break-words text-sm font-semibold text-slate-900">
        {value ?? "—"}
      </div>
    </div>
  );
}

function Status({ value }: { value: string }) {
  const styles: Record<string, string> = {
    DRAFT: "bg-amber-100 text-amber-800",
    POSTED: "bg-emerald-100 text-emerald-800",
    VOIDED: "bg-slate-100 text-slate-700",
  };

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
        styles[value] ?? "bg-slate-100 text-slate-700"
      }`}
    >
      {value}
    </span>
  );
}

export default async function PaymentDetailPage({ params }: PageProps) {
  const user = await currentUser();

  if (!user || !user.active) redirect("/login");

  if (!["ADMIN", "BILLING"].includes(user.role)) {
    redirect("/?error=unauthorized");
  }

  const { paymentId } = await params;

  const payment = await db.payment.findFirst({
    where: {
      id: paymentId,
      practiceId: user.practiceId,
    },
    include: {
      patient: true,
      createdBy: true,
      reviewedBy: true,
      postedBy: true,
      reversalOfPayment: true,
      reversalPayment: true,
      eraPostingClaim: {
        include: {
          eraClaim: true,
          batch: {
            include: {
              eraImport: true,
              reversal: {
                include: {
                  reversedBy: true,
                },
              },
            },
          },
        },
      },
      eraPostingReversal: {
        include: {
          reversedBy: true,
          batch: {
            include: {
              eraImport: true,
            },
          },
        },
      },
      allocations: {
        orderBy: { createdAt: "asc" },
        include: {
          charge: {
            include: {
              patient: true,
              encounter: {
                include: {
                  appointment: true,
                },
              },
            },
          },
          eraPostingItem: {
            include: {
              postingClaim: {
                include: {
                  batch: true,
                },
              },
            },
          },
          reversalOfAllocation: true,
          reversalAllocation: true,
          eraPostingReversal: true,
        },
      },
    },
  });

  if (!payment) notFound();

  const relatedIds = [
    payment.id,
    payment.reversalOfPaymentId,
    payment.reversalPayment?.id,
    payment.eraPostingReversalId,
    payment.eraPostingClaim?.batchId,
    payment.eraPostingReversal?.batchId,
    ...payment.allocations.flatMap((allocation) => [
      allocation.id,
      allocation.reversalOfAllocationId,
      allocation.reversalAllocation?.id,
      allocation.eraPostingReversalId,
      allocation.chargeId,
    ]),
  ].filter((value): value is string => Boolean(value));

  const auditEvents = await db.auditEvent.findMany({
    where: {
      practiceId: user.practiceId,
      entityId: { in: Array.from(new Set(relatedIds)) },
    },
    include: {
      actor: {
        select: { displayName: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const allocatedAmount = payment.allocations.reduce(
    (total, allocation) => total + allocation.amount.toNumber(),
    0
  );
  const unappliedAmount = payment.amount.toNumber() - allocatedAmount;
  const isReversal = Boolean(payment.reversalOfPaymentId);
  const batch = payment.eraPostingClaim?.batch;
  const reversalBatch = payment.eraPostingReversal?.batch;

  return (
    <AppShell user={user} active="Billing">
      <div className="mb-8">
        <Link
          href="/billing"
          className="text-sm font-semibold text-teal hover:underline"
        >
          ← Back to Billing
        </Link>
        <div className="mt-6 text-xs font-bold tracking-wider text-teal">
          REVENUE CYCLE MANAGEMENT
        </div>
        <h1 className="mt-2 text-3xl font-semibold">Payment Details</h1>
        <p className="mt-2 break-all text-sm text-slate-500">
          Payment ID: {payment.id}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Status value={payment.status} />
          {isReversal && (
            <span className="inline-flex rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-800">
              REVERSAL PAYMENT
            </span>
          )}
        </div>
      </div>

      <section className="card p-6">
        <h2 className="text-lg font-semibold">Patient information</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Patient"
            value={`${payment.patient.firstName} ${payment.patient.lastName}`}
          />
          <Field label="MRN" value={payment.patient.mrn} />
          <Field label="Patient status" value={payment.patient.status} />
        </div>
      </section>

      <section className="card mt-6 p-6">
        <h2 className="text-lg font-semibold">Payment summary</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Payment source" value={payment.source} />
          <Field label="Payment method" value={payment.method} />
          <Field label="Currency" value={payment.currency} />
          <Field label="Reference number" value={payment.referenceNumber || "—"} />
          <Field label="Payment amount" value={money(payment.amount)} />
          <Field label="Received" value={dateTime(payment.receivedAt)} />
          <Field label="Allocated amount" value={money({ toNumber: () => allocatedAmount })} />
          <Field label="Unapplied amount" value={money({ toNumber: () => unappliedAmount })} />
          <Field label="Created" value={dateTime(payment.createdAt)} />
          <Field label="Created by" value={payment.createdBy.displayName} />
          <Field label="Reviewed" value={dateTime(payment.reviewedAt)} />
          <Field label="Reviewed by" value={payment.reviewedBy?.displayName || "—"} />
          <Field label="Posted" value={dateTime(payment.postedAt)} />
          <Field label="Posted by" value={payment.postedBy?.displayName || "—"} />
          <Field label="Voided" value={dateTime(payment.voidedAt)} />
        </div>
        {payment.notes && (
          <div className="mt-4 rounded-lg border border-slate-200 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Payment notes
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm">{payment.notes}</p>
          </div>
        )}
      </section>

      {(payment.reversalOfPayment || payment.reversalPayment) && (
        <section className="card mt-6 p-6">
          <h2 className="text-lg font-semibold">Payment reversal relationship</h2>
          <div className="mt-4 space-y-3 text-sm">
            {payment.reversalOfPayment && (
              <p>
                This payment reverses the original payment: {" "}
                <Link
                  href={`/billing/payments/${payment.reversalOfPayment.id}`}
                  className="font-semibold text-teal hover:underline"
                >
                  {payment.reversalOfPayment.id}
                </Link>
              </p>
            )}
            {payment.reversalPayment && (
              <p>
                Reversed by payment: {" "}
                <Link
                  href={`/billing/payments/${payment.reversalPayment.id}`}
                  className="font-semibold text-teal hover:underline"
                >
                  {payment.reversalPayment.id}
                </Link>
              </p>
            )}
          </div>
        </section>
      )}

      {payment.eraPostingClaim && (
        <section className="card mt-6 p-6">
          <h2 className="text-lg font-semibold">ERA posting information</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="ERA posting batch" value={batch?.id || "—"} />
            <Field label="Batch status" value={batch?.status || "—"} />
            <Field label="ERA import" value={batch?.eraImportId || "—"} />
            <Field label="ERA claim" value={payment.eraPostingClaim.eraClaimId} />
            <Field label="ERA payment amount" value={money(payment.eraPostingClaim.paymentAmount)} />
            <Field
              label="Patient responsibility"
              value={money(payment.eraPostingClaim.patientResponsibilityAmount)}
            />
          </div>
          {batch?.reversal && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              This ERA batch has a reversal record. Reversed by {batch.reversal.reversedBy.displayName} on {dateTime(batch.reversal.createdAt)}.
              <div className="mt-1">{batch.reversal.note}</div>
            </div>
          )}
        </section>
      )}

      {payment.eraPostingReversal && (
        <section className="card mt-6 p-6">
          <h2 className="text-lg font-semibold">ERA reversal information</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Reversal record" value={payment.eraPostingReversal.id} />
            <Field label="Original batch" value={reversalBatch?.id || "—"} />
            <Field label="Reversed by" value={payment.eraPostingReversal.reversedBy.displayName} />
            <Field label="Reversal date" value={dateTime(payment.eraPostingReversal.createdAt)} />
          </div>
          <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">
            {payment.eraPostingReversal.note}
          </p>
        </section>
      )}

      <section className="card mt-6 overflow-hidden">
        <div className="border-b border-slate-100 p-6">
          <h2 className="text-lg font-semibold">Payment allocations</h2>
          <p className="mt-1 text-sm text-slate-500">
            Allocation entries are displayed separately and retain their signed financial amounts.
          </p>
        </div>
        {payment.allocations.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No allocations are recorded for this payment.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-mist text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-4">Charge</th>
                  <th className="px-5 py-4">Visit</th>
                  <th className="px-5 py-4">Allocation date</th>
                  <th className="px-5 py-4">Amount</th>
                  <th className="px-5 py-4">Relationship</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payment.allocations.map((allocation) => (
                  <tr key={allocation.id}>
                    <td className="px-5 py-4">
                      <Link
                        href={`/billing/${allocation.charge.id}`}
                        className="font-semibold text-teal hover:underline"
                      >
                        {allocation.charge.id}
                      </Link>
                      <div className="mt-1 text-xs text-slate-500">
                        {allocation.charge.patient.firstName} {allocation.charge.patient.lastName}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {allocation.charge.encounter.appointment.visitType}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4">
                      {dateTime(allocation.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 font-semibold">
                      {money(allocation.amount)}
                    </td>
                    <td className="px-5 py-4 text-xs">
                      {allocation.reversalOfAllocationId ? (
                        <div className="font-semibold text-red-700">
                          Reversal of {allocation.reversalOfAllocationId}
                        </div>
                      ) : allocation.reversalAllocation ? (
                        <div className="text-slate-600">
                          Reversed by {allocation.reversalAllocation.id}
                        </div>
                      ) : (
                        <span className="text-slate-500">Original allocation</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card mt-6 overflow-hidden">
        <div className="border-b border-slate-100 p-6">
          <h2 className="text-lg font-semibold">Related audit history</h2>
          <p className="mt-1 text-sm text-slate-500">
            Audit events associated with this payment and its linked financial records.
          </p>
        </div>
        {auditEvents.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No related audit events found.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {auditEvents.map((event) => (
              <div key={event.id} className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{event.action}</span>
                  <span className="text-xs text-slate-500">{dateTime(event.createdAt)}</span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {event.entityType} · {event.entityId} · {event.actor?.displayName || "System"}
                </div>
                {event.metadata != null && (
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                    {JSON.stringify(event.metadata, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="mt-8 text-xs text-slate-400">
        DEMO ENVIRONMENT · Synthetic data only · USD · Read-only payment detail. No live payment processing.
      </p>
    </AppShell>
  );
}