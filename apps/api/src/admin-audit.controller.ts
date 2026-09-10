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
  AuditInspectionService,
  type AuditRecordInspection,
} from "../../../src/contexts/audit/audit-inspection.service";
import { AuditRuleError } from "../../../src/contexts/audit/audit-rule-error";
import { AdminAuthGuard, type AdminAuthenticatedRequest } from "./admin-auth.guard";
import {
  AdminCapabilityGuard,
  RequireAdminCapabilities,
} from "./admin-capability.guard";
import { currentCorrelationId } from "./correlation";
import { auditHttpException } from "./audit-error.mapper";

class AuditActorReferenceResponse {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string;

  @ApiProperty({ type: String, format: "email" })
  email!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ enum: ["SUPER_ADMIN", "ADMIN", "AUDITOR"] })
  role!: string;
}

class AuditLinkedReauthResponse {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string;

  @ApiProperty({ type: String })
  actionClass!: string;

  @ApiProperty({ type: String, format: "date-time" })
  verifiedAt!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  expiresAt!: Date;
}

class AuditLinkedApprovalResponse {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string;

  @ApiProperty({ type: String })
  action!: string;

  @ApiProperty({ type: String })
  resourceType!: string;

  @ApiProperty({ type: String, format: "uuid" })
  resourceId!: string;

  @ApiProperty({ type: String, format: "uuid" })
  requesterAdminId!: string;

  @ApiProperty({ type: String, format: "uuid" })
  approverAdminId!: string;

  @ApiProperty({ type: String, format: "date-time" })
  approvedAt!: Date;
}

class AuditRecordResponse {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string;

  @ApiProperty({ type: String, format: "uuid" })
  actorAdminId!: string;

  @ApiProperty({ type: String, description: "Actor role at the time of the action" })
  actorRole!: string;

  @ApiProperty({ type: String, format: "uuid" })
  sessionId!: string;

  @ApiProperty({ type: String, description: "Audited Admin action" })
  action!: string;

  @ApiProperty({ type: String, description: "Target resource type of the audited action" })
  resourceType!: string;

  @ApiProperty({ type: String, format: "uuid" })
  resourceId!: string;

  @ApiProperty({ type: String, description: "Immutable SHA-256 hash of the action payload" })
  payloadHash!: string;

  @ApiProperty({ type: String })
  reason!: string;

  @ApiProperty({ type: String, format: "uuid", nullable: true })
  reauthEvidenceId!: string | null;

  @ApiProperty({ type: String, format: "uuid", nullable: true })
  approvalId!: string | null;

  @ApiProperty({ type: String, description: "Stable correlation identity across the workflow" })
  correlationId!: string;

  @ApiProperty({ type: String, description: "Audited action outcome" })
  outcome!: string;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ type: AuditActorReferenceResponse })
  actor!: AuditActorReferenceResponse;

  @ApiProperty({ type: AuditLinkedReauthResponse, nullable: true })
  reauthEvidence!: AuditLinkedReauthResponse | null;

  @ApiProperty({ type: AuditLinkedApprovalResponse, nullable: true })
  approval!: AuditLinkedApprovalResponse | null;
}

class AuditRecordListResponse {
  @ApiProperty({ type: [AuditRecordResponse] })
  items!: readonly AuditRecordResponse[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;

  @ApiProperty({ type: String, format: "date-time", description: "Audit data-freshness instant" })
  dataAsOf!: Date;
}

@ApiTags("admin-audit")
@ApiBearerAuth()
@Controller("api/v1/admin/audit")
@UseGuards(AdminAuthGuard, AdminCapabilityGuard)
export class AdminAuditController {
  constructor(
    @Inject(AuditInspectionService)
    private readonly audit: AuditInspectionService,
  ) {}

  @Get("records")
  @RequireAdminCapabilities("audit.read")
  @ApiOperation({
    summary: "List immutable audit records with actor/action/resource/outcome and evidence references",
  })
  @ApiQuery({ name: "actor", required: false, type: String, description: "Admin actor id" })
  @ApiQuery({ name: "action", required: false, type: String })
  @ApiQuery({ name: "resourceType", required: false, type: String })
  @ApiQuery({ name: "resourceId", required: false, type: String })
  @ApiQuery({ name: "outcome", required: false, type: String })
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
  @ApiOkResponse({ type: AuditRecordListResponse })
  @ApiUnauthorizedResponse({ description: "AUTHENTICATION_REQUIRED" })
  @ApiForbiddenResponse({ description: "ACCESS_DENIED" })
  @ApiBadRequestResponse({ description: "VALIDATION_ERROR" })
  async listRecords(
    @Req() request: AdminAuthenticatedRequest,
    @Query("actor") actor?: string,
    @Query("action") action?: string,
    @Query("resourceType") resourceType?: string,
    @Query("resourceId") resourceId?: string,
    @Query("outcome") outcome?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ): Promise<AuditRecordListResponse> {
    try {
      const page = await this.audit.listAuditRecords({
        actor: trimmed(actor),
        action: trimmed(action),
        resourceType: trimmed(resourceType),
        resourceId: trimmed(resourceId),
        outcome: trimmed(outcome),
        from: parseInstant(from, "from", request),
        to: parseInstant(to, "to", request),
        limit: parseLimit(limit, request),
        cursor: trimmed(cursor),
      });
      return {
        items: page.items.map(toAuditRecordResponse),
        nextCursor: page.nextCursor,
        dataAsOf: page.dataAsOf,
      };
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Get("records/:id")
  @RequireAdminCapabilities("audit.read")
  @ApiOperation({ summary: "Read one audit record with actor and linked reauth/approval evidence" })
  @ApiOkResponse({ type: AuditRecordResponse })
  @ApiUnauthorizedResponse({ description: "AUTHENTICATION_REQUIRED" })
  @ApiForbiddenResponse({ description: "ACCESS_DENIED" })
  @ApiNotFoundResponse({ description: "NOT_FOUND" })
  async getRecord(@Param("id") id: string): Promise<AuditRecordResponse> {
    try {
      return toAuditRecordResponse(await this.audit.getAuditRecord(id));
    } catch (error) {
      throw toHttp(error);
    }
  }
}

export function toAuditRecordResponse(record: AuditRecordInspection): AuditRecordResponse {
  return {
    id: record.id,
    actorAdminId: record.actorAdminId,
    actorRole: record.actorRole,
    sessionId: record.sessionId,
    action: record.action,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    payloadHash: record.payloadHash,
    reason: record.reason,
    reauthEvidenceId: record.reauthEvidenceId,
    approvalId: record.approvalId,
    correlationId: record.correlationId,
    outcome: record.outcome,
    createdAt: record.createdAt,
    actor: {
      id: record.actor.id,
      email: record.actor.email,
      name: record.actor.name,
      role: record.actor.role,
    },
    reauthEvidence: record.reauthEvidence
      ? {
          id: record.reauthEvidence.id,
          actionClass: record.reauthEvidence.actionClass,
          verifiedAt: record.reauthEvidence.verifiedAt,
          expiresAt: record.reauthEvidence.expiresAt,
        }
      : null,
    approval: record.approval
      ? {
          id: record.approval.id,
          action: record.approval.action,
          resourceType: record.approval.resourceType,
          resourceId: record.approval.resourceId,
          requesterAdminId: record.approval.requesterAdminId,
          approverAdminId: record.approval.approverAdminId,
          approvedAt: record.approval.approvedAt,
        }
      : null,
  };
}

function toHttp(error: unknown): unknown {
  if (error instanceof AuditRuleError) return auditHttpException(error);
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
