/**
 * Promotion domain rule error. The code is the machine-readable contract the
 * REST boundary maps onto the shared `code/message/details` error shape; callers
 * branch on the code and never on the human message.
 */
export class PromotionRuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "PromotionRuleError";
  }
}

export const PROMOTION_ERROR_CODES = [
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "ACCESS_DENIED",
  "STATE_CONFLICT",
  "VERSION_CONFLICT",
  "SELF_APPROVAL_FORBIDDEN",
  "OVERLAPPING_PUBLISHED_VERSION",
  "IDEMPOTENCY_CONFLICT",
  "IDEMPOTENCY_IN_PROGRESS",
  "ENTITLEMENT_NOT_ELIGIBLE",
  "ENTITLEMENT_ALREADY_GRANTED",
  "ENTITLEMENT_NOT_ACTIVE",
  "ENTITLEMENT_EXPIRED",
  "TURNOVER_ENTITLEMENT_MISMATCH",
  "TURNOVER_STATE_CONFLICT",
  "TURNOVER_RELEASE_UNAVAILABLE",
  "NOTIFICATION_PREFERENCE_MANDATORY",
] as const;

export type PromotionErrorCode = (typeof PROMOTION_ERROR_CODES)[number];
