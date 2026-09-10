import { HttpException, HttpStatus } from "@nestjs/common";
import { AdminApprovalRuleError } from "../../../src/contexts/admin-approval/admin-approval-rule-error";
import { currentCorrelationId } from "./correlation";

/**
 * Maps an Admin approval read-model rule failure onto the shared API error
 * contract (`code` / `message` / `details` / `correlationId`). The approvals
 * surface reads immutable evidence and owns no approval-workflow authority, so
 * there are no approval state-transition codes here.
 */
export function adminApprovalHttpException(error: AdminApprovalRuleError): HttpException {
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
