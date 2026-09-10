import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import {
  ADMIN_APPROVAL_STATES,
  AdminApprovalInspectionService,
  type AdminApprovalInspection,
} from "../../../src/contexts/admin-approval/admin-approval-inspection.service";
import { AdminApprovalRuleError } from "../../../src/contexts/admin-approval/admin-approval-rule-error";
import { AdminAuthGuard, type AdminAuthenticatedRequest } from "./admin-auth.guard";
import {
  AdminCapabilityGuard,
  RequireAdminCapabilities,
} from "./admin-capability.guard";
import { currentCorrelationId } from "./correlation";
import { adminApprovalHttpException } from "./admin-approval-error.mapper";

class AdminApprovalPrincipalResponse {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string;

  @ApiProperty({ type: String, format: "email" })
  email!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ enum: ["SUPER_ADMIN", "ADMIN", "AUDITOR"] })
  role!: string;
}

class AdminApprovalReauthResponse {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string;

  @ApiProperty({ type: String })
  actionClass!: string;

  @ApiProperty({ type: String, format: "date-time" })
  verifiedAt!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  expiresAt!: Date;
}

class AdminApprovalLinkedAuditResponse {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string;

  @ApiProperty({ type: String })
  outcome!: string;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;
}

class AdminApprovalResponse {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string;

  @ApiProperty({ type: String, description: "Approved target action" })
  action!: string;

  @ApiProperty({ type: String, description: "Target resource type of the approved action" })
  resourceType!: string;

  @ApiProperty({ type: String, format: "uuid" })
  resourceId!: string;

  @ApiProperty({ type: String, format: "uuid" })
  requesterAdminId!: string;

  @ApiProperty({ type: String, format: "uuid" })
  approverAdminId!: string;

  @ApiProperty({ type: Number, description: "Resource version the approval was granted against" })
  requestedVersion!: number;

  @ApiProperty({ type: String, description: "Immutable SHA-256 hash of the approved payload" })
  payloadHash!: string;

  @ApiProperty({ type: String })
  reason!: string;

  @ApiProperty({ type: String, description: "Approval policy version applied" })
  policyVersion!: string;

  @ApiProperty({ type: String, format: "uuid" })
  reauthEvidenceId!: string;

  @ApiProperty({ type: String })
  correlationId!: string;

  @ApiProperty({ type: String, format: "date-time" })
  approvedAt!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;

  @ApiProperty({
    enum: [...ADMIN_APPROVAL_STATES],
    description:
      "Every AdminApprovalEvidence record is created atomically with a required approvedAt, so its immutable state is APPROVED",
  })
  state!: string;

  @ApiProperty({ type: Number, minimum: 0, description: "Queue age evaluated against `dataAsOf`" })
  ageMs!: number;

  @ApiProperty({ type: AdminApprovalPrincipalResponse })
  requester!: AdminApprovalPrincipalResponse;

  @ApiProperty({ type: AdminApprovalPrincipalResponse })
  approver!: AdminApprovalPrincipalResponse;

  @ApiProperty({ type: AdminApprovalReauthResponse })
  reauthEvidence!: AdminApprovalReauthResponse;

  @ApiProperty({ type: [AdminApprovalLinkedAuditResponse], description: "Audit records this approval produced" })
  auditRecords!: readonly AdminApprovalLinkedAuditResponse[];
}

class AdminApprovalListResponse {
  @ApiProperty({ type: [AdminApprovalResponse] })
  items!: readonly AdminApprovalResponse[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;

  @ApiProperty({ type: String, format: "date-time", description: "Approval data-freshness instant" })
  dataAsOf!: Date;
}

@ApiTags("admin-approvals")
@ApiBearerAuth()
@Controller("api/v1/admin/approvals")
@UseGuards(AdminAuthGuard, AdminCapabilityGuard)
export class AdminApprovalController {
  constructor(
    @Inject(AdminApprovalInspectionService)
    private readonly approvals: AdminApprovalInspectionService,
  ) {}

