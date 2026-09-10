export const AUDIT_RULE_ERROR_CODES = [
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "EVIDENCE_MALFORMED",
] as const;
export type AuditRuleErrorCode = (typeof AUDIT_RULE_ERROR_CODES)[number];

/**
 * Audit read-model rule violation. Audit owns no mutation authority, so these
 * are contract/freshness violations rather than domain state transitions.
 */
export class AuditRuleError extends Error {
  constructor(
    readonly code: AuditRuleErrorCode,
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AuditRuleError";
  }
}
