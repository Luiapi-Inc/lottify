import { HttpException, HttpStatus } from "@nestjs/common";
import { AuditRuleError } from "../../../src/contexts/audit/audit-rule-error";
import { currentCorrelationId } from "./correlation";

/**
 * Maps an Audit read-model rule failure onto the shared API error contract
 * (`code` / `message` / `details` / `correlationId`). Audit owns no mutation
 * authority, so there are no state-transition codes here.
 */
export function auditHttpException(error: AuditRuleError): HttpException {
  const status =
    error.code === "NOT_FOUND"
      ? HttpStatus.NOT_FOUND
      : error.code === "EVIDENCE_MALFORMED"
        ? HttpStatus.INTERNAL_SERVER_ERROR
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
