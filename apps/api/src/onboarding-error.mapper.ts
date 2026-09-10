import { HttpException, HttpStatus } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  OnboardingRuleError,
  type OnboardingErrorCode,
} from "../../../src/contexts/member/domain/onboarding-error";
import { currentCorrelationId } from "./correlation";

/**
 * Canonical HTTP mapping for Member onboarding rule failures. The wire shape is
 * the repository-wide `{ code, message, details, correlationId }` error body, so
 * a denial is always an explicit coded reason rather than a generic failure.
 */
const STATUS_BY_CODE: Record<OnboardingErrorCode, HttpStatus> = {
  VALIDATION_ERROR: HttpStatus.BAD_REQUEST,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  STATE_CONFLICT: HttpStatus.CONFLICT,
  VERSION_CONFLICT: HttpStatus.CONFLICT,
  SELF_APPROVAL_FORBIDDEN: HttpStatus.FORBIDDEN,
  OVERLAPPING_PUBLISHED_VERSION: HttpStatus.CONFLICT,
  TERMS_VERSION_NOT_REQUIRED: HttpStatus.CONFLICT,
  IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
  IDEMPOTENCY_IN_PROGRESS: HttpStatus.CONFLICT,
  MEMBER_NOT_ACTIVE: HttpStatus.FORBIDDEN,
};

export function onboardingHttpException(error: OnboardingRuleError): HttpException {
  return new HttpException(
    {
      code: error.code,
      message: error.message,
      details: error.details,
      correlationId: currentCorrelationId() ?? randomUUID(),
    },
    STATUS_BY_CODE[error.code] ?? HttpStatus.BAD_REQUEST,
  );
}

export function toOnboardingHttp(error: unknown): unknown {
  if (error instanceof OnboardingRuleError) return onboardingHttpException(error);
  if (error instanceof HttpException) return error;
  return error;
}
