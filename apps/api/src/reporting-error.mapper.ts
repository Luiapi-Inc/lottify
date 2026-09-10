import { HttpException, HttpStatus } from "@nestjs/common";
import { ReportingRuleError } from "../../../src/contexts/reporting/reporting-rule-error";
import { currentCorrelationId } from "./correlation";

/**
 * Maps a Reporting read-model rule failure onto the shared API error contract
 * (`code` / `message` / `details` / `correlationId`). Reporting owns no financial
 * authority, so there are no state-transition codes here.
 */
export function reportingHttpException(error: ReportingRuleError): HttpException {
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
