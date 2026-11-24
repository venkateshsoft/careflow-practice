
export interface EraEnvelope {
  interchangeControlNumber: string;
  functionalGroupControlNumber: string;
  transactionControlNumber: string;
  senderId: string;
  receiverId: string;
  transactionCount: number;
}

export interface EraPayment {
  transactionHandlingCode: string;
  totalPaymentAmount: number;
  creditDebitFlag: string;
  paymentMethodCode: string;
  paymentDate: string | null;
  traceTypeCode: string | null;
  traceNumber: string | null;
  rawSegment: string;
}

export interface EraClaim {
  patientControlNumber: string;
  claimStatusCode: string;
  totalChargeAmount: number;
  paymentAmount: number;
  patientResponsibilityAmount: number;
  payerClaimControlNumber: string | null;
  facilityCode: string | null;
  claimFrequencyCode: string | null;
  statementFromDate: string | null;
  statementThroughDate: string | null;
  serviceLines: EraServiceLine[];
  adjustments: EraAdjustment[];
  rawSegments: string[];
}

export interface EraServiceLine {
  procedureQualifier: string | null;
  procedureCode: string | null;
  modifiers: string[];
  lineChargeAmount: number;
  linePaymentAmount: number;
  revenueCode: string | null;
  units: number | null;
  serviceDate: string | null;
  adjustments: EraAdjustment[];
  rawSegments: string[];
}

export interface EraAdjustment {
  groupCode: string;
  reasonCode: string;
  amount: number;
  quantity: number | null;
  sequence: number;
  rawSegment: string;
}

export interface EraProviderAdjustment {
  providerIdentifierQualifier: string | null;
  providerIdentifier: string | null;
  fiscalPeriodDate: string | null;
  reasonCode: string;
  amount: number;
  rawSegment: string;
}

export interface Era835ParseResult {
  envelope: EraEnvelope;
  payment: EraPayment;
  claims: EraClaim[];
  providerAdjustments: EraProviderAdjustment[];
  segmentCount: number;
  rawContent: string;
}

export interface EraParserError {
  code: string;
  message: string;
  segment?: string;
}

export class Era835ParseException extends Error {
  readonly code: string;
  readonly segment?: string;

  constructor(error: EraParserError) {
    super(error.message);
    this.name = "Era835ParseException";
    this.code = error.code;
    this.segment = error.segment;
  }
}