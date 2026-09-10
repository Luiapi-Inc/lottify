export const ADMIN_APPROVAL_RULE_ERROR_CODES = [
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "EVIDENCE_MALFORMED",
] as const;
export type AdminApprovalRuleErrorCode = (typeof ADMIN_APPROVAL_RULE_ERROR_CODES)[number];

/**
 * Admin approval read-model rule violation. The approvals surface reads the
 * immutable AdminApprovalEvidence model and owns no approval-workflow authority,
 * so these are contract violations rather than approval state transitions.
 */
export class AdminApprovalRuleError extends Error {
  constructor(
    readonly code: AdminApprovalRuleErrorCode,
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AdminApprovalRuleError";
  }
}
