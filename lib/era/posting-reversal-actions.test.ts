
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

const decimal = (value: string) => new Prisma.Decimal(value);

function buildBatch(overrides: Record<string, unknown> = {}) {
  const item = {
    id: "item-001",
    chargeId: "charge-001",
    paymentAllocationId: "allocation-001",
    chargeAmount: decimal("120.00"),
    insurancePayment: decimal("100.00"),
    patientResponsibility: decimal("20.00"),
    contractualAdjustment: decimal("0.00"),
  };

  const claim = {
    id: "claim-001",
    patientId: "patient-001",
    paymentId: "payment-001",
    currency: "USD",
    paymentAmount: decimal("100.00"),
    patientResponsibilityAmount: decimal("20.00"),
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
    totalInsurancePayment: decimal("100.00"),
    totalPatientResponsibility: decimal("20.00"),
    totalContractualAdjustments: decimal("0.00"),
    reversal: null,
    claims: [claim],
    ...overrides,
  };
}

function buildTransaction(batch: ReturnType<typeof buildBatch>) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "batch-001" }]),

    eraPostingBatch: {
      findFirst: vi.fn().mockResolvedValue(batch),
      create: vi.fn(),
      update: vi.fn(),
    },

    payment: {
      findMany: vi.fn(),
      create: vi.fn(),
    },

    charge: {
      findMany: vi.fn(),
    },

    paymentAllocation: {
      findMany: vi.fn(),
      create: vi.fn(),
    },

    chargeAdjustment: {
      findMany: vi.fn(),
      create: vi.fn(),
    },

    eraPostingReversal: {
      create: vi.fn(),
    },

    auditEvent: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  };
}

function buildFormData() {
  const formData = new FormData();
  formData.set("batchId", "batch-001");
  formData.set(
    "reversalNote",
    "Synthetic test reversal for validation coverage"
  );
  formData.set("confirmation", "REVERSE");
  return formData;
}

async function expectRedirect(
  formData: FormData,
  expectedPath: string
) {
  await expect(reversePostedEraBatch(formData)).rejects.toThrow(
    `REDIRECT:${expectedPath}`
  );
}

describe("ERA posting reversal validation", () => {
  let batch: ReturnType<typeof buildBatch>;
  let tx: ReturnType<typeof buildTransaction>;

  beforeEach(() => {
    vi.resetAllMocks();

    batch = buildBatch();
    tx = buildTransaction(batch);

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

    mocks.db.$transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx)
    );
  });

  it("redirects unauthenticated users to login", async () => {
    mocks.currentUser.mockResolvedValue(null);

    await expectRedirect(buildFormData(), "/login");

    expect(mocks.db.eraPostingBatch.findFirst).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects inactive users", async () => {
    mocks.currentUser.mockResolvedValue({
      id: "admin-001",
      active: false,
      role: "ADMIN",
      practiceId: "practice-001",
    });

    await expectRedirect(buildFormData(), "/login");

    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects users who are not administrators", async () => {
    mocks.currentUser.mockResolvedValue({
      id: "user-001",
      active: true,
      role: "STAFF",
      practiceId: "practice-001",
    });

    await expectRedirect(buildFormData(), "/");

    expect(mocks.db.eraPostingBatch.findFirst).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an invalid confirmation value", async () => {
    const formData = buildFormData();
    formData.set("confirmation", "YES");

    await expectRedirect(
      formData,
      "/billing/era?result=era-reversal-invalid"
    );

    expect(mocks.db.eraPostingBatch.findFirst).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a reversal note shorter than the required length", async () => {
    const formData = buildFormData();
    formData.set("reversalNote", "Too short");

    await expectRedirect(
      formData,
      "/billing/era?result=era-reversal-invalid"
    );

    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a batch that cannot be found for the user's practice", async () => {
    mocks.db.eraPostingBatch.findFirst.mockResolvedValue(null);

    await expectRedirect(
      buildFormData(),
      "/billing/era?result=era-reversal-not-found"
    );

    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a batch that has already been reversed", async () => {
    batch = buildBatch({
      status: "REVERSED",
      reversal: { id: "reversal-001" },
    });
    tx = buildTransaction(batch);

    mocks.db.$transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx)
    );

    await expectRedirect(
      buildFormData(),
      "/billing/era/import-001?result=era-reversal-already-reversed"
    );

    expect(tx.eraPostingReversal.create).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.paymentAllocation.create).not.toHaveBeenCalled();
    expect(tx.chargeAdjustment.create).not.toHaveBeenCalled();
    expect(tx.eraPostingBatch.update).not.toHaveBeenCalled();
  });

  it("rejects a batch that is not in POSTED status", async () => {
    batch = buildBatch({ status: "DRAFT" });
    tx = buildTransaction(batch);

    mocks.db.$transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx)
    );

    await expectRedirect(
      buildFormData(),
      "/billing/era/import-001?result=era-reversal-not-posted"
    );

    expect(tx.eraPostingReversal.create).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it("rejects a batch without financial posting items", async () => {
    batch = buildBatch({
      claims: [
        {
          ...buildBatch().claims[0],
          items: [],
        },
      ],
    });
    tx = buildTransaction(batch);

    mocks.db.$transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx)
    );

    await expectRedirect(
      buildFormData(),
      "/billing/era/import-001?result=era-reversal-no-financial-records"
    );

    expect(tx.eraPostingReversal.create).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it("rejects a claim whose currency differs from the batch currency", async () => {
    const originalClaim = buildBatch().claims[0];

    batch = buildBatch({
      claims: [
        {
          ...originalClaim,
          currency: "EUR",
        },
      ],
    });
    tx = buildTransaction(batch);

    mocks.db.$transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx)
    );

    await expectRedirect(
      buildFormData(),
      "/billing/era/import-001?result=era-reversal-invalid-records"
    );

    expect(tx.eraPostingReversal.create).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it("rejects a patient responsibility mismatch between claim and items", async () => {
    const originalClaim = buildBatch().claims[0];

    batch = buildBatch({
      claims: [
        {
          ...originalClaim,
          patientResponsibilityAmount: decimal("19.00"),
        },
      ],
    });
    tx = buildTransaction(batch);

    mocks.db.$transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx)
    );

    await expectRedirect(
      buildFormData(),
      "/billing/era/import-001?result=era-reversal-invalid-records"
    );

    expect(tx.eraPostingReversal.create).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it("rejects batch totals that do not reconcile with claim totals", async () => {
    batch = buildBatch({
      totalInsurancePayment: decimal("99.00"),
    });
    tx = buildTransaction(batch);

    mocks.db.$transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx)
    );

    await expectRedirect(
      buildFormData(),
      "/billing/era/import-001?result=era-reversal-invalid-records"
    );

    expect(tx.eraPostingReversal.create).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.paymentAllocation.create).not.toHaveBeenCalled();
    expect(tx.chargeAdjustment.create).not.toHaveBeenCalled();
    expect(tx.eraPostingBatch.update).not.toHaveBeenCalled();
  });
});