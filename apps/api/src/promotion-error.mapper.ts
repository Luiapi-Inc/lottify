import { HttpException, HttpStatus } from "@nestjs/common";
import { PromotionRuleError } from "../../../src/contexts/promotion/domain/rule-error";
import { currentCorrelationId } from "./correlation";

const CONFLICT_CODES: readonly string[] = [
  "VERSION_CONFLICT",
  "STATE_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "IDEMPOTENCY_IN_PROGRESS",
  "OVERLAPPING_PUBLISHED_VERSION",
  "ENTITLEMENT_ALREADY_GRANTED",
  "ENTITLEMENT_NOT_ELIGIBLE",
  "TURNOVER_STATE_CONFLICT",
];

const FORBIDDEN_CODES: readonly string[] = ["ACCESS_DENIED", "SELF_APPROVAL_FORBIDDEN"];

/** Maps a Promotion domain rule failure onto the shared API error contract. */
export function promotionHttpException(error: PromotionRuleError): HttpException {
  const status = CONFLICT_CODES.includes(error.code)
    ? HttpStatus.CONFLICT
    : FORBIDDEN_CODES.includes(error.code)
      ? HttpStatus.FORBIDDEN
      : error.code === "NOT_FOUND"
        ? HttpStatus.NOT_FOUND
        : HttpStatus.BAD_REQUEST;
  return new HttpException(
    {
      code: error.code,
      message: error.message,
      details: error.details,
      correlationId: currentCorrelationId() ?? "unknown",
    },
    status,
  );
}
