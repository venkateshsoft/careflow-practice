
import { describe, expect, it } from "vitest";
import { parseEra835 } from "@/lib/era/parser";
import { Era835ParseException } from "@/lib/era/types";

function buildSynthetic835(
  claimSegments: string[],
  providerSegments: string[] = [],
  paymentAmount = "150.00",
): string {
  const isa =
    "ISA*00*          *00*          *ZZ*SYNTHPAYER     *ZZ*CAREFLOW       *261124*1200*^*00501*000000001*0*P*:".padEnd(
      105,
      " ",
    ) + "~";

  const transactionSegments = [
    "ST*835*0001",
    `BPR*I*${paymentAmount}*C*CHK************20261124`,
    "TRN*1*TRACE-DEMO-001*1999999999",
    ...claimSegments,
    ...providerSegments,
  ];

  const segmentCount = transactionSegments.length + 1;
  transactionSegments.push(`SE*${segmentCount}*0001`);

  return [
    isa,
    "GS*HP*SYNTHPAYER*CAREFLOW*20261124*1200*1*X*005010X221A1",
    ...transactionSegments,
    "GE*1*1",
    "IEA*1*000000001",
  ].join("~") + "~";
}

describe("X12 835 parser", () => {
  it("parses payment, claim, service line and adjustments", () => {
    const file = buildSynthetic835([
      "CLP*CF-10001*1*180.00*150.00*30.00*12*PAYER-CLAIM-001*11",
      "CAS*CO*45*20.00",
      "SVC*HC:DEMO-NEW*180.00*150.00*0450*1",
      "DTM*472*20261124",
      "CAS*PR*3*30.00",
    ]);

    const result = parseEra835(file);
    const claim = result.claims[0];
    const line = claim.serviceLines[0];

    expect(result.payment.totalPaymentAmount).toBe(150);
    expect(result.payment.traceNumber).toBe("TRACE-DEMO-001");
    expect(claim.patientControlNumber).toBe("CF-10001");
    expect(claim.paymentAmount).toBe(150);
    expect(claim.facilityCode).toBe("11");
    expect(line.procedureCode).toBe("DEMO-NEW");
    expect(line.revenueCode).toBe("0450");
    expect(line.units).toBe(1);
    expect(line.serviceDate).toBe("2026-11-24");

    expect(claim.adjustments[0]).toMatchObject({
      groupCode: "CO",
      reasonCode: "45",
      amount: 20,
    });

    expect(line.adjustments[0]).toMatchObject({
      groupCode: "PR",
      reasonCode: "3",
      amount: 30,
    });
  });

  it("parses multiple claims in one remittance", () => {
    const file = buildSynthetic835(
      [
        "CLP*CF-10001*1*100.00*80.00*20.00*12*PAYER-001*11",
        "SVC*HC:99213*100.00*80.00*0450*1",
        "CAS*PR*3*20.00",
        "CLP*CF-10002*1*200.00*120.00*30.00*12*PAYER-002*11",
        "SVC*HC:99214*200.00*120.00*0450*1",
        "CAS*CO*45*50.00**PR*3*30.00",
      ],
      [],
      "200.00",
    );

    const result = parseEra835(file);

    expect(result.claims).toHaveLength(2);
    expect(result.claims[0].patientControlNumber).toBe("CF-10001");
    expect(result.claims[1].patientControlNumber).toBe("CF-10002");
    expect(result.claims[1].adjustments).toHaveLength(0);
    expect(result.claims[1].serviceLines[0].adjustments).toHaveLength(2);
  });

  it("parses multiple service lines within one claim", () => {
    const file = buildSynthetic835([
      "CLP*CF-10003*1*250.00*200.00*50.00*12*PAYER-003*11",
      "SVC*HC:99213:25*150.00*120.00*0450*1",
      "DTM*472*20261120",
      "CAS*CO*45*30.00",
      "SVC*HC:93000*100.00*80.00*0730*1",
      "DTM*472*20261120",
      "CAS*PR*3*20.00",
    ]);

    const claim = parseEra835(file).claims[0];

    expect(claim.serviceLines).toHaveLength(2);
    expect(claim.serviceLines[0].modifiers).toEqual(["25"]);
    expect(claim.serviceLines[0].revenueCode).toBe("0450");
    expect(claim.serviceLines[1].procedureCode).toBe("93000");
    expect(claim.serviceLines[1].revenueCode).toBe("0730");
  });

  it("preserves a fully denied claim with zero payment", () => {
    const file = buildSynthetic835(
      [
        "CLP*CF-DENIED-01*4*100.00*0.00*20.00*CI*PAYER-DENIED*11",
        "CAS*CO*45*80.00**PR*1*20.00",
      ],
      [],
      "0.00",
    );

    const claim = parseEra835(file).claims[0];

    expect(claim.claimStatusCode).toBe("4");
    expect(claim.totalChargeAmount).toBe(100);
    expect(claim.paymentAmount).toBe(0);
    expect(claim.adjustments).toHaveLength(2);
  });

  it("preserves partial payment and patient responsibility", () => {
    const file = buildSynthetic835(
      [
        "CLP*CF-PARTIAL-01*2*100.00*60.00*20.00*12*PAYER-PARTIAL*11",
        "CAS*CO*45*20.00",
        "CAS*PR*3*20.00",
        "SVC*HC:99213*100.00*60.00*0450*1",
      ],
      [],
      "60.00",
    );

    const claim = parseEra835(file).claims[0];

    expect(claim.claimStatusCode).toBe("2");
    expect(claim.paymentAmount).toBe(60);
    expect(claim.patientResponsibilityAmount).toBe(20);
    expect(claim.adjustments).toHaveLength(2);
  });

  it("parses multiple CAS groups and reason codes on a service line", () => {
    const file = buildSynthetic835([
      "CLP*CF-CAS-01*1*200.00*140.00*20.00*12*PAYER-CAS*11",
      "SVC*HC:99214*200.00*140.00*0450*1",
      "CAS*CO*45*30.00**97*10.00",
      "CAS*PR*3*20.00",
    ]);

    const adjustments = parseEra835(file).claims[0].serviceLines[0].adjustments;

    expect(adjustments).toHaveLength(3);
    expect(adjustments.map((item) => item.groupCode)).toEqual([
      "CO",
      "CO",
      "PR",
    ]);
    expect(adjustments.map((item) => item.reasonCode)).toEqual([
      "45",
      "97",
      "3",
    ]);
  });

  it("parses PLB provider-level adjustments and preserves signed amounts", () => {
    const file = buildSynthetic835(
      [
        "CLP*CF-PLB-01*1*100.00*100.00*0.00*12*PAYER-PLB*11",
        "SVC*HC:99213*100.00*100.00*0450*1",
      ],
      [
        "PLB*1234567890*20261130*WOREF001*-15.00*FBREF002*5.00",
      ],
      "100.00",
    );

    const result = parseEra835(file);

    expect(result.providerAdjustments).toHaveLength(2);
    expect(result.providerAdjustments[0]).toMatchObject({
      providerIdentifier: "1234567890",
      reasonCode: "WO:REF001",
      amount: -15,
    });
    expect(result.providerAdjustments[1]).toMatchObject({
      reasonCode: "FB:REF002",
      amount: 5,
    });
  });

  it("rejects empty input", () => {
    expect(() => parseEra835("")).toThrow(Era835ParseException);
  });

  it("rejects a file without an ISA header", () => {
    expect(() => parseEra835("GS*HP~ST*835*0001~")).toThrow(
      Era835ParseException,
    );
  });

  it("rejects a non-835 transaction", () => {
    const file = buildSynthetic835([
      "CLP*CF-10001*1*100.00*100.00*0.00*12*PAYER-001*11",
    ]).replace("ST*835*0001", "ST*837*0001");

    expect(() => parseEra835(file)).toThrow(Era835ParseException);
  });

  it("rejects mismatched transaction control numbers", () => {
    const file = buildSynthetic835([
      "CLP*CF-10001*1*100.00*100.00*0.00*12*PAYER-001*11",
    ]).replace(/SE\*\d+\*0001/, "SE*5*9999");

    expect(() => parseEra835(file)).toThrow(Era835ParseException);
  });
});