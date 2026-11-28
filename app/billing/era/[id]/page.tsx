import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { matchEraImport } from "@/lib/era/matching-actions";
import { resolveEraException } from "@/lib/era/exception-actions";
import { approveEraReconciliation } from "@/lib/era/approval-actions";
import { createEraPostingPreview } from "@/lib/era/posting-actions";
import { approveEraPostingBatch } from "@/lib/era/posting-approval-actions";
import { postApprovedEraBatch } from "@/lib/era/posting-engine-actions";
import { assignEraPayer } from "@/lib/era/payer-assignment-actions";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ result?: string }>;
};

function money(value: { toNumber(): number } | null | undefined) {
  return value == null ? "Not available" : `$${value.toNumber().toFixed(2)}`;
}

function dateTime(value: Date | null | undefined) {
  return value
    ? value.toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not available";
}

function Status({ value }: { value: string }) {
  const styles: Record<string, string> = {
    RECEIVED: "bg-slate-100 text-slate-700",
    VALIDATION_FAILED: "bg-red-100 text-red-800",
    VALIDATED: "bg-blue-100 text-blue-800",
    RECONCILIATION_READY: "bg-indigo-100 text-indigo-800",
    RECONCILED: "bg-emerald-100 text-emerald-800",
    POSTED: "bg-emerald-100 text-emerald-800",
    VOIDED: "bg-slate-100 text-slate-600",
    MATCHED: "bg-emerald-100 text-emerald-800",
    PARTIALLY_MATCHED: "bg-amber-100 text-amber-800",
    UNMATCHED: "bg-slate-100 text-slate-700",
    EXCEPTION: "bg-red-100 text-red-800",
    OPEN: "bg-amber-100 text-amber-800",
    RESOLVED: "bg-emerald-100 text-emerald-800",
    IGNORED: "bg-slate-100 text-slate-600",
    INFO: "bg-blue-100 text-blue-800",
    WARNING: "bg-amber-100 text-amber-800",
    ERROR: "bg-red-100 text-red-800",
    PREVIEW: "bg-slate-100 text-slate-700",
    BLOCKED: "bg-red-100 text-red-800",
    READY_FOR_REVIEW: "bg-amber-100 text-amber-800",
    APPROVED: "bg-emerald-100 text-emerald-800",
    REVERSED: "bg-slate-100 text-slate-600",
  };

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
        styles[value] ?? "bg-slate-100 text-slate-700"
      }`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note?: string;
}) {
  return (
    <div className="card p-5">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {note && <div className="mt-1 text-xs text-slate-400">{note}</div>}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-semibold text-slate-800">
        {value}
      </div>
    </div>
  );
}

function ExceptionCard({
  exception,
}: {
  exception: {
    id: string;
    category: string;
    code: string | null;
    message: string;
    severity: string;
    status: string;
    resolutionNote: string | null;
    resolvedAt: Date | null;
    resolvedBy: { displayName: string } | null;
  };
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">
          {exception.code ?? exception.category}
        </span>
        <Status value={exception.severity} />
        <Status value={exception.status} />
      </div>

      <p className="mt-2 text-sm leading-6 text-slate-700">
        {exception.message}
      </p>

      {exception.status === "OPEN" ? (
        <div className="mt-5 rounded-lg bg-slate-50 p-4">
          <h4 className="font-semibold text-slate-800">
            Review and close exception
          </h4>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Enter at least 10 characters explaining the review outcome.
            Resolve means the exception has been investigated. Ignore means
            it is intentionally being left unresolved. Neither action changes
            the service-line match.
          </p>

          <form action={resolveEraException} className="mt-4 space-y-3">
            <input
              type="hidden"
              name="exceptionId"
              value={exception.id}
            />

            <div>
              <label
                htmlFor={`resolution-${exception.id}`}
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Resolution note
              </label>
              <textarea
                id={`resolution-${exception.id}`}
                name="resolutionNote"
                required
                minLength={10}
                maxLength={2000}
                rows={3}
                placeholder="Document what was reviewed and why this exception is being resolved or ignored..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                name="decision"
                value="RESOLVED"
                className="rounded-lg bg-teal px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
              >
                Resolve exception
              </button>
              <button
                type="submit"
                name="decision"
                value="IGNORED"
                className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Ignore exception
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="mt-4 rounded-lg bg-slate-50 p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Review record
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
            {exception.resolutionNote ?? "No resolution note recorded."}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {exception.status === "RESOLVED" ? "Resolved" : "Ignored"}
            {exception.resolvedBy?.displayName
              ? ` by ${exception.resolvedBy.displayName}`
              : ""}
            {exception.resolvedAt
              ? `  |  ${dateTime(exception.resolvedAt)}`
              : ""}
          </p>
        </div>
      )}
    </div>
  );
}

export default async function EraImportDetailPage({
  params,
  searchParams,
}: PageProps) {
  const user = await currentUser();

  if (!user || !user.active) redirect("/login");

  if (!["ADMIN", "BILLING"].includes(user.role)) {
    redirect("/?error=unauthorized");
  }

  const { id } = await params;
  const query = await searchParams;

  const eraImport = await db.eraImport.findFirst({
    where: {
      id,
      practiceId: user.practiceId,
    },
    include: {
      payer: true,
      importedBy: {
        select: { displayName: true, email: true },
      },
      claims: {
        orderBy: { patientControlNumber: "asc" },
        include: {
          patient: true,
          insuranceClaim: {
            include: {
              patient: true,
              lines: {
                include: {
                  chargeLine: true,
                },
              },
            },
          },
          serviceLines: {
            orderBy: { id: "asc" },
            include: {
              insuranceClaimLine: true,
              chargeLine: true,
              adjustments: true,
              exceptions: {
                orderBy: { createdAt: "asc" },
                include: {
                  resolvedBy: {
                    select: { displayName: true },
                  },
                },
              },
            },
          },
          adjustments: {
            orderBy: { adjustmentSequence: "asc" },
          },
          exceptions: {
            orderBy: { createdAt: "asc" },
            include: {
              resolvedBy: {
                select: { displayName: true },
              },
            },
          },
        },
      },
      providerAdjustments: {
        orderBy: { adjustmentSequence: "asc" },
      },
      exceptions: {
        orderBy: { createdAt: "desc" },
        include: {
          resolvedBy: {
            select: { displayName: true },
          },
        },
      },
    },
  });

  if (!eraImport) notFound();

  const matchingAudit = await db.auditEvent.findFirst({
    where: {
      practiceId: user.practiceId,
      entityType: "EraImport",
      entityId: eraImport.id,
      action: "ERA_CLAIM_MATCHING_COMPLETED",
    },
    select: {
      id: true,
      createdAt: true,
      actor: {
        select: { displayName: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const approvalAudit = await db.auditEvent.findFirst({
    where: {
      practiceId: user.practiceId,
      entityType: "EraImport",
      entityId: eraImport.id,
      action: "ERA_RECONCILIATION_APPROVED",
    },
    select: {
      id: true,
      createdAt: true,
      actor: {
        select: { displayName: true },
      },
      metadata: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const matchingAlreadyRun = Boolean(matchingAudit);
  const alreadyApproved = Boolean(approvalAudit);

  const postingBatch = await db.eraPostingBatch.findUnique({
    where: { eraImportId: eraImport.id },
    include: {
      preparedBy: { select: { displayName: true } },
      approvedBy: { select: { displayName: true } },
      claims: {
        orderBy: { createdAt: "asc" },
        include: {
          eraClaim: { select: { patientControlNumber: true } },
          patient: { select: { firstName: true, lastName: true } },
          items: {
            include: {
              charge: { select: { id: true, totalAmount: true } },
              eraServiceLines: { select: { procedureCode: true } },
            },
          },
        },
      },
    },
  });

  const activePayers = await db.insurancePayer.findMany({
    where: {
      practiceId: user.practiceId,
      active: true,
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      payerCode: true,
    },
  });

  const postingAudit = postingBatch
    ? await db.auditEvent.findFirst({
        where: {
          practiceId: user.practiceId,
          entityType: "EraPostingBatch",
          entityId: postingBatch.id,
          action: "ERA_POSTING_BATCH_POSTED",
        },
        select: {
          id: true,
          createdAt: true,
          actor: { select: { displayName: true } },
        },
        orderBy: { createdAt: "desc" },
      })
    : null;

  const postingBatchFinal = postingBatch;
  const canPreparePostingPreview =
    alreadyApproved &&
    (!postingBatchFinal ||
      ["PREVIEW", "BLOCKED", "READY_FOR_REVIEW"].includes(
        postingBatchFinal.status
      ));

  const claims = eraImport.claims;
  const serviceLines = claims.flatMap((claim) => claim.serviceLines);
  const exceptions = eraImport.exceptions;
  // Claim-linked exceptions are displayed inside their claim card.
  // Keep this section limited to file-level exceptions to avoid duplicates.
  const importLevelExceptions = exceptions.filter(
    (exception) => exception.eraClaimId === null
  );

  const matchedClaims = claims.filter(
    (claim) => claim.matchStatus === "MATCHED"
  ).length;

  const partialClaims = claims.filter(
    (claim) => claim.matchStatus === "PARTIALLY_MATCHED"
  ).length;

  const unmatchedClaims = claims.filter(
    (claim) =>
      claim.matchStatus === "UNMATCHED" ||
      claim.matchStatus === "EXCEPTION"
  ).length;

  const matchedLines = serviceLines.filter(
    (line) => line.matchStatus === "MATCHED"
  ).length;

  const openExceptions = exceptions.filter(
    (item) => item.status === "OPEN"
  ).length;

  const resolvedExceptions = exceptions.filter(
    (item) => item.status === "RESOLVED"
  ).length;

  const ignoredExceptions = exceptions.filter(
    (item) => item.status === "IGNORED"
  ).length;

  const totalClaimPayment = claims.reduce(
    (sum, claim) => sum + claim.paymentAmount.toNumber(),
    0
  );

  const totalPatientResponsibility = claims.reduce(
    (sum, claim) => sum + claim.patientResponsibilityAmount.toNumber(),
    0
  );

  const filePayment = eraImport.paymentAmount?.toNumber() ?? null;
  const paymentTotalsMatch =
    filePayment !== null &&
    Math.round(filePayment * 100) ===
      Math.round(totalClaimPayment * 100);

  const allClaimsLinked =
    claims.length > 0 &&
    claims.every(
      (claim) =>
        Boolean(claim.insuranceClaim) &&
        claim.matchStatus !== "UNMATCHED" &&
        claim.matchStatus !== "EXCEPTION"
    );

  const allServiceLinesReviewed = serviceLines.every((line) => {
    if (line.matchStatus === "MATCHED") return true;

    return (
      line.exceptions.length > 0 &&
      line.exceptions.every(
        (exception) => exception.status !== "OPEN"
      )
    );
  });

  const canApprove =
    !alreadyApproved &&
    (eraImport.status === "VALIDATED" ||
      eraImport.status === "RECONCILIATION_READY") &&
    allClaimsLinked &&
    allServiceLinesReviewed &&
    openExceptions === 0 &&
    paymentTotalsMatch;

  const canRunMatching =
    !matchingAlreadyRun &&
    !alreadyApproved &&
    (eraImport.status === "VALIDATED" ||
      eraImport.status === "RECONCILIATION_READY");

  const approvalMetadata = approvalAudit?.metadata as
    | { reviewNote?: string }
    | null
    | undefined;

  const resultMessages: Record<string, string> = {
    "payer-assignment-success":
      "Payer assigned successfully. You can now proceed with claim matching.",
    "payer-assignment-invalid":
      "Payer assignment failed. Select a valid payer and try again.",
    "payer-not-found":
      "The ERA import or selected active payer could not be found in this practice.",
    "payer-already-assigned":
      "This payer is already assigned to the ERA import.",
    "payer-assignment-locked":
      "Payer assignment is locked because matching, reconciliation approval or posting preparation has already started.",
    "payer-already-processed":
      "Payer assignment is blocked because this ERA import has already been processed.",
    "matching-complete":
      "Claim matching completed. Review all claim and service-line results below. No financial transactions were posted.",
    "matching-already-run":
      "Claim matching has already been completed for this import. Repeated matching is blocked.",
    "exception-resolved":
      "Exception resolved. The review note and audit record have been saved. Service-line matching and financial records were not changed.",
    "exception-ignored":
      "Exception marked as ignored. The review note and audit record have been saved. Service-line matching and financial records were not changed.",
    "already-processed":
      "This exception has already been reviewed. No further change was made.",
    "not-found":
      "The requested exception could not be found in this practice.",
    "invalid-data":
      "The submitted information is invalid. Please check the resolution note and try again.",
    "approval-success":
      "Reconciliation approved. The reviewer note and audit record have been saved. No financial transactions were posted.",
    "already-approved":
      "This ERA reconciliation has already been approved. Duplicate approval is prevented.",
    "approval-invalid":
      "The approval information is invalid. Enter a review note of at least 10 characters.",
    "open-exceptions":
      "Approval blocked: open exceptions remain. Resolve or explicitly ignore each exception first.",
    "claims-unmatched":
      "Approval blocked: one or more ERA claims are not linked to an internal claim.",
    "service-lines-unreviewed":
      "Approval blocked: one or more unmatched service lines have not been reviewed.",
    "payment-total-mismatch":
      "Approval blocked: the ERA file payment total does not equal the sum of claim payments.",
    "posting-preview-created":
      "Posting preview created. No payments, allocations, adjustments or patient balance changes were made.",
    "posting-preview-blocked":
      "Posting preview created with blockers. Review the reasons below before proceeding.",
    "reconciliation-not-approved":
      "Posting preview blocked: reconciliation approval is required first.",
    "invalid-payment-total":
      "Posting preview blocked: the ERA payment total is missing or invalid.",
    "batch-already-processed":
      "This posting batch has already moved beyond preview and cannot be regenerated.",
    "posting-approval-success":
      "Posting batch approved by a separate reviewer. No financial transactions were posted.",
    "posting-approval-invalid":
      "The posting approval note is invalid. Enter at least 10 characters.",
    "posting-batch-not-found":
      "The posting batch could not be found for this practice.",
    "posting-batch-already-processed":
      "This posting batch has already been approved or processed. Duplicate approval is blocked.",
    "posting-batch-not-ready":
      "Approval blocked: the posting batch is not ready for review.",
    "posting-approver-must-differ":
      "Approval blocked: a different ADMIN or BILLING user must approve this batch.",
    "posting-batch-open-exceptions":
      "Approval blocked: unresolved ERA exceptions remain.",
    "posting-batch-provider-adjustments":
      "Approval blocked: provider-level adjustments require separate review.",
    "posting-batch-empty":
      "Approval blocked: the posting batch contains no claims.",
    "posting-batch-claim-unmatched":
      "Approval blocked: every posting claim must be fully matched to an internal claim.",
    "posting-batch-no-items":
      "Approval blocked: one or more claims have no posting items.",
    "posting-batch-service-lines-unmatched":
      "Approval blocked: every ERA service line must be matched to an internal charge line.",
    "posting-batch-payment-total-mismatch":
      "Approval blocked: posting item and claim payment totals do not match the batch total.",
    "posting-batch-responsibility-total-mismatch":
      "Approval blocked: patient responsibility totals do not match the batch total.",
    "posting-approval-retry":
      "The batch changed during approval. Refresh the page and review it again.",
    "era-posting-success":
      "ERA financial posting completed. Payment records, allocations and applicable contractual adjustments were created, and the batch was marked posted.",
    "era-posting-not-found":
      "The posting batch could not be found for this practice.",
    "era-posting-not-approved":
      "Posting was blocked because the batch does not have a valid independent approval.",
    "era-posting-already-posted":
      "This batch has already been posted. Duplicate posting is prevented.",
    "era-posting-invalid-batch":
      "Posting was blocked because the batch failed a required status, approval or eligibility check.",
    "era-posting-claim-invalid":
      "Posting was blocked because one or more claims or service-line links failed validation.",
    "era-posting-charge-invalid":
      "Posting was blocked because an internal charge failed validation.",
    "era-posting-payment-total-mismatch":
      "Posting was blocked because the claim payment totals do not reconcile with the ERA deposit.",
    "era-posting-responsibility-total-mismatch":
      "Posting was blocked because patient-responsibility totals do not reconcile.",
    "era-posting-contractual-total-mismatch":
      "Posting was blocked because contractual-adjustment totals do not reconcile.",
    "era-posting-charge-balance-exceeded":
      "Posting was blocked because the proposed transactions would exceed an outstanding charge balance.",
    "era-posting-adjustment-invalid":
      "Posting was blocked because an adjustment snapshot failed validation.",
    "era-posting-retry":
      "The batch changed during posting. No partial transaction should be retained. Refresh the page and review the batch again.",
  };

  const readinessChecks = [
    {
      label: "All ERA claims linked to internal claims",
      passed: allClaimsLinked,
    },
    {
      label: "All service lines matched or reviewed",
      passed: allServiceLinesReviewed,
    },
    {
      label: "No open exceptions remain",
      passed: openExceptions === 0,
    },
    {
      label: "ERA payment total equals claim payment total",
      passed: paymentTotalsMatch,
    },
  ];

  return (
    <AppShell user={user} active="Billing">
      <div className="mb-8">
        <Link
          href="/billing/era"
          className="text-sm font-medium text-teal hover:underline"
        >
           Back to ERA imports
        </Link>

        <div className="mt-6 text-xs font-bold tracking-wider text-teal">
          REVENUE CYCLE MANAGEMENT
        </div>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">ERA reconciliation</h1>
            <p className="mt-2 text-sm text-slate-500">
              Review imported 835 claim details, internal claim matches,
              service-line comparisons and exceptions.
            </p>
          </div>
          <Status value={alreadyApproved ? "RECONCILED" : eraImport.status} />
        </div>
      </div>

      {query.result && resultMessages[query.result] && (
        <div
          role="status"
          className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
        >
          {resultMessages[query.result]}
        </div>
      )}

      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold tracking-wider text-teal">
              IMPORTED FILE
            </div>
            <h2 className="mt-2 break-all text-xl font-semibold">
              {eraImport.fileName}
            </h2>
            <p className="mt-1 break-all text-xs text-slate-400">
              Import ID: {eraImport.id}
            </p>
          </div>
          <Status value={eraImport.status} />
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <Info label="Payer" value={eraImport.payer?.name ?? "Not assigned"} />
          <Info
            label="Payer code"
            value={eraImport.payer?.payerCode ?? "Not available"}
          />
          <Info label="Trace number" value={eraImport.traceNumber ?? "Not available"} />
          <Info
            label="Payment method code"
            value={eraImport.paymentMethodCode ?? "Not available"}
          />
          <Info
            label="ERA payment amount"
            value={money(eraImport.paymentAmount)}
          />
          <Info label="Currency" value={eraImport.currency} />
          <Info
            label="Payment effective date"
            value={dateTime(eraImport.paymentEffectiveDate)}
          />
          <Info label="Received" value={dateTime(eraImport.receivedAt)} />
          <Info
            label="Imported by"
            value={eraImport.importedBy.displayName}
          />
          <Info
            label="Parser version"
            value={eraImport.parserVersion ?? "Not available"}
          />
          <Info
            label="Interchange control"
            value={eraImport.interchangeControlNumber ?? "Not available"}
          />
          <Info
            label="Transaction control"
            value={eraImport.transactionControlNumber ?? "Not available"}
          />
        </div>
      </section>

      {!matchingAlreadyRun &&
        !alreadyApproved &&
        !postingBatch &&
        eraImport.status !== "POSTED" &&
        eraImport.status !== "VOIDED" && (
          <section className="card mt-6 p-6">
            <h2 className="text-lg font-semibold">Payer assignment</h2>
            <p className="mt-1 text-sm text-slate-500">
              Assign this remittance to an active insurance payer in this practice
              before running claim matching.
            </p>

            <div className="mt-4">
              <Info
                label="Currently assigned payer"
                value={eraImport.payer?.name ?? "Not assigned"}
              />
            </div>

            {activePayers.length === 0 ? (
              <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                No active insurance payers are configured for this practice.
                Add or activate a payer before assigning this ERA import.
              </p>
            ) : (
              <form action={assignEraPayer} className="mt-5">
                <input
                  type="hidden"
                  name="importId"
                  value={eraImport.id}
                />

                <label
                  htmlFor="era-payer-id"
                  className="mb-2 block text-sm font-medium text-slate-700"
                >
                  Select insurance payer
                </label>

                <select
                  id="era-payer-id"
                  name="payerId"
                  required
                  defaultValue={eraImport.payerId ?? ""}
                  className="w-full max-w-xl rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-teal"
                >
                  <option value="" disabled>
                    Select a payer
                  </option>
                  {activePayers.map((payer) => (
                    <option key={payer.id} value={payer.id}>
                      {payer.name} ({payer.payerCode})
                    </option>
                  ))}
                </select>

                <button
                  type="submit"
                  className="mt-4 rounded-lg bg-teal px-6 py-3 text-sm font-semibold text-white hover:opacity-90"
                >
                  Save payer assignment
                </button>
              </form>
            )}

            <p className="mt-3 text-xs text-slate-500">
              Payer assignment is audited. It does not perform claim matching
              or create financial transactions.
            </p>
          </section>
        )}

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="ERA claims" value={claims.length} />
        <Metric label="Fully matched claims" value={matchedClaims} />
        <Metric label="Partial matches" value={partialClaims} />
        <Metric label="Unmatched / exception claims" value={unmatchedClaims} />
        <Metric label="Matched service lines" value={matchedLines} />
        <Metric label="Open exceptions" value={openExceptions} />
        <Metric label="Resolved exceptions" value={resolvedExceptions} />
        <Metric label="Ignored exceptions" value={ignoredExceptions} />
        <Metric
          label="Claim payment total"
          value={`$${totalClaimPayment.toFixed(2)}`}
          note="Sum of ERA claim payment amounts"
        />
        <Metric
          label="Patient responsibility"
          value={`$${totalPatientResponsibility.toFixed(2)}`}
          note={
            postingBatch?.status === "POSTED"
              ? "Remains the patient's responsibility after insurance allocation"
              : "ERA-reported amount; not an insurance payment"
          }
        />
      </section>

      <section className="card mt-8 overflow-hidden">
        <div className="border-b border-slate-100 p-6">
          <h2 className="text-xl font-semibold">Claim matching</h2>
          <p className="mt-1 text-sm text-slate-500">
            Matching uses practice, payer, patient control number, payer
            control number when available, and billed amount. Service lines
            require exact code, amount and units.
          </p>
        </div>

        {claims.length === 0 ? (
          <div className="p-8 text-sm text-slate-500">
            This import contains no parsed claims.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {claims.map((claim, index) => (
              <article key={claim.id} className="p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold tracking-wider text-teal">
                      CLAIM {index + 1}
                    </div>
                    <h3 className="mt-1 text-lg font-semibold">
                      Patient control number: {claim.patientControlNumber}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Payer claim control:{" "}
                      {claim.payerClaimControlNumber ?? "Not supplied"}
                    </p>
                  </div>
                  <Status value={claim.matchStatus} />
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Info
                    label="ERA billed amount"
                    value={money(claim.totalChargeAmount)}
                  />
                  <Info
                    label="ERA payment"
                    value={money(claim.paymentAmount)}
                  />
                  <Info
                    label="Patient responsibility"
                    value={money(claim.patientResponsibilityAmount)}
                  />
                  <Info
                    label="Claim status code"
                    value={claim.claimStatusCode}
                  />
                </div>

                <div className="mt-5 rounded-lg border border-slate-200 p-4">
                  <div className="text-xs font-bold tracking-wider text-slate-500">
                    INTERNAL CLAIM MATCH
                  </div>

                  {claim.insuranceClaim ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <Info
                        label="Internal patient"
                        value={`${claim.insuranceClaim.patient.firstName} ${claim.insuranceClaim.patient.lastName}`}
                      />
                      <Info
                        label="Internal patient control"
                        value={claim.insuranceClaim.patientControlNumber}
                      />
                      <Info
                        label="Internal billed amount"
                        value={money(claim.insuranceClaim.totalBilled)}
                      />
                      <Info
                        label="Internal claim status"
                        value={claim.insuranceClaim.status}
                      />
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-amber-700">
                      No internal claim has been linked.
                    </p>
                  )}
                </div>

                {claim.notes && (
                  <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                    {claim.notes}
                  </p>
                )}

                <div className="mt-6">
                  <h4 className="font-semibold">Service-line comparison</h4>

                  {claim.serviceLines.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">
                      No service lines were parsed for this claim.
                    </p>
                  ) : (
                    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full min-w-[760px] text-left text-sm">
                        <thead className="bg-mist text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-3">ERA procedure</th>
                            <th className="px-4 py-3">ERA billed</th>
                            <th className="px-4 py-3">ERA paid</th>
                            <th className="px-4 py-3">Units</th>
                            <th className="px-4 py-3">Internal procedure</th>
                            <th className="px-4 py-3">Internal billed</th>
                            <th className="px-4 py-3">Match status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {claim.serviceLines.map((line) => (
                            <tr key={line.id}>
                              <td className="px-4 py-3 font-medium">
                                {line.procedureCode ?? "Not available"}
                              </td>
                              <td className="px-4 py-3">
                                {money(line.lineChargeAmount)}
                              </td>
                              <td className="px-4 py-3">
                                {money(line.linePaymentAmount)}
                              </td>
                              <td className="px-4 py-3">
                                {line.unitsPaid?.toString() ?? "Not available"}
                              </td>
                              <td className="px-4 py-3">
                                {line.chargeLine?.codeSnapshot ?? "Not available"}
                              </td>
                              <td className="px-4 py-3">
                                {line.chargeLine
                                  ? money(line.chargeLine.lineTotal)
                                  : "Not available"}
                              </td>
                              <td className="px-4 py-3">
                                <Status value={line.matchStatus} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {claim.adjustments.length > 0 && (
                  <div className="mt-6">
                    <h4 className="font-semibold">Claim adjustments</h4>
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="text-xs uppercase text-slate-500">
                          <tr>
                            <th className="py-2 pr-4">Group</th>
                            <th className="py-2 pr-4">Reason</th>
                            <th className="py-2 pr-4">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {claim.adjustments.map((adjustment) => (
                            <tr key={adjustment.id} className="border-t">
                              <td className="py-2 pr-4">
                                {adjustment.groupCode}
                              </td>
                              <td className="py-2 pr-4">
                                {adjustment.reasonCode}
                              </td>
                              <td className="py-2 pr-4">
                                {money(adjustment.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {claim.exceptions.length > 0 && (
                  <div className="mt-5 space-y-3">
                    <h4 className="font-semibold">Claim exceptions</h4>
                    {claim.exceptions.map((exception) => (
                      <ExceptionCard
                        key={exception.id}
                        exception={exception}
                      />
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card mt-8 overflow-hidden">
        <div className="border-b border-slate-100 p-6">
          <h2 className="text-xl font-semibold">Import-level exceptions</h2>
          <p className="mt-1 text-sm text-slate-500">
            File-level exceptions not associated with an individual claim.
          </p>
        </div>

        {importLevelExceptions.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            No file-level exceptions recorded. Claim-related exceptions are
            displayed within their respective claim sections.
          </p>
        ) : (
          <div className="space-y-4 p-6">
            {importLevelExceptions.map((exception) => (
              <ExceptionCard key={exception.id} exception={exception} />
            ))}
          </div>
        )}
      </section>

      {eraImport.providerAdjustments.length > 0 && (
        <section className="card mt-8 p-6">
          <h2 className="text-lg font-semibold">Provider-level adjustments</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-4">Reason</th>
                  <th className="py-2 pr-4">Reference</th>
                  <th className="py-2 pr-4">Provider identifier</th>
                  <th className="py-2 pr-4">Amount</th>
                </tr>
              </thead>
              <tbody>
                {eraImport.providerAdjustments.map((adjustment) => (
                  <tr key={adjustment.id} className="border-t">
                    <td className="py-2 pr-4">{adjustment.reasonCode}</td>
                    <td className="py-2 pr-4">
                      {adjustment.referenceId ?? "Not available"}
                    </td>
                    <td className="py-2 pr-4">
                      {adjustment.providerIdentifier ?? "Not available"}
                    </td>
                    <td className="py-2 pr-4">{money(adjustment.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card mt-8 p-6">
        <h2 className="text-xl font-semibold">Reconciliation preview</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {postingBatch?.status === "POSTED"
            ? "The ERA amounts are shown below for reference. The approved insurance payment and allocation have been posted; patient responsibility remains on the patient account."
            : "This is a read-only preview of the amounts reported by the ERA. No payments, adjustments, allocations or patient account balance changes have been posted from this import yet."}
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <Info
            label="ERA file payment amount"
            value={money(eraImport.paymentAmount)}
          />
          <Info
            label="Sum of claim payments"
            value={`$${totalClaimPayment.toFixed(2)}`}
          />
          <Info
            label="Sum of patient responsibility"
            value={`$${totalPatientResponsibility.toFixed(2)}`}
          />
        </div>

        {postingBatch?.status === "POSTED" ? (
          <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
            Financial posting is complete. The insurance payment and charge allocation are recorded. Patient responsibility remains due according to the patient account ledger.
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            This section is a read-only reconciliation preview. Financial posting, when separately authorized, is performed through the controlled posting-batch action below.
          </div>
        )}
      </section>

      <section className="card mt-8 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">
              Reconciliation readiness
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Complete each review check before submitting billing approval.
            </p>
          </div>
          <Status value={alreadyApproved ? "RECONCILED" : canApprove ? "RECONCILIATION_READY" : "OPEN"} />
        </div>

        <div className="mt-5 space-y-3">
          {readinessChecks.map((check) => (
            <div
              key={check.label}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"
            >
              <span className="text-sm text-slate-700">{check.label}</span>
              <span
                className={`text-sm font-semibold ${
                  check.passed ? "text-emerald-700" : "text-amber-700"
                }`}
              >
                {check.passed ? "Passed" : "Pending"}
              </span>
            </div>
          ))}
        </div>

        {alreadyApproved ? (
          <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-emerald-900">
                Reconciliation approved
              </h3>
              <Status value="RECONCILED" />
            </div>
            <p className="mt-2 text-sm text-emerald-800">
              Approved by {approvalAudit?.actor?.displayName ?? "Billing reviewer"}
              {approvalAudit?.createdAt
                ? `  |  ${dateTime(approvalAudit.createdAt)}`
                : ""}
            </p>
            {approvalMetadata?.reviewNote && (
              <div className="mt-3 rounded-lg bg-white p-3">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Approval note
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {approvalMetadata.reviewNote}
                </p>
              </div>
            )}
            <p className="mt-3 text-xs text-emerald-800">
              Reconciliation approval was recorded before the separate financial posting.
            </p>
          </div>
        ) : canApprove ? (
          <form
            action={approveEraReconciliation}
            className="mt-6 rounded-lg border border-teal-200 bg-teal-50 p-5"
          >
            <input type="hidden" name="importId" value={eraImport.id} />

            <h3 className="font-semibold text-slate-900">
              Approve reconciliation
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Confirm that you reviewed the ERA totals, internal claim links
              and all exceptions. This records your approval and does not
              post any financial transactions.
            </p>

            <label
              htmlFor="approval-review-note"
              className="mt-4 mb-1 block text-sm font-medium text-slate-700"
            >
              Billing review note
            </label>
            <textarea
              id="approval-review-note"
              name="reviewNote"
              required
              minLength={10}
              maxLength={2000}
              rows={4}
              placeholder="Document the reconciliation review and approval decision..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal"
            />

            <button
              type="submit"
              className="mt-4 rounded-lg bg-teal px-6 py-3 text-sm font-semibold text-white hover:opacity-90"
            >
              Approve reconciliation
            </button>
          </form>
        ) : (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            Approval is currently blocked. Review the pending checks above
            and complete the required claim, service-line, exception and
            payment-total checks.
          </div>
        )}
      </section>

      <section className="card mt-8 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">ERA payment posting preview</h2>
            <p className="mt-1 text-sm text-slate-500">
              Prepare a controlled batch for billing review. This stage only
              creates preview records and never posts financial transactions.
            </p>
          </div>
          {postingBatch && <Status value={postingBatch.status} />}
        </div>

        {!alreadyApproved ? (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Reconciliation approval is required before preparing a posting preview.
          </p>
        ) : canPreparePostingPreview ? (
          <form action={createEraPostingPreview} className="mt-5">
            <input type="hidden" name="importId" value={eraImport.id} />
            <button
              type="submit"
              className="rounded-lg bg-teal px-6 py-3 text-sm font-semibold text-white hover:opacity-90"
            >
              {postingBatch ? "Recalculate posting preview" : "Prepare posting preview"}
            </button>
          </form>
        ) : null}

        {postingBatch && (
          <>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Info label="Insurance payment" value={money(postingBatch.totalInsurancePayment)} />
              <Info label="Patient responsibility" value={money(postingBatch.totalPatientResponsibility)} />
              <Info label="Contractual adjustments" value={money(postingBatch.totalContractualAdjustments)} />
              <Info label="Prepared by" value={postingBatch.preparedBy.displayName} />
            </div>

            {postingBatch.status === "APPROVED" ? (
              <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <h3 className="font-semibold text-emerald-900">Posting batch approved</h3>
                <p className="mt-2 text-sm text-emerald-800">
                  Approved by {postingBatch.approvedBy?.displayName ?? "Billing reviewer"}
                  {postingBatch.approvedAt ? `  |  ${dateTime(postingBatch.approvedAt)}` : ""}
                </p>
                {postingBatch.reviewNote && (
                  <p className="mt-3 whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-slate-700">
                    {postingBatch.reviewNote}
                  </p>
                )}
                <p className="mt-3 text-xs text-emerald-800">
                  Approval is not financial posting. Payments, allocations, adjustments and patient balances remain unchanged.
                </p>
              </div>
            ) : postingBatch.status === "READY_FOR_REVIEW" ? (
              postingBatch.preparedById === user.id ? (
                <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  Separation of duties applies: {postingBatch.preparedBy.displayName} prepared this batch. Sign in as a different ADMIN or BILLING user to approve it.
                </div>
              ) : (
                <form action={approveEraPostingBatch} className="mt-5 rounded-lg border border-teal-200 bg-teal-50 p-5">
                  <input type="hidden" name="batchId" value={postingBatch.id} />
                  <h3 className="font-semibold text-slate-900">Independent posting approval</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Review the batch totals and claim summary. The approver must be different from the preparer. Approval does not post financial transactions.
                  </p>
                  <label htmlFor="posting-approval-note" className="mt-4 mb-1 block text-sm font-medium text-slate-700">
                    Approval note
                  </label>
                  <textarea
                    id="posting-approval-note"
                    name="reviewNote"
                    required
                    minLength={10}
                    maxLength={2000}
                    rows={3}
                    placeholder="Document the independent review and approval decision..."
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal"
                  />
                  <button type="submit" className="mt-4 rounded-lg bg-teal px-6 py-3 text-sm font-semibold text-white hover:opacity-90">
                    Approve posting batch
                  </button>
                </form>
              )
            ) : null}

            {postingBatch.status === "APPROVED" && (
              <div className="mt-6 rounded-xl border border-red-300 bg-red-50 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-red-950">
                      Final financial posting
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-red-900">
                      This action creates posted insurance payments and charge allocations,
                      creates applicable contractual adjustments, updates patient account
                      balances and marks both the posting batch and ERA import as POSTED.
                    </p>
                  </div>
                  <Status value="APPROVED" />
                </div>

                <div className="mt-4 grid gap-4 rounded-lg border border-red-200 bg-white p-4 sm:grid-cols-3">
                  <Info
                    label="Insurance payments to create"
                    value={money(postingBatch.totalInsurancePayment)}
                  />
                  <Info
                    label="Patient responsibility (not a payment)"
                    value={money(postingBatch.totalPatientResponsibility)}
                  />
                  <Info
                    label="Contractual adjustments to create"
                    value={money(postingBatch.totalContractualAdjustments)}
                  />
                </div>

                <p className="mt-4 text-sm leading-6 text-red-900">
                  Before continuing, verify the synthetic patient, claim, charge, payment,
                  adjustment and deposit totals above. The server revalidates the batch
                  and performs all financial writes in one database transaction.
                </p>

                <form
                  action={postApprovedEraBatch}
                  className="mt-5 rounded-lg border border-red-200 bg-white p-4"
                >
                  <input type="hidden" name="batchId" value={postingBatch.id} />
                  <label
                    htmlFor="era-post-confirmation"
                    className="mb-2 block text-sm font-semibold text-slate-800"
                  >
                    Type POST to confirm final financial posting
                  </label>
                  <input
                    id="era-post-confirmation"
                    name="confirmation"
                    type="text"
                    required
                    minLength={4}
                    maxLength={4}
                    pattern="POST"
                    autoComplete="off"
                    placeholder="POST"
                    className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase outline-none focus:border-red-500"
                  />
                  <button
                    type="submit"
                    className="mt-4 block rounded-lg bg-red-700 px-6 py-3 text-sm font-semibold text-white hover:bg-red-800"
                  >
                    Post approved ERA batch
                  </button>
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    Submitting this form is the explicit instruction to execute financial
                    posting for this approved synthetic batch. Do not submit unless the
                    displayed amounts and patient/claim details have been reviewed.
                  </p>
                </form>
              </div>
            )}

            {postingBatch.status === "POSTED" && (
              <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-emerald-950">
                    Financial posting completed
                  </h3>
                  <Status value="POSTED" />
                </div>
                <p className="mt-2 text-sm text-emerald-900">
                  {postingAudit?.actor?.displayName
                    ? `Posted by ${postingAudit.actor.displayName}`
                    : "Posting audit event recorded"}
                  {postingAudit?.createdAt
                    ? `  |  ${dateTime(postingAudit.createdAt)}`
                    : ""}
                </p>
                <p className="mt-3 text-sm leading-6 text-emerald-900">
                  The posting batch and ERA import are marked POSTED. Review the
                  patient account ledgers and payment/allocation records for the
                  resulting transactions.
                </p>
              </div>
            )}

            {postingBatch.blockingNotes && (
              <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4">
                <h3 className="font-semibold text-red-900">Posting blockers</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-800">
                  {postingBatch.blockingNotes.split("\n").filter(Boolean).map((reason, index) => (
                    <li key={`${index}-${reason}`}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}

            {postingBatch.claims.length > 0 && (
              <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-mist text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Patient control number</th>
                      <th className="px-4 py-3">Patient</th>
                      <th className="px-4 py-3">Insurance payment</th>
                      <th className="px-4 py-3">Patient responsibility</th>
                      <th className="px-4 py-3">Posting items</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {postingBatch.claims.map((postingClaim) => (
                      <tr key={postingClaim.id}>
                        <td className="px-4 py-3">{postingClaim.eraClaim.patientControlNumber}</td>
                        <td className="px-4 py-3">
                          {postingClaim.patient
                            ? `${postingClaim.patient.firstName} ${postingClaim.patient.lastName}`
                            : "Not linked"}
                        </td>
                        <td className="px-4 py-3">{money(postingClaim.paymentAmount)}</td>
                        <td className="px-4 py-3">{money(postingClaim.patientResponsibilityAmount)}</td>
                        <td className="px-4 py-3">{postingClaim.items.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="mt-4 text-xs text-slate-500">
              {postingBatch.status === "POSTED" ? (
                <>
                  Posting completed {dateTime(postingBatch.postedAt)}
                  {postingAudit?.actor?.displayName
                    ? ` by ${postingAudit.actor.displayName}`
                    : ""}. The batch created the approved insurance payment and allocation. No contractual adjustment was created for this batch.
                </>
              ) : (
                <>
                  Preview prepared {dateTime(postingBatch.preparedAt)}. Financial posting, payments, allocations, adjustments and patient balance changes: none.
                </>
              )}
            </p>
          </>
        )}
      </section>

      {matchingAlreadyRun ? (
        <section className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-emerald-900">
              Claim matching already completed
            </span>
            <Status value="MATCHED" />
          </div>
          <p className="mt-2 text-sm leading-6 text-emerald-800">
            A matching attempt has already been recorded for this ERA import.
            Repeated matching is disabled to prevent duplicate exceptions
            and audit records.
          </p>
          {matchingAudit && (
            <p className="mt-2 text-xs text-emerald-700">
              Completed: {dateTime(matchingAudit.createdAt)}
              {matchingAudit.actor?.displayName
                ? `  |  By ${matchingAudit.actor.displayName}`
                : ""}
            </p>
          )}
        </section>
      ) : canRunMatching ? (
        <section className="mt-8 rounded-xl border border-teal-200 bg-white p-6">
          <h2 className="font-semibold">Run claim matching</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Run the practice-scoped matching rules against internal claims.
            Existing financial transactions and patient balances will not
            be changed.
          </p>

          <form action={matchEraImport} className="mt-5">
            <input type="hidden" name="importId" value={eraImport.id} />
            <button
              type="submit"
              className="rounded-lg bg-teal px-6 py-3 text-sm font-semibold text-white hover:opacity-90"
            >
              Run claim matching
            </button>
          </form>
        </section>
      ) : null}

      <p className="mt-8 text-xs text-slate-400">
        DEMO ENVIRONMENT  |  Synthetic data only  |  No live payer connections
         |  {postingBatch?.status === "POSTED"
          ? "Financial posting recorded for this synthetic batch"
          : "No financial posting performed"}
      </p>
    </AppShell>
  );
}
