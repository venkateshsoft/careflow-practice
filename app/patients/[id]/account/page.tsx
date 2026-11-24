
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function dateTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
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

export default async function PatientAccountPage({ params }: PageProps) {
  const user = await currentUser();

  if (!user || !user.active) {
    redirect("/login");
  }

  if (!["ADMIN", "BILLING", "PROVIDER"].includes(user.role)) {
    redirect("/?error=unauthorized");
  }

  const { id } = await params;

  const patient = await db.patient.findFirst({
    where: {
      id,
      practiceId: user.practiceId,
    },
  });

  if (!patient) {
    notFound();
  }

  const providerFilter =
    user.role === "PROVIDER"
      ? {
          provider: {
            displayName: user.displayName,
          },
        }
      : {};

  const charges = await db.charge.findMany({
    where: {
      patientId: patient.id,
      practiceId: user.practiceId,
      ...providerFilter,
    },
    include: {
      provider: {
        select: {
          displayName: true,
        },
      },
      encounter: {
        include: {
          appointment: {
            select: {
              visitType: true,
            },
          },
        },
      },
      lines: {
        orderBy: {
          sequence: "asc",
        },
      },
      adjustments: {
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
        orderBy: {
          createdAt: "desc",
        },
      },
    },
    orderBy: {
      generatedAt: "desc",
    },
  });

  const postedCharges = charges.filter(
    (charge) => charge.status === "POSTED"
  );

  const draftCharges = charges.filter(
    (charge) => charge.status === "DRAFT"
  );

  const voidedCharges = charges.filter(
    (charge) => charge.status === "VOIDED"
  );

  const postedAdjustments = charges.flatMap((charge) =>
    charge.adjustments.filter(
      (adjustment) =>
        adjustment.status === "POSTED" &&
        charge.status === "POSTED"
    )
  );

  const draftAdjustments = charges.flatMap((charge) =>
    charge.adjustments.filter(
      (adjustment) => adjustment.status === "DRAFT"
    )
  );

  const voidedAdjustments = charges.flatMap((charge) =>
    charge.adjustments.filter(
      (adjustment) => adjustment.status === "VOIDED"
    )
  );

  // Only posted payments and allocations against this patient's posted
  // charges are included in the account balance.
  const postedPayments = await db.payment.findMany({
    where: {
      patientId: patient.id,
      practiceId: user.practiceId,
      status: "POSTED",
    },
    include: {
      allocations: {
        where: {
          charge: {
            patientId: patient.id,
            practiceId: user.practiceId,
            status: "POSTED",
            ...(user.role === "PROVIDER"
              ? {
                  provider: {
                    displayName: user.displayName,
                  },
                }
              : {}),
          },
        },
        include: {
          charge: {
            select: {
              id: true,
            },
          },
        },
      },
    },
    orderBy: {
      receivedAt: "desc",
    },
  });

  const originalChargesTotal = postedCharges.reduce(
    (total, charge) => total + charge.totalAmount.toNumber(),
    0
  );

  const postedCredits = postedAdjustments
    .filter((adjustment) => adjustment.type === "CREDIT")
    .reduce(
      (total, adjustment) => total + adjustment.amount.toNumber(),
      0
    );

  const postedDebits = postedAdjustments
    .filter((adjustment) => adjustment.type === "DEBIT")
    .reduce(
      (total, adjustment) => total + adjustment.amount.toNumber(),
      0
    );

  const netCharges =
    originalChargesTotal - postedCredits + postedDebits;

  const totalPaymentsReceived = postedPayments.reduce(
    (total, payment) => total + payment.amount.toNumber(),
    0
  );

  const totalAllocatedPayments = postedPayments.reduce(
    (total, payment) =>
      total +
      payment.allocations.reduce(
        (sum, allocation) => sum + allocation.amount.toNumber(),
        0
      ),
    0
  );

  const unappliedPayments = Math.max(
    0,
    totalPaymentsReceived - totalAllocatedPayments
  );

  const outstandingBalance = netCharges - totalAllocatedPayments;

  const transactions = [
    ...postedCharges.map((charge) => ({
      id: `charge-${charge.id}`,
      date: charge.generatedAt,
      type: "CHARGE",
      description: charge.encounter.appointment.visitType,
      reference: charge.id,
      amount: charge.totalAmount.toNumber(),
      href: `/billing/${charge.id}` as string | null,
    })),

    ...postedAdjustments
      .filter((adjustment) => adjustment.type === "CREDIT")
      .map((adjustment) => ({
        id: `adjustment-${adjustment.id}`,
        date: adjustment.postedAt ?? adjustment.createdAt,
        type: "CREDIT",
        description: adjustment.reason,
        reference: adjustment.id,
        amount: -adjustment.amount.toNumber(),
        href: `/billing/adjustments/${adjustment.id}` as string | null,
      })),

    ...postedAdjustments
      .filter((adjustment) => adjustment.type === "DEBIT")
      .map((adjustment) => ({
        id: `adjustment-${adjustment.id}`,
        date: adjustment.postedAt ?? adjustment.createdAt,
        type: "DEBIT",
        description: adjustment.reason,
        reference: adjustment.id,
        amount: adjustment.amount.toNumber(),
        href: `/billing/adjustments/${adjustment.id}` as string | null,
      })),

    ...postedPayments.flatMap((payment) =>
      payment.allocations.map((allocation) => ({
        id: `payment-allocation-${allocation.id}`,
        date: allocation.createdAt,
        type: "PAYMENT",
        description: `${payment.source} payment allocation`,
        reference: payment.id,
        amount: -allocation.amount.toNumber(),
        href: null as string | null,
      }))
    ),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <AppShell user={user} active="Patients">
      <div className="mb-8">
        <Link
          href={`/patients/${patient.id}`}
          className="text-sm font-medium text-teal hover:underline"
        >
          ← Back to patient profile
        </Link>

        <div className="mt-5">
          <p className="text-xs font-bold tracking-wider text-teal">
            REVENUE CYCLE MANAGEMENT
          </p>

          <h1 className="mt-2 text-3xl font-semibold">
            Patient Account Ledger
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Financial transaction history for {patient.firstName}{" "}
            {patient.lastName}.
          </p>

          <p className="mt-1 text-xs text-slate-500">
            MRN: {patient.mrn}
          </p>
        </div>
      </div>

      <section className="card mb-6 p-6">
        <h2 className="text-lg font-semibold">
          Patient account summary
        </h2>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Original posted charges"
            value={money(originalChargesTotal)}
          />

          <Metric
            label="Posted credits"
            value={`-${money(postedCredits)}`}
            valueClass="text-red-700"
          />

          <Metric
            label="Posted debits"
            value={`+${money(postedDebits)}`}
          />

          <Metric
            label="Net charges"
            value={money(netCharges)}
            valueClass="text-teal"
          />
        </div>

        <div className="mt-5 grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2 xl:grid-cols-3">
          <Metric
            label="Posted payments received"
            value={money(totalPaymentsReceived)}
          />

          <Metric
            label="Payments allocated"
            value={money(totalAllocatedPayments)}
          />

          <Metric
            label="Unapplied payments"
            value={money(unappliedPayments)}
            valueClass={unappliedPayments > 0 ? "text-amber-700" : ""}
          />
        </div>

        <div className="mt-5 rounded-xl border border-teal/30 bg-teal/5 p-5">
          <p className="text-sm font-medium text-slate-600">
            Outstanding patient balance
          </p>

          <p
            className={`mt-2 text-3xl font-bold ${
              outstandingBalance > 0
                ? "text-slate-900"
                : "text-emerald-700"
            }`}
          >
            {money(outstandingBalance)}
          </p>

          <p className="mt-2 text-xs text-slate-500">
            Net posted charges minus payments allocated to posted charges.
            Unapplied payment funds do not reduce this balance.
          </p>
        </div>

        <div className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-3">
          <div>
            <p className="text-xs text-slate-500">Posted charges</p>
            <p className="mt-1 text-lg font-semibold">
              {postedCharges.length}
            </p>
          </div>

          <div>
            <p className="text-xs text-slate-500">Draft charges</p>
            <p className="mt-1 text-lg font-semibold">
              {draftCharges.length}
            </p>
          </div>

          <div>
            <p className="text-xs text-slate-500">Voided charges</p>
            <p className="mt-1 text-lg font-semibold">
              {voidedCharges.length}
            </p>
          </div>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-100 p-6">
          <h2 className="text-lg font-semibold">
            Account transaction history
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Posted charges, adjustments and payment allocations, ordered
            by transaction date.
          </p>
        </div>

        {transactions.length === 0 ? (
          <div className="p-10 text-center">
            <h3 className="font-semibold">No posted transactions</h3>
            <p className="mt-2 text-sm text-slate-500">
              Posted charges, adjustments and allocated payments will
              appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-mist text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-4">Date</th>
                  <th className="px-5 py-4">Transaction</th>
                  <th className="px-5 py-4">Description</th>
                  <th className="px-5 py-4">Reference</th>
                  <th className="px-5 py-4 text-right">Amount</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {transactions.map((transaction) => (
                  <tr
                    key={transaction.id}
                    className="hover:bg-slate-50"
                  >
                    <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                      {dateTime(transaction.date)}
                    </td>

                    <td className="px-5 py-4">
                      <span
                        className={`font-semibold ${
                          transaction.type === "CREDIT"
                            ? "text-red-700"
                            : transaction.type === "PAYMENT"
                              ? "text-emerald-700"
                              : transaction.type === "DEBIT"
                                ? "text-blue-700"
                                : "text-slate-800"
                        }`}
                      >
                        {transaction.type}
                      </span>
                    </td>

                    <td className="px-5 py-4">
                      {transaction.description}
                    </td>

                    <td className="px-5 py-4">
                      {transaction.href ? (
                        <Link
                          href={transaction.href}
                          className="font-mono text-xs text-teal hover:underline"
                        >
                          {transaction.reference}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs text-slate-500">
                          {transaction.reference}
                        </span>
                      )}
                    </td>

                    <td
                      className={`whitespace-nowrap px-5 py-4 text-right font-semibold ${
                        transaction.amount < 0
                          ? "text-emerald-700"
                          : "text-slate-900"
                      }`}
                    >
                      {transaction.amount < 0 ? "-" : ""}
                      {money(Math.abs(transaction.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-slate-100 bg-slate-50 px-6 py-4 text-xs text-slate-500">
          Only posted charges, posted adjustments and allocations from
          posted payments affect the outstanding balance. Draft and
          voided records are excluded.
        </div>
      </section>

      {(draftCharges.length > 0 ||
        voidedCharges.length > 0 ||
        draftAdjustments.length > 0 ||
        voidedAdjustments.length > 0) && (
        <section className="card mt-6 overflow-hidden">
          <div className="border-b border-slate-100 p-6">
            <h2 className="text-lg font-semibold">
              Pending and voided items
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              These records are displayed separately and are excluded
              from the outstanding balance.
            </p>
          </div>

          <div className="divide-y divide-slate-100">
            {draftCharges.map((charge) => (
              <div
                key={charge.id}
                className="flex flex-wrap items-center justify-between gap-3 p-5"
              >
                <div>
                  <Link
                    href={`/billing/${charge.id}`}
                    className="font-medium text-teal hover:underline"
                  >
                    Draft charge · {charge.encounter.appointment.visitType}
                  </Link>
                  <p className="mt-1 text-xs text-slate-500">
                    {dateTime(charge.generatedAt)}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <span className="font-semibold">
                    {money(charge.totalAmount.toNumber())}
                  </span>
                  <Status status="DRAFT" />
                </div>
              </div>
            ))}

            {draftAdjustments.map((adjustment) => (
              <div
                key={adjustment.id}
                className="flex flex-wrap items-center justify-between gap-3 p-5"
              >
                <div>
                  <Link
                    href={`/billing/adjustments/${adjustment.id}`}
                    className="font-medium text-teal hover:underline"
                  >
                    Draft {adjustment.type.toLowerCase()} adjustment
                  </Link>
                  <p className="mt-1 text-xs text-slate-500">
                    {adjustment.reason}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <span className="font-semibold">
                    {money(adjustment.amount.toNumber())}
                  </span>
                  <Status status="DRAFT" />
                </div>
              </div>
            ))}

            {voidedCharges.map((charge) => (
              <div
                key={charge.id}
                className="flex flex-wrap items-center justify-between gap-3 p-5"
              >
                <div>
                  <Link
                    href={`/billing/${charge.id}`}
                    className="font-medium text-slate-700 hover:underline"
                  >
                    Voided charge · {charge.encounter.appointment.visitType}
                  </Link>
                  <p className="mt-1 text-xs text-slate-500">
                    {dateTime(charge.generatedAt)}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <span className="font-semibold text-slate-500">
                    {money(charge.totalAmount.toNumber())}
                  </span>
                  <Status status="VOIDED" />
                </div>
              </div>
            ))}

            {voidedAdjustments.map((adjustment) => (
              <div
                key={adjustment.id}
                className="flex flex-wrap items-center justify-between gap-3 p-5"
              >
                <div>
                  <Link
                    href={`/billing/adjustments/${adjustment.id}`}
                    className="font-medium text-slate-700 hover:underline"
                  >
                    Voided {adjustment.type.toLowerCase()} adjustment
                  </Link>
                  <p className="mt-1 text-xs text-slate-500">
                    {adjustment.reason}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <span className="font-semibold text-slate-500">
                    {money(adjustment.amount.toNumber())}
                  </span>
                  <Status status="VOIDED" />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="mt-5 text-xs text-slate-400">
        DEMO ENVIRONMENT · Synthetic data only · USD · No live payments,
        claims or insurance transactions.
      </p>
    </AppShell>
  );
}

function Metric({
  label,
  value,
  valueClass = "",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p
        className={`mt-3 text-2xl font-semibold ${
          valueClass || "text-slate-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}