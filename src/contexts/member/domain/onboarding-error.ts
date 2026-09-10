/**
 * Member onboarding rule error — the single error type raised by the Member
 * onboarding domain (Terms documents, Terms acceptance, Member profile).
 *
 * The HTTP status is a presentation concern and is mapped in the API layer
 * (`apps/api/src/onboarding-error.mapper.ts`), so the domain stays transport
 * agnostic. Ticket 06 keeps Member readiness capability-based, so a denial is
 * always an explicit, coded reason rather than a generic failure.
 */
export type OnboardingErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "STATE_CONFLICT"
  | "VERSION_CONFLICT"
  | "SELF_APPROVAL_FORBIDDEN"
  | "OVERLAPPING_PUBLISHED_VERSION"
  | "TERMS_VERSION_NOT_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "MEMBER_NOT_ACTIVE";

export class OnboardingRuleError extends Error {
  readonly code: OnboardingErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: OnboardingErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "OnboardingRuleError";
    this.code = code;
    this.details = details;
  }
}
