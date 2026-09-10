export const REPORTING_RULE_ERROR_CODES = [
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "UNSUPPORTED_REPORTING_TIME_ZONE",
  "EVIDENCE_MALFORMED",
] as const;
export type ReportingRuleErrorCode = (typeof REPORTING_RULE_ERROR_CODES)[number];

/**
 * Reporting read-model rule violation. Reporting owns no financial authority, so
 * these are contract/freshness violations rather than domain state transitions.
 */
export class ReportingRuleError extends Error {
  constructor(
    readonly code: ReportingRuleErrorCode,
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ReportingRuleError";
  }
}
