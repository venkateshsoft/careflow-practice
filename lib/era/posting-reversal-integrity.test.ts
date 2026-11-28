import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  db: {
    eraPostingBatch: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  currentUser: mocks.currentUser,
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

import { reversePostedEraBatch } from "@/lib/era/posting-reversal-actions";

const money = (value: string) => new Prisma.Decimal(value);

function buildBatch(options?: {
  chargePatientId?: string;
  contractualAdjustment?: string;
}) {
  const adjustment = options?.contractualAdjustment ?? "0.00";

  const item = {
    id: "item-001",
    chargeId: "charge-001",
    paymentAllocationId: "allocation-001",
    chargeAmount: money(
      (120 + Number(adjustment)).toFixed(2)
    ),
    insurancePayment: money("100.00"),
    patientResponsibility: money("20.00"),
    contractualAdjustment: money(adjustment),
  };

  const claim = {
    id: "claim-001",
    patientId: "patient-001",
    paymentId: "payment-001",
    currency: "USD",
    paymentAmount: money("100.00"),
    patientResponsibilityAmount: money("20.00"),
    items: [item],
  };

  return {
    id: "batch-001",
    eraImportId: "import-001",
    practiceId: "practice-001",
    status: "POSTED",
    currency: "USD",
    postedAt: new Date("2026-11-20T10:00:00.000Z"),
    postedById: "admin-001",
    totalInsurancePayment: money("100.00"),
    totalPatientResponsibility: money("20.00"),
    totalContractualAdjustments: money(adjustment),
    reversal: null,
    claims: [claim],
  };
}

function buildPayment() {
  return {
    id: "payment-001",
    practiceId: "practice-001",
    patientId: "patient-001",
    status: "POSTED",
    amount: money("100.00"),
    currency: "USD",
    postedAt: new Date("2026-11-20T10:00:00.000Z"),
    postedById: "admin-001",
    source: "ERA",
    method: "INSURANCE",
    referenceNumber: "TRACE-001",
  };
}

function buildAllocation() {
  return {
    id: "allocation-001",
    paymentId: "payment-001",
    chargeId: "charge-001",
    amount: money("100.00"),
  };
}

function buildAdjustment() {
  return {
    id: "adjustment-001",
    practiceId: "practice-001",
    patientId: "patient-001",
    chargeId: "charge-001",
    eraPostingItemId: "item-001",
    type: "CREDIT",
    status: "POSTED",
    amount: money("10.00"),
  };
}

function buildTransaction(
  options?: {
    chargePatientId?: string;
    unrelatedAllocation?: boolean;
    duplicatePaymentReversal?: boolean;
    duplicateAllocationReversal?: boolean;
    missingPostingAudit?: boolean;
    contractualAdjustment?: string;
    duplicateAdjustmentReversal?: boolean;
  }
) {
  const batch = buildBatch({
    chargePatientId: options?.chargePatientId,
    contractualAdjustment: options?.contractualAdjustment,
  });

  const payment = buildPayment();
  const allocation = buildAllocation();

  const charge = {
    id: "charge-001",
    practiceId: "practice-001",
    patientId: options?.chargePatientId ?? "patient-001",
    currency: "USD",
  };

  const adjustment =
    options?.contractualAdjustment &&
    options.contractualAdjustment !== "0.00"
      ? buildAdjustment()
      : null;

  const actualAllocations = options?.unrelatedAllocation
    ? [
        { id: "allocation-001" },
        { id: "unrelated-allocation-001" },
      ]
    : [{ id: "allocation-001" }];

  const paymentReversals = options?.duplicatePaymentReversal
    ? [{ reversalOfPaymentId: "payment-001" }]
    : [];

  const allocationReversals = options?.duplicateAllocationReversal
    ? [{ reversalOfAllocationId: "allocation-001" }]
    : [];

  const adjustmentReversals = options?.duplicateAdjustmentReversal
    ? [{ reversalOfAdjustmentId: "adjustment-001" }]
    : [];

  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "batch-001" }]),

    eraPostingBatch: {
      findFirst: vi.fn().mockResolvedValue(batch),
      update: vi.fn(),
    },

    payment: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([payment])
        .mockResolvedValueOnce(paymentReversals),
      create: vi.fn(),
    },

    charge: {
      findMany: vi.fn().mockResolvedValue([charge]),
    },

    paymentAllocation: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([allocation])
        .mockResolvedValueOnce(actualAllocations)
        .mockResolvedValueOnce(allocationReversals),
      create: vi.fn(),
    },

    chargeAdjustment: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce(adjustment ? [adjustment] : [])
        .mockResolvedValueOnce(adjustmentReversals),
      create: vi.fn(),
    },

    eraPostingReversal: {
      create: vi.fn(),
    },

    auditEvent: {
      findFirst: vi.fn().mockResolvedValue(
        options?.missingPostingAudit ? null : { id: "audit-001" }
      ),
      create: vi.fn(),
    },
  };

  return tx;
}

