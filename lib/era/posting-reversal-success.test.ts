import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdjustmentStatus,
  AdjustmentType,
  EraPostingBatchStatus,
  PaymentStatus,
  Prisma,
} from "@prisma/client";

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

function buildSyntheticFixture() {
  const item = {
    id: "item-001",
    chargeId: "charge-001",
    paymentAllocationId: "allocation-001",
    chargeAmount: money("130.00"),
    insurancePayment: money("100.00"),
    patientResponsibility: money("20.00"),
    contractualAdjustment: money("10.00"),
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

  const batch = {
    id: "batch-001",
    eraImportId: "import-001",
    practiceId: "practice-001",
    status: EraPostingBatchStatus.POSTED,
    currency: "USD",
    postedAt: new Date("2026-11-20T10:00:00.000Z"),
    postedById: "admin-001",
    totalInsurancePayment: money("100.00"),
    totalPatientResponsibility: money("20.00"),
    totalContractualAdjustments: money("10.00"),
    reversal: null,
    claims: [claim],
  };

  const originalPayment = {
    id: "payment-001",
    practiceId: "practice-001",
    patientId: "patient-001",
    source: "ERA",
    method: "INSURANCE",
    status: PaymentStatus.POSTED,
    amount: money("100.00"),
    currency: "USD",
    referenceNumber: "TRACE-SYNTHETIC-001",
    postedAt: new Date("2026-11-20T10:00:00.000Z"),
    postedById: "admin-001",
  };

  const originalAllocation = {
    id: "allocation-001",
    paymentId: "payment-001",
    chargeId: "charge-001",
    amount: money("100.00"),
  };

  const originalAdjustment = {
    id: "adjustment-001",
    practiceId: "practice-001",
    patientId: "patient-001",
    chargeId: "charge-001",
    eraPostingItemId: "item-001",
    type: AdjustmentType.CREDIT,
    status: AdjustmentStatus.POSTED,
    amount: money("10.00"),
  };

  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "batch-001" }]),

    eraPostingBatch: {
      findFirst: vi.fn().mockResolvedValue(batch),
      update: vi.fn().mockResolvedValue({
        ...batch,
        status: EraPostingBatchStatus.REVERSED,
      }),
    },

    payment: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([originalPayment])
        .mockResolvedValueOnce([]),
      create: vi.fn().mockResolvedValue({
        id: "reversal-payment-001",
      }),
    },

    charge: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "charge-001",
          practiceId: "practice-001",
          patientId: "patient-001",
          currency: "USD",
        },
      ]),
    },

    paymentAllocation: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([originalAllocation])
        .mockResolvedValueOnce([{ id: "allocation-001" }])
        .mockResolvedValueOnce([]),
      create: vi.fn().mockResolvedValue({
        id: "reversal-allocation-001",
      }),
    },

    chargeAdjustment: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([originalAdjustment])
        .mockResolvedValueOnce([]),
      create: vi.fn().mockResolvedValue({
        id: "reversal-adjustment-001",
      }),
    },

    eraPostingReversal: {
      create: vi.fn().mockResolvedValue({
        id: "reversal-001",
      }),
    },

    auditEvent: {
      findFirst: vi.fn().mockResolvedValue({
        id: "original-posting-audit-001",
      }),
      create: vi.fn().mockResolvedValue({
        id: "new-audit-event",
      }),
    },
  };

  return {
    batch,
    originalPayment,
    originalAllocation,
    originalAdjustment,
    tx,
  };
}

function buildFormData() {
  const formData = new FormData();

  formData.set("batchId", "batch-001");
  formData.set(
    "reversalNote",
    "Synthetic test reversal for successful posting validation"
  );
  formData.set("confirmation", "REVERSE");

  return formData;
}

