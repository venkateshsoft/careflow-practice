
import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  createPayment,
  reviewPayment,
  postPayment,
  voidPayment,
} from "@/lib/payment-actions";
import { allocatePayment } from "@/lib/payment-allocation-actions";

export const dynamic = "force-dynamic";

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

export default async function BillingPage() {
  const user = await currentUser();

  if (!user || !user.active) redirect("/login");

  const allowedRoles = ["ADMIN", "BILLING", "PROVIDER"];

  if (!allowedRoles.includes(user.role)) {
    redirect("/?error=unauthorized");
  }

  const canManagePayments = ["ADMIN", "BILLING"].includes(user.role);

  const charges = await db.charge.findMany({
    where: {
      practiceId: user.practiceId,
      ...(user.role === "PROVIDER"
        ? {
            provider: {
              displayName: user.displayName,
            },
          }
        : {}),
    },
    include: {
      patient: true,
      provider: true,
      encounter: {
        include: {
          appointment: true,
        },
      },
      lines: true,
      adjustments: {
        where: {
          status: "POSTED",
        },
        select: {
          type: true,
          amount: true,
        },
      },
      paymentAllocations: {
        where: {
          payment: {
            status: "POSTED",
          },
        },
        select: {
          amount: true,
        },
      },
    },
    orderBy: {
      generatedAt: "desc",
    },
  });

  const patients = canManagePayments
    ? await db.patient.findMany({
        where: {
          practiceId: user.practiceId,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          mrn: true,
        },
        orderBy: {
          lastName: "asc",
        },
      })
    : [];

  const payments = canManagePayments
    ? await db.payment.findMany({
        where: {
          practiceId: user.practiceId,
        },
        include: {
          patient: true,
          allocations: true,
        },
        orderBy: {
          receivedAt: "desc",
        },
        take: 100,
      })
    : [];

  const draftCount = charges.filter(
    (charge) => charge.status === "DRAFT"
  ).length;

  const postedCount = charges.filter(
    (charge) => charge.status === "POSTED"
  ).length;

  const voidedCount = charges.filter(
    (charge) => charge.status === "VOIDED"
  ).length;

  const draftAmount = charges
    .filter((charge) => charge.status === "DRAFT")
    .reduce(
      (total, charge) => total + charge.totalAmount.toNumber(),
      0
    );

  const chargeRows = charges.map((charge) => {
    const originalAmount = charge.totalAmount.toNumber();

    const credits = charge.adjustments
      .filter((adjustment) => adjustment.type === "CREDIT")
      .reduce(
        (total, adjustment) => total + adjustment.amount.toNumber(),
        0
      );

    const debits = charge.adjustments
      .filter((adjustment) => adjustment.type === "DEBIT")
      .reduce(
        (total, adjustment) => total + adjustment.amount.toNumber(),
        0
      );

    const netAmount = originalAmount - credits + debits;

    const allocatedAmount = charge.paymentAllocations.reduce(
      (total, allocation) => total + allocation.amount.toNumber(),
      0
    );

    const outstandingAmount = Math.max(
      0,
      netAmount - allocatedAmount
    );

    return {
      charge,
      originalAmount,
      credits,
      debits,
      netAmount,
      allocatedAmount,
      outstandingAmount,
      hasAdjustments: charge.adjustments.length > 0,
    };
  });

  const paymentDrafts = payments.filter(
    (payment) => payment.status === "DRAFT"
  );

  const paymentPosted = payments.filter(
    (payment) => payment.status === "POSTED"
  );

  const paymentVoided = payments.filter(
    (payment) => payment.status === "VOIDED"
  );

  const draftPaymentAmount = paymentDrafts.reduce(
    (total, payment) => total + payment.amount.toNumber(),
    0
  );

  const postedPaymentAmount = paymentPosted.reduce(
    (total, payment) => total + payment.amount.toNumber(),
    0
  );

  const totalUnapplied = paymentPosted.reduce((total, payment) => {
    const allocated = payment.allocations.reduce(
      (sum, allocation) => sum + allocation.amount.toNumber(),
      0
    );

    return total + Math.max(0, payment.amount.toNumber() - allocated);
  }, 0);

  const now = new Date();

  const localDateTime = new Date(
    now.getTime() - now.getTimezoneOffset() * 60000
  )
    .toISOString()
    .slice(0, 16);

  return (
    <AppShell user={user} active="Billing">
      <div className="mb-8">
        <div className="text-xs font-bold tracking-wider text-teal">
          REVENUE CYCLE MANAGEMENT
        </div>

        <h1 className="mt-2 text-3xl font-semibold">
          Billing & Charge Management
        </h1>

        <p className="mt-2 text-sm text-slate-500">
          Manage charges generated from signed clinical encounters and
          synthetic payment records.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total charges" value={charges.length} />
        <Metric label="Awaiting review" value={draftCount} />
        <Metric label="Posted charges" value={postedCount} />
        <Metric label="Draft charge value" value={money(draftAmount)} />
      </div>

      <section className="card mt-8 overflow-hidden">
        <div className="border-b border-slate-100 p-6">
          <h2 className="text-lg font-semibold">
            Charge work queue
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Posted adjustments and posted payment allocations are included
            in the outstanding balance.
          </p>
        </div>

        {charges.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-lg font-semibold">
              No charges available
            </div>

            <p className="mt-2 text-sm text-slate-500">
              Draft charges will appear here when an eligible clinical
              encounter is signed.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-mist text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-4">Patient</th>
                  <th className="px-5 py-4">Encounter</th>
                  <th className="px-5 py-4">Provider</th>
                  <th className="px-5 py-4">Procedure</th>
                  <th className="px-5 py-4">Original amount</th>
                  <th className="px-5 py-4">Adjustments</th>
                  <th className="px-5 py-4">Net amount</th>
                  <th className="px-5 py-4">Allocated</th>
                  <th className="px-5 py-4">Outstanding</th>
                  <th className="px-5 py-4">Status</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {chargeRows.map(
                  ({
                    charge,
                    originalAmount,
                    credits,
                    debits,
                    netAmount,
                    allocatedAmount,
                    outstandingAmount,
                    hasAdjustments,
                  }) => (
                    <tr
                      key={charge.id}
                      className="hover:bg-slate-50"
                    >
                      <td className="px-5 py-4">
                        <Link
                          href={`/billing/${charge.id}`}
                          className="font-semibold text-teal hover:underline"
                        >
                          {charge.patient.firstName}{" "}
                          {charge.patient.lastName}
                        </Link>

                        <div className="mt-1 text-xs text-slate-500">
                          {charge.patient.mrn}
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <div>
                          {charge.encounter.appointment.visitType}
                        </div>

                        <div className="mt-1 text-xs text-slate-500">
                          {charge.generatedAt.toLocaleDateString("en-US")}
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        {charge.provider.displayName}
                      </td>

                      <td className="px-5 py-4">
                        {charge.lines.map((line) => (
                          <div key={line.id}>
                            <div className="font-semibold">
                              {line.codeSnapshot}
                            </div>

                            <div className="mt-1 text-xs text-slate-500">
                              {line.descriptionSnapshot}
                            </div>

                            <div className="text-xs text-slate-500">
                              {line.units} unit(s)
                            </div>
                          </div>
                        ))}
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 font-medium">
                        {money(originalAmount)}
                      </td>

                      <td className="px-5 py-4">
                        {hasAdjustments ? (
                          <div className="space-y-1 text-xs">
                            {credits > 0 && (
                              <div className="font-medium text-red-700">
                                Credit: -{money(credits)}
                              </div>
                            )}

                            {debits > 0 && (
                              <div className="font-medium text-blue-700">
                                Debit: +{money(debits)}
                              </div>
                            )}

                            <Link
                              href={`/billing/${charge.id}/adjustments`}
                              className="inline-block pt-1 font-semibold text-teal hover:underline"
                            >
                              View adjustments
                            </Link>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">
                            None
                          </span>
                        )}
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 font-semibold">
                        {money(netAmount)}
                      </td>

                      <td className="whitespace-nowrap px-5 py-4">
                        {money(allocatedAmount)}
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 font-bold">
                        {money(outstandingAmount)}
                      </td>

                      <td className="px-5 py-4">
                        <Status status={charge.status} />
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManagePayments && (
        <>
          <div className="mb-4 mt-12">
            <div className="text-xs font-bold tracking-wider text-teal">
              PAYMENT MANAGEMENT
            </div>

            <h2 className="mt-2 text-2xl font-semibold">
              Payment Posting & Reconciliation
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              Record synthetic patient and insurance payments, review
              payment details, post approved payments and allocate them
              against outstanding charges.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Total payments" value={payments.length} />
            <Metric label="Draft payments" value={paymentDrafts.length} />
            <Metric
              label="Posted payment value"
              value={money(postedPaymentAmount)}
            />
            <Metric
              label="Unapplied payment value"
              value={money(totalUnapplied)}
            />
          </div>

          <section className="card mt-8 overflow-hidden">
            <div className="border-b border-slate-100 p-6">
              <h3 className="text-lg font-semibold">
                Record a payment
              </h3>

              <p className="mt-1 text-sm text-slate-500">
                Create a draft payment record for a synthetic patient.
              </p>
            </div>

            <form action={createPayment} className="space-y-5 p-6">
              <div className="grid gap-5 md:grid-cols-2">
                <Field label="Patient">
                  <select
                    name="patientId"
                    required
                    defaultValue=""
                    className="form-input"
                  >
                    <option value="" disabled>
                      Select patient
                    </option>

                    {patients.map((patient) => (
                      <option key={patient.id} value={patient.id}>
                        {patient.firstName} {patient.lastName} - {patient.mrn}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Payment source">
                  <select
                    name="source"
                    required
                    defaultValue="PATIENT"
                    className="form-input"
                  >
                    <option value="PATIENT">Patient</option>
                    <option value="INSURANCE">Insurance</option>
                    <option value="OTHER">Other</option>
                  </select>
                </Field>

                <Field label="Payment method">
                  <select
                    name="method"
                    required
                    defaultValue="CARD"
                    className="form-input"
                  >
                    <option value="CASH">Cash</option>
                    <option value="CHECK">Check</option>
                    <option value="CARD">Card</option>
                    <option value="EFT">EFT</option>
                    <option value="OTHER">Other</option>
                  </select>
                </Field>

                <Field label="Payment amount (USD)">
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    max="999999.99"
                    step="0.01"
                    required
                    placeholder="0.00"
                    className="form-input"
                  />
                </Field>

                <Field label="Received date and time">
                  <input
                    name="receivedAt"
                    type="datetime-local"
                    required
                    defaultValue={localDateTime}
                    className="form-input"
                  />
                </Field>

                <Field label="Reference number">
                  <input
                    name="referenceNumber"
                    type="text"
                    maxLength={100}
                    placeholder="Optional check or reference number"
                    className="form-input"
                  />
                </Field>
              </div>

              <Field label="Notes">
                <textarea
                  name="notes"
                  rows={3}
                  maxLength={5000}
                  placeholder="Optional payment notes"
                  className="form-input"
                />
              </Field>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
                <p className="text-xs text-slate-500">
                  New payments are saved as DRAFT and do not reduce
                  patient balances.
                </p>

                <button
                  type="submit"
                  disabled={patients.length === 0}
                  className="rounded-lg bg-teal px-5 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save draft payment
                </button>
              </div>
            </form>
          </section>

          <section className="card mt-8 overflow-hidden">
            <div className="border-b border-slate-100 p-6">
              <h3 className="text-lg font-semibold">
                Payment work queue
              </h3>

              <p className="mt-1 text-sm text-slate-500">
                Review and post payments, then allocate posted funds to
                eligible outstanding charges for the same patient.
              </p>
            </div>

            {payments.length === 0 ? (
              <div className="p-10 text-center">
                <div className="text-lg font-semibold">
                  No payments recorded
                </div>

                <p className="mt-2 text-sm text-slate-500">
                  Create a draft payment using the form above.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-mist text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-4">Patient</th>
                      <th className="px-5 py-4">Received</th>
                      <th className="px-5 py-4">Source</th>
                      <th className="px-5 py-4">Method</th>
                      <th className="px-5 py-4">Reference</th>
                      <th className="px-5 py-4">Amount</th>
                      <th className="px-5 py-4">Allocated</th>
                      <th className="px-5 py-4">Unapplied</th>
                      <th className="px-5 py-4">Status</th>
                      <th className="px-5 py-4">Actions</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {payments.map((payment) => {
                      const amount = payment.amount.toNumber();

                      const allocated = payment.allocations.reduce(
                        (total, allocation) =>
                          total + allocation.amount.toNumber(),
                        0
                      );

                      const unapplied = Math.max(0, amount - allocated);

                      const isReviewed = Boolean(
                        payment.reviewedAt && payment.reviewedById
                      );

                      const eligibleCharges = chargeRows.filter(
                        (row) =>
                          row.charge.status === "POSTED" &&
                          row.charge.patientId === payment.patientId &&
                          row.outstandingAmount > 0
                      );

                      return (
                        <tr
                          key={payment.id}
                          className="align-top hover:bg-slate-50"
                        >
                          <td className="px-5 py-4">
                            <div className="font-semibold">
                              {payment.patient.firstName}{" "}
                              {payment.patient.lastName}
                            </div>

                            <div className="mt-1 text-xs text-slate-500">
                              {payment.patient.mrn}
                            </div>
                          </td>

                          <td className="whitespace-nowrap px-5 py-4">
                            {payment.receivedAt.toLocaleString("en-US")}
                          </td>

                          <td className="px-5 py-4">
                            {payment.source}
                          </td>

                          <td className="px-5 py-4">
                            {payment.method}
                          </td>

                          <td className="px-5 py-4">
                            {payment.referenceNumber || "-"}
                          </td>

                          <td className="whitespace-nowrap px-5 py-4 font-semibold">
                            {money(amount)}
                          </td>

                          <td className="whitespace-nowrap px-5 py-4">
                            {money(allocated)}
                          </td>

                          <td className="whitespace-nowrap px-5 py-4">
                            <span
                              className={
                                unapplied > 0
                                  ? "font-semibold text-amber-700"
                                  : "font-semibold text-emerald-700"
                              }
                            >
                              {money(unapplied)}
                            </span>
                          </td>

                          <td className="px-5 py-4">
                            <Status status={payment.status} />

                            {payment.status === "DRAFT" && isReviewed && (
                              <div className="mt-2 text-xs font-medium text-blue-700">
                                Reviewed
                              </div>
                            )}
                          </td>

                          <td className="min-w-64 px-5 py-4">
                            {payment.status === "DRAFT" ? (
                              <div className="space-y-2">
                                {!isReviewed ? (
                                  <form action={reviewPayment}>
                                    <input
                                      type="hidden"
                                      name="paymentId"
                                      value={payment.id}
                                    />

                                    <button
                                      type="submit"
                                      className="font-semibold text-teal hover:underline"
                                    >
                                      Review payment
                                    </button>
                                  </form>
                                ) : (
                                  <form action={postPayment}>
                                    <input
                                      type="hidden"
                                      name="paymentId"
                                      value={payment.id}
                                    />

                                    <button
                                      type="submit"
                                      className="font-semibold text-emerald-700 hover:underline"
                                    >
                                      Post payment
                                    </button>
                                  </form>
                                )}

                                <form
                                  action={voidPayment}
                                  className="space-y-2"
                                >
                                  <input
                                    type="hidden"
                                    name="paymentId"
                                    value={payment.id}
                                  />

                                  <input
                                    name="reason"
                                    type="text"
                                    required
                                    minLength={5}
                                    maxLength={1000}
                                    placeholder="Void reason"
                                    className="form-input text-xs"
                                  />

                                  <button
                                    type="submit"
                                    className="text-xs font-semibold text-red-700 hover:underline"
                                  >
                                    Void draft
                                  </button>
                                </form>
                              </div>
                            ) : payment.status === "POSTED" ? (
                              <div className="space-y-3">
                                {unapplied > 0 && eligibleCharges.length > 0 ? (
                                  <form
                                    action={allocatePayment}
                                    className="space-y-2 rounded-lg border border-slate-200 p-3"
                                  >
                                    <input
                                      type="hidden"
                                      name="paymentId"
                                      value={payment.id}
                                    />

                                    <div className="text-xs font-semibold text-slate-700">
                                      Allocate payment
                                    </div>

                                    <select
                                      name="chargeId"
                                      required
                                      defaultValue=""
                                      className="form-input text-xs"
                                    >
                                      <option value="" disabled>
                                        Select outstanding charge
                                      </option>

                                      {eligibleCharges.map((row) => (
                                        <option
                                          key={row.charge.id}
                                          value={row.charge.id}
                                        >
                                          {row.charge.encounter.appointment.visitType}
                                          {" - "}
                                          {money(row.outstandingAmount)} due
                                        </option>
                                      ))}
                                    </select>

                                    <input
                                      name="amount"
                                      type="number"
                                      min="0.01"
                                      max={Math.min(
                                        unapplied,
                                        Math.max(
                                          ...eligibleCharges.map(
                                            (row) => row.outstandingAmount
                                          )
                                        )
                                      ).toFixed(2)}
                                      step="0.01"
                                      required
                                      placeholder="Allocation amount (USD)"
                                      className="form-input text-xs"
                                    />

                                    <div className="text-xs text-slate-500">
                                      Available: {money(unapplied)}
                                    </div>

                                    <button
                                      type="submit"
                                      className="w-full rounded-lg bg-teal px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
                                    >
                                      Allocate payment
                                    </button>
                                  </form>
                                ) : (
                                  <div className="text-xs text-slate-500">
                                    {unapplied <= 0
                                      ? "Fully allocated"
                                      : "No outstanding posted charges for this patient"}
                                  </div>
                                )}

                                <div className="text-xs text-slate-400">
                                  Posted payment
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">
                                No further actions
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="mt-4 text-xs text-slate-500">
            Posted payments: {paymentPosted.length} · Voided payments:{" "}
            {paymentVoided.length}
          </div>
        </>
      )}

      <p className="mt-8 text-xs text-slate-400">
        DEMO ENVIRONMENT · Synthetic data only · USD · No live claims,
        payer connections, payment gateways or financial transactions.
      </p>

      <div className="sr-only">
        Voided charges: {voidedCount}
      </div>
    </AppShell>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="card p-5">
      <div className="text-sm text-slate-500">{label}</div>

      <div className="mt-3 text-2xl font-semibold">
        {value}
      </div>
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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">
        {label}
      </span>
      {children}
    </label>
  );
}