  @Get()
  @RequireAdminCapabilities("approval.read")
  @ApiOperation({
    summary: "List the immutable Admin approval work queue with requester/target/state/age and evidence",
  })
  @ApiQuery({
    name: "state",
    required: false,
    enum: [...ADMIN_APPROVAL_STATES],
    description: "Approval evidence state (the durable model only persists granted approvals)",
  })
  @ApiQuery({ name: "action", required: false, type: String, description: "Target action filter" })
  @ApiQuery({ name: "resourceType", required: false, type: String })
  @ApiQuery({ name: "resourceId", required: false, type: String })
  @ApiQuery({
    name: "from",
    required: false,
    type: String,
    description: "Inclusive lower bound of the half-open `createdAt` window",
  })
  @ApiQuery({
    name: "to",
    required: false,
    type: String,
    description: "Exclusive upper bound of the half-open `createdAt` window",
  })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiOkResponse({ type: AdminApprovalListResponse })
  @ApiUnauthorizedResponse({ description: "AUTHENTICATION_REQUIRED" })
  @ApiForbiddenResponse({ description: "ACCESS_DENIED" })
  @ApiBadRequestResponse({ description: "VALIDATION_ERROR" })
  async listApprovals(
    @Req() request: AdminAuthenticatedRequest,
    @Query("state") state?: string,
    @Query("action") action?: string,
    @Query("resourceType") resourceType?: string,
    @Query("resourceId") resourceId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ): Promise<AdminApprovalListResponse> {
    try {
      const page = await this.approvals.listApprovals({
        state: trimmed(state),
        action: trimmed(action),
        resourceType: trimmed(resourceType),
        resourceId: trimmed(resourceId),
        from: parseInstant(from, "from", request),
        to: parseInstant(to, "to", request),
        limit: parseLimit(limit, request),
        cursor: trimmed(cursor),
      });
      return {
        items: page.items.map(toAdminApprovalResponse),
        nextCursor: page.nextCursor,
        dataAsOf: page.dataAsOf,
      };
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Get(":id")
  @RequireAdminCapabilities("approval.read")
  @ApiOperation({ summary: "Read one approval evidence record with requester/approver and linked audit" })
  @ApiOkResponse({ type: AdminApprovalResponse })
  @ApiUnauthorizedResponse({ description: "AUTHENTICATION_REQUIRED" })
  @ApiForbiddenResponse({ description: "ACCESS_DENIED" })
  @ApiNotFoundResponse({ description: "NOT_FOUND" })
  async getApproval(@Param("id") id: string): Promise<AdminApprovalResponse> {
    try {
      return toAdminApprovalResponse(await this.approvals.getApproval(id));
    } catch (error) {
      throw toHttp(error);
    }
  }
}

export function toAdminApprovalResponse(
  approval: AdminApprovalInspection,
): AdminApprovalResponse {
  return {
    id: approval.id,
    action: approval.action,
    resourceType: approval.resourceType,
    resourceId: approval.resourceId,
    requesterAdminId: approval.requesterAdminId,
    approverAdminId: approval.approverAdminId,
    requestedVersion: approval.requestedVersion,
    payloadHash: approval.payloadHash,
    reason: approval.reason,
    policyVersion: approval.policyVersion,
    reauthEvidenceId: approval.reauthEvidenceId,
    correlationId: approval.correlationId,
    approvedAt: approval.approvedAt,
    createdAt: approval.createdAt,
    state: approval.state,
    ageMs: approval.ageMs,
    requester: {
      id: approval.requester.id,
      email: approval.requester.email,
      name: approval.requester.name,
      role: approval.requester.role,
    },
    approver: {
      id: approval.approver.id,
      email: approval.approver.email,
      name: approval.approver.name,
      role: approval.approver.role,
    },
    reauthEvidence: {
      id: approval.reauthEvidence.id,
      actionClass: approval.reauthEvidence.actionClass,
      verifiedAt: approval.reauthEvidence.verifiedAt,
      expiresAt: approval.reauthEvidence.expiresAt,
    },
    auditRecords: approval.auditRecords.map((record) => ({
      id: record.id,
      outcome: record.outcome,
      createdAt: record.createdAt,
    })),
  };
}

function toHttp(error: unknown): unknown {
  if (error instanceof AdminApprovalRuleError) return adminApprovalHttpException(error);
  if (error instanceof HttpException) return error;
  return error;
}

function trimmed(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  return candidate ? candidate : undefined;
}

function parseInstant(
  value: string | undefined,
  field: string,
  request: AdminAuthenticatedRequest,
): Date | undefined {
  const candidate = trimmed(value);
  if (!candidate) return undefined;
  const instant = new Date(candidate);
  if (!Number.isFinite(instant.getTime())) {
    throw apiError(request, `${field} must be an RFC 3339 timestamp`, { field });
  }
  return instant;
}

function parseLimit(value: string | undefined, request: AdminAuthenticatedRequest): number | undefined {
  const candidate = trimmed(value);
  if (!candidate) return undefined;
  const parsed = Number(candidate);
  if (!Number.isInteger(parsed)) {
    throw apiError(request, "limit must be an integer", { field: "limit" });
  }
  return parsed;
}

function apiError(
  request: AdminAuthenticatedRequest,
  message: string,
  details: Record<string, unknown>,
): HttpException {
  void request;
  return new HttpException(
    {
      code: "VALIDATION_ERROR",
      message,
      details,
      correlationId: currentCorrelationId() ?? "unknown",
    },
    HttpStatus.BAD_REQUEST,
  );
}