describe("ERA posting reversal successful scenario", () => {
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

  it("creates compensating financial records and marks the batch reversed", async () => {
    const fixture = buildSyntheticFixture();
    const { tx } = fixture;

    mocks.db.$transaction.mockImplementation(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx)
    );

    await expect(
      reversePostedEraBatch(buildFormData())
    ).rejects.toThrow(
      "REDIRECT:/billing/era/import-001?result=era-reversal-success"
    );

    // 1. Verify that a reversal header was created.
    expect(tx.eraPostingReversal.create).toHaveBeenCalledTimes(1);

    const reversalHeader =
      tx.eraPostingReversal.create.mock.calls[0][0];

    expect(reversalHeader.data).toMatchObject({
      batchId: "batch-001",
      practiceId: "practice-001",
      reversedById: "admin-001",
      note: "Synthetic test reversal for successful posting validation",
    });

    // 2. Verify the negative compensating payment.
    expect(tx.payment.create).toHaveBeenCalledTimes(1);

    const reversalPayment = tx.payment.create.mock.calls[0][0].data;

    expect(reversalPayment.amount.toString()).toBe("-100");
    expect(reversalPayment.status).toBe(PaymentStatus.POSTED);
    expect(reversalPayment.currency).toBe("USD");
    expect(reversalPayment.patientId).toBe("patient-001");
    expect(reversalPayment.reversalOfPaymentId).toBe("payment-001");
    expect(reversalPayment.eraPostingReversalId).toBe("reversal-001");

    // 3. Verify the negative compensating allocation.
    expect(tx.paymentAllocation.create).toHaveBeenCalledTimes(1);

    const reversalAllocation =
      tx.paymentAllocation.create.mock.calls[0][0].data;

    expect(reversalAllocation).toMatchObject({
      paymentId: "reversal-payment-001",
      chargeId: "charge-001",
      reversalOfAllocationId: "allocation-001",
      eraPostingReversalId: "reversal-001",
    });

    expect(reversalAllocation.amount.toString()).toBe("-100");

    // 4. Verify that the contractual adjustment uses the opposite type.
    expect(tx.chargeAdjustment.create).toHaveBeenCalledTimes(1);

    const reversalAdjustment =
      tx.chargeAdjustment.create.mock.calls[0][0].data;

    expect(reversalAdjustment).toMatchObject({
      chargeId: "charge-001",
      practiceId: "practice-001",
      patientId: "patient-001",
      type: AdjustmentType.DEBIT,
      status: AdjustmentStatus.POSTED,
      reversalOfAdjustmentId: "adjustment-001",
      eraPostingReversalId: "reversal-001",
    });

    expect(reversalAdjustment.amount.toString()).toBe("10");

    // 5. Verify that the batch is marked as reversed.
    expect(tx.eraPostingBatch.update).toHaveBeenCalledTimes(1);

    const batchUpdate = tx.eraPostingBatch.update.mock.calls[0][0];

    expect(batchUpdate.where).toEqual({
      id: "batch-001",
    });

    expect(batchUpdate.data).toMatchObject({
      status: EraPostingBatchStatus.REVERSED,
      reversedById: "admin-001",
      reversalNote:
        "Synthetic test reversal for successful posting validation",
    });

    expect(batchUpdate.data.reversedAt).toBeInstanceOf(Date);

    // 6. Verify financial audit events.
    const auditCalls = tx.auditEvent.create.mock.calls;

    const auditActions = auditCalls.map(
      (call) => call[0].data.action
    );

    expect(auditActions).toContain("PAYMENT_REVERSED");
    expect(auditActions).toContain("PAYMENT_ALLOCATION_REVERSED");
    expect(auditActions).toContain("CHARGE_ADJUSTMENT_REVERSED");
    expect(auditActions).toContain("ERA_POSTING_BATCH_REVERSED");

    expect(auditCalls).toHaveLength(4);

    // 7. Verify transaction configuration.
    expect(mocks.db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10000,
        timeout: 30000,
      }
    );

    // 8. Verify that the original records were only read, not modified.
    expect(tx.payment.create).toHaveBeenCalledTimes(1);
    expect(tx.paymentAllocation.create).toHaveBeenCalledTimes(1);
    expect(tx.chargeAdjustment.create).toHaveBeenCalledTimes(1);

    expect(tx.eraPostingBatch.update).toHaveBeenCalledTimes(1);
  });
});