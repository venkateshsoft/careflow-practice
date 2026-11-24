
import {
  Era835ParseException,
  type Era835ParseResult,
  type EraAdjustment,
  type EraClaim,
  type EraProviderAdjustment,
  type EraServiceLine,
} from "./types";

type Segment = {
  id: string;
  elements: string[];
  raw: string;
};

function fail(code: string, message: string, segment?: string): never {
  throw new Era835ParseException({ code, message, segment });
}

function getElement(segment: Segment, index: number): string {
  return segment.elements[index] ?? "";
}

function parseAmount(
  value: string | undefined,
  segment: string,
  field: string,
): number {
  if (value === undefined || value === "") return 0;

  if (!/^-?\d+(\.\d{1,2})?$/.test(value)) {
    fail("INVALID_AMOUNT", `Invalid amount in ${field}.`, segment);
  }

  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    fail("INVALID_AMOUNT", `Invalid amount in ${field}.`, segment);
  }

  return Math.round(amount * 100) / 100;
}

function parseOptionalNumber(
  value: string | undefined,
  segment: string,
): number | null {
  if (!value) return null;

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    fail("INVALID_NUMBER", "Invalid numeric value.", segment);
  }

  return parsed;
}

function normalizeDate(value: string | undefined): string | null {
  if (!value || !/^\d{8}$/.test(value)) return null;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function tokenize(rawContent: string): {
  segments: Segment[];
  elementSeparator: string;
  componentSeparator: string;
} {
  const content = rawContent.replace(/^\uFEFF/, "").trim();

  if (!content.startsWith("ISA")) {
    fail("MISSING_ISA", "The file must begin with an ISA segment.");
  }

  const elementSeparator = content[3];

  if (!elementSeparator || content.length < 106) {
    fail("INVALID_ISA", "The ISA interchange header is incomplete.", "ISA");
  }

  const componentSeparator = content[104];
  const segmentTerminator = content[105];

  if (
    !componentSeparator ||
    !segmentTerminator ||
    componentSeparator === elementSeparator ||
    segmentTerminator === elementSeparator
  ) {
    fail("INVALID_ISA", "The ISA separators are invalid.", "ISA");
  }

  const rawSegments = content
    .split(segmentTerminator)
    .map((item) => item.trim())
    .filter(Boolean);

  const segments = rawSegments.map((raw) => {
    const elements = raw.split(elementSeparator);

    return {
      id: elements[0],
      elements,
      raw,
    };
  });

  return { segments, elementSeparator, componentSeparator };
}

function parseAdjustments(
  segment: Segment,
  sequenceStart: number,
): EraAdjustment[] {
  const elements = segment.elements;
  const groupCode = elements[1];

  if (!groupCode) {
    fail("INVALID_CAS", "CAS adjustment group code is missing.", segment.raw);
  }

  const adjustments: EraAdjustment[] = [];

  for (let index = 2; index < elements.length; index += 3) {
    const reasonCode = elements[index];
    if (!reasonCode) continue;

    adjustments.push({
      groupCode,
      reasonCode,
      amount: parseAmount(elements[index + 1], segment.raw, "CAS adjustment"),
      quantity: parseOptionalNumber(elements[index + 2], segment.raw),
      sequence: sequenceStart + adjustments.length,
      rawSegment: segment.raw,
    });
  }

  return adjustments;
}

function parseServiceLine(
  segments: Segment[],
  startIndex: number,
): { line: EraServiceLine; nextIndex: number } {
  const svc = segments[startIndex];
  const elements = svc.elements;
  const procedure = getElement(svc, 1).split(":");

  const line: EraServiceLine = {
    procedureQualifier: procedure[0] || null,
    procedureCode: procedure[1] || null,
    modifiers: procedure.slice(2).filter(Boolean),
    lineChargeAmount: parseAmount(elements[2], svc.raw, "SVC charge"),
    linePaymentAmount: parseAmount(elements[3], svc.raw, "SVC payment"),
    // SVC04 = revenue code; SVC05 = units.
    revenueCode: elements[4] || null,
    units: parseOptionalNumber(elements[5], svc.raw),
    serviceDate: null,
    adjustments: [],
    rawSegments: [svc.raw],
  };

  let index = startIndex + 1;

  while (
    index < segments.length &&
    !["SVC", "CLP", "PLB", "SE"].includes(segments[index].id)
  ) {
    const segment = segments[index];
    line.rawSegments.push(segment.raw);

    if (segment.id === "CAS") {
      line.adjustments.push(
        ...parseAdjustments(segment, line.adjustments.length + 1),
      );
    }

    if (segment.id === "DTM") {
      const qualifier = getElement(segment, 1);

      if (["472", "150", "151"].includes(qualifier)) {
        line.serviceDate = normalizeDate(getElement(segment, 2));
      }
    }

    index += 1;
  }

  return { line, nextIndex: index };
}

export function parseEra835(rawContent: string): Era835ParseResult {
  if (!rawContent || !rawContent.trim()) {
    fail("EMPTY_FILE", "The ERA file is empty.");
  }

  if (rawContent.length > 5_000_000) {
    fail("FILE_TOO_LARGE", "The ERA file exceeds the 5 MB parser limit.");
  }

  const { segments } = tokenize(rawContent);
  const ids = segments.map((segment) => segment.id);

  const isaIndex = ids.indexOf("ISA");
  const ieaIndex = ids.lastIndexOf("IEA");
  const gsIndex = ids.indexOf("GS");
  const geIndex = ids.lastIndexOf("GE");
  const stIndex = ids.indexOf("ST");
  const seIndex = ids.lastIndexOf("SE");

  if (
    isaIndex !== 0 ||
    gsIndex < 0 ||
    stIndex < 0 ||
    seIndex < 0 ||
    geIndex < 0 ||
    ieaIndex < 0
  ) {
    fail(
      "INVALID_ENVELOPE",
      "Required X12 interchange or transaction segments are missing.",
    );
  }

  if (
    ids.filter((id) => id === "GS").length !== 1 ||
    ids.filter((id) => id === "ST").length !== 1 ||
    ids.filter((id) => id === "GE").length !== 1 ||
    ids.filter((id) => id === "IEA").length !== 1
  ) {
    fail(
      "UNSUPPORTED_ENVELOPE_COUNT",
      "This parser version supports one functional group and one 835 transaction per interchange.",
    );
  }

  const isa = segments[isaIndex];
  const gs = segments[gsIndex];
  const st = segments[stIndex];
  const se = segments[seIndex];
  const ge = segments[geIndex];
  const iea = segments[ieaIndex];

  if (getElement(st, 1) !== "835") {
    fail("INVALID_TRANSACTION", "The transaction is not an X12 835.", st.raw);
  }

  if (
    getElement(st, 2) !== getElement(se, 2) ||
    getElement(gs, 6) !== getElement(ge, 2) ||
    getElement(isa, 13) !== getElement(iea, 2)
  ) {
    fail("CONTROL_NUMBER_MISMATCH", "X12 envelope control numbers do not match.");
  }

  if (!(isaIndex < gsIndex && gsIndex < stIndex && stIndex < seIndex &&
    seIndex < geIndex && geIndex < ieaIndex)) {
    fail("INVALID_ENVELOPE_ORDER", "X12 envelope segments are out of order.");
  }

  const transactionSegments = segments.slice(stIndex, seIndex + 1);
  const declaredSegmentCount = Number(getElement(se, 1));

  if (
    !Number.isInteger(declaredSegmentCount) ||
    declaredSegmentCount !== transactionSegments.length
  ) {
    fail(
      "SEGMENT_COUNT_MISMATCH",
      "SE segment count does not match the transaction.",
      se.raw,
    );
  }

  if (Number(getElement(ge, 1)) !== 1 || Number(getElement(iea, 1)) !== 1) {
    fail(
      "ENVELOPE_COUNT_MISMATCH",
      "This parser expects one functional group and one interchange.",
    );
  }

  const bpr = segments.find((segment) => segment.id === "BPR");
  const trn = segments.find((segment) => segment.id === "TRN");

  if (!bpr || !trn) {
    fail("MISSING_PAYMENT", "BPR and TRN payment segments are required.");
  }

  const payment = {
    transactionHandlingCode: getElement(bpr, 1),
    totalPaymentAmount: parseAmount(getElement(bpr, 2), bpr.raw, "BPR payment"),
    creditDebitFlag: getElement(bpr, 3),
    paymentMethodCode: getElement(bpr, 4),
    paymentDate: normalizeDate(getElement(bpr, 16)),
    traceTypeCode: getElement(trn, 1) || null,
    traceNumber: getElement(trn, 2) || null,
    rawSegment: bpr.raw,
  };

  const claims: EraClaim[] = [];
  const providerAdjustments: EraProviderAdjustment[] = [];

  let currentClaim: EraClaim | null = null;
  let currentServiceLine: EraServiceLine | null = null;
  let adjustmentSequence = 0;

  for (let index = stIndex + 1; index < seIndex; index += 1) {
    const segment = segments[index];

    switch (segment.id) {
      case "CLP": {
        const e = segment.elements;

        currentClaim = {
          patientControlNumber: e[1] || "",
          claimStatusCode: e[2] || "",
          totalChargeAmount: parseAmount(e[3], segment.raw, "CLP charge"),
          paymentAmount: parseAmount(e[4], segment.raw, "CLP payment"),
          patientResponsibilityAmount: parseAmount(
            e[5],
            segment.raw,
            "CLP patient responsibility",
          ),
          payerClaimControlNumber: e[7] || null,
          // CLP08 = facility code; CLP09 = claim frequency code.
          facilityCode: e[8] || null,
          claimFrequencyCode: e[9] || null,
          statementFromDate: null,
          statementThroughDate: null,
          serviceLines: [],
          adjustments: [],
          rawSegments: [segment.raw],
        };

        if (!currentClaim.patientControlNumber || !currentClaim.claimStatusCode) {
          fail(
            "INVALID_CLP",
            "CLP patient control number or status is missing.",
            segment.raw,
          );
        }

        claims.push(currentClaim);
        currentServiceLine = null;
        adjustmentSequence = 0;
        break;
      }

      case "SVC": {
        if (!currentClaim) {
          fail("SVC_WITHOUT_CLAIM", "SVC encountered before a CLP claim.", segment.raw);
        }

        const parsed = parseServiceLine(segments, index);
        currentServiceLine = parsed.line;
        currentClaim.serviceLines.push(parsed.line);
        currentClaim.rawSegments.push(...parsed.line.rawSegments);
        index = parsed.nextIndex - 1;
        break;
      }

      case "CAS": {
        if (!currentClaim) {
          fail("CAS_WITHOUT_CLAIM", "CAS encountered before a CLP claim.", segment.raw);
        }

        const adjustments = parseAdjustments(segment, adjustmentSequence + 1);
        adjustmentSequence += adjustments.length;

        if (currentServiceLine) {
          currentServiceLine.adjustments.push(...adjustments);
          currentServiceLine.rawSegments.push(segment.raw);
        } else {
          currentClaim.adjustments.push(...adjustments);
          currentClaim.rawSegments.push(segment.raw);
        }
        break;
      }

      case "DTM": {
        if (!currentClaim) break;

        const qualifier = getElement(segment, 1);
        const date = normalizeDate(getElement(segment, 2));

        if (qualifier === "232") currentClaim.statementFromDate = date;
        if (qualifier === "233") currentClaim.statementThroughDate = date;
        break;
      }

      case "PLB": {
        const e = segment.elements;
        const providerIdentifier = e[1] || "";
        const fiscalPeriodDate = normalizeDate(e[2]);

        for (let position = 3; position < e.length; position += 2) {
          const pair = e[position] || "";
          if (!pair) continue;

          const reasonCode = pair.slice(0, 2);
          const reference = pair.slice(2) || null;

          providerAdjustments.push({
            providerIdentifierQualifier: null,
            providerIdentifier,
            fiscalPeriodDate,
            reasonCode: reference ? `${reasonCode}:${reference}` : reasonCode,
            amount: parseAmount(
              e[position + 1],
              segment.raw,
              "PLB adjustment",
            ),
            rawSegment: segment.raw,
          });
        }
        break;
      }

      default:
        break;
    }
  }

  if (claims.length === 0) {
    fail("NO_CLAIMS", "No CLP claim segments were found.");
  }

  return {
    envelope: {
      interchangeControlNumber: getElement(isa, 13),
      functionalGroupControlNumber: getElement(gs, 6),
      transactionControlNumber: getElement(st, 2),
      senderId: getElement(isa, 6).trim(),
      receiverId: getElement(isa, 8).trim(),
      transactionCount: 1,
    },
    payment,
    claims,
    providerAdjustments,
    segmentCount: transactionSegments.length,
    rawContent,
  };
}