function buildFormData() {
  const formData = new FormData();

  formData.set("batchId", "batch-001");
  formData.set(
    "reversalNote",
    "Synthetic integrity validation test"
  );
  formData.set("confirmation", "REVERSE");

  return formData;
}

async function expectInvalidRecords(
  tx: ReturnType<typeof buildTransaction>
) {
  await expect(
    reversePostedEraBatch(buildFormData())
  ).rejects.toThrow(
    "REDIRECT:/billing/era/import-001?result=era-reversal-invalid-records"
  );

  expect(tx.eraPostingReversal.create).not.toHaveBeenCalled();
  expect(tx.payment.create).not.toHaveBeenCalled();
  expect(tx.paymentAllocation.create).not.toHaveBeenCalled();
  expect(tx.chargeAdjustment.create).not.toHaveBeenCalled();
  expect(tx.eraPostingBatch.update).not.toHaveBeenCalled();
}

describe("ERA posting reversal integrity validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mocks.currentUser.mockResolvedValue({
      id: "admin-001",
      active: true,
      role: "ADMIN",
      practiceId: "practice-001",
    });

    mocks.redirect.mockImplementation((path: string) => {
      throw new Error(`REDIRECT:${path}`);
    });

    mocks.db.eraPostingBatch.findFirst.mockResolvedValue({
      eraImportId: "import-001",
    });
  });

  function runWithTransaction(tx: ReturnType<typeof buildTransaction>) {
    mocks.db.$transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx)
    );
  }

  it("rejects a charge belonging to a different patient", async () => {
    const tx = buildTransaction({
      chargePatientId: "patient-002",
    });

    runWithTransaction(tx);

    await expectInvalidRecords(tx);
  });

  it("rejects unrelated allocations added to an original payment", async () => {
    const tx = buildTransaction({
      unrelatedAllocation: true,
    });

    runWithTransaction(tx);

    await expectInvalidRecords(tx);
  });

  it("rejects an original payment that already has a reversal", async () => {
    const tx = buildTransaction({
      duplicatePaymentReversal: true,
    });

    runWithTransaction(tx);

    await expectInvalidRecords(tx);
  });

  it("rejects an allocation that already has a reversal", async () => {
    const tx = buildTransaction({
      duplicateAllocationReversal: true,
    });

    runWithTransaction(tx);

    await expectInvalidRecords(tx);
  });

  it("rejects a batch without its original posting audit event", async () => {
    const tx = buildTransaction({
      missingPostingAudit: true,
    });

    runWithTransaction(tx);

    await expectInvalidRecords(tx);
  });

  it("rejects an adjustment that already has a reversal", async () => {
    const tx = buildTransaction({
      contractualAdjustment: "10.00",
      duplicateAdjustmentReversal: true,
    });

    runWithTransaction(tx);

    await expectInvalidRecords(tx);
  });
});