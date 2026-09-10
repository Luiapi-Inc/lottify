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
  RECONCILIATION_CURRENCIES,
  RECONCILIATION_DISCREPANCY_OUTCOMES,
  RECONCILIATION_DISCREPANCY_SEVERITIES,
  RECONCILIATION_DISCREPANCY_STATUSES,
  RECONCILIATION_PAIR,
  RECONCILIATION_RESULTS,
  ReconciliationInspectionService,
  type ReconciliationDiscrepancyFacts,
  type ReconciliationDiscrepancyInspection,
  type ReconciliationDiscrepancySourceReferences,
  type ReconciliationRunInspection,
} from "../../../src/contexts/reporting/reconciliation-inspection.service";
import { ReportingRuleError } from "../../../src/contexts/reporting/reporting-rule-error";
import { AdminAuthGuard, type AdminAuthenticatedRequest } from "./admin-auth.guard";
import {
  AdminCapabilityGuard,
  RequireAdminCapabilities,
} from "./admin-capability.guard";
import { currentCorrelationId } from "./correlation";
import { reportingHttpException } from "./reporting-error.mapper";

class ReconciliationSourceRangeResponse {
  @ApiProperty({
    type: Object,
    description: "Half-open inspected Ledger posting window, expressed as an upper bound",
  })
  ledgerPostedAt!: { through: string };

  @ApiProperty({
    type: Object,
    description: "Half-open inspected Reservation lifecycle window, expressed as an upper bound",
  })
  reservationLifecycle!: { through: string };
}

class ReconciliationSourceCheckpointResponse {
  @ApiProperty({ type: String })
  checkpointKey!: string;

  @ApiProperty({ type: String, format: "uuid" })
  memberId!: string;

  @ApiProperty({ enum: [...RECONCILIATION_CURRENCIES] })
  currency!: string;

  @ApiProperty({ type: String, format: "date-time" })
  asOf!: string;

  @ApiProperty({ type: String, nullable: true })
  latestLedgerPostingId!: string | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  latestLedgerPostingAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  latestReservationId!: string | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  latestReservationCreatedAt!: string | null;
}

class ReconciliationInspectedCountsResponse {
  @ApiProperty({ type: Number, minimum: 0 })
  ledgerAccounts!: number;

  @ApiProperty({ type: Number, minimum: 0 })
  ledgerPostings!: number;

  @ApiProperty({ type: Number, minimum: 0 })
  activeReservationAllocations!: number;

  @ApiProperty({ type: Number, minimum: 0 })
  walletBuckets!: number;

  @ApiProperty({ type: Number, minimum: 0 })
  discrepancies!: number;
}

class ReconciliationTotalsResponse {
  @ApiProperty({
    type: Object,
    additionalProperties: { type: "string" },
    description: "Integer minor units per bucket metric, expected by the authoritative Ledger",
  })
  expected!: Record<string, string>;

  @ApiProperty({
    type: Object,
    additionalProperties: { type: "string" },
    description: "Integer minor units per bucket metric observed from the Wallet projection",
  })
  observed!: Record<string, string>;

  @ApiProperty({
    type: Object,
    additionalProperties: { type: "string" },
    description: "observed - expected, integer minor units per bucket metric",
  })
  difference!: Record<string, string>;
}

class ReconciliationResultSummaryResponse {
  @ApiProperty({ type: Boolean })
  matched!: boolean;

  @ApiProperty({ type: Number, minimum: 0 })
  discrepancyCount!: number;

  @ApiProperty({ type: Number, minimum: 0 })
  bucketCount!: number;
}

export class ReconciliationRunResponse {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string;

  @ApiProperty({ enum: [RECONCILIATION_PAIR] })
  pair!: string;

  @ApiProperty({ type: String })
  checkpointKey!: string;

  @ApiProperty({ type: String, format: "uuid" })
  memberId!: string;

  @ApiProperty({ enum: [...RECONCILIATION_CURRENCIES] })
  currency!: string;

  @ApiProperty({ type: String, format: "date-time", description: "Snapshot instant the run inspected" })
  asOf!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ type: ReconciliationSourceRangeResponse })
  sourceRange!: ReconciliationSourceRangeResponse;

  @ApiProperty({ type: ReconciliationSourceCheckpointResponse })
  sourceCheckpoint!: ReconciliationSourceCheckpointResponse;

  @ApiProperty({ type: ReconciliationInspectedCountsResponse })
  inspectedCounts!: ReconciliationInspectedCountsResponse;

  @ApiProperty({ type: ReconciliationTotalsResponse })
  totals!: ReconciliationTotalsResponse;

  @ApiProperty({ enum: [...RECONCILIATION_RESULTS] })
  result!: string;

  @ApiProperty({ type: ReconciliationResultSummaryResponse })
  resultSummary!: ReconciliationResultSummaryResponse;

  @ApiProperty({ type: Number, minimum: 0 })
  discrepancyCount!: number;
}

class ReconciliationRunListResponse {
  @ApiProperty({ type: [ReconciliationRunResponse] })
  items!: readonly ReconciliationRunResponse[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;

  @ApiProperty({ type: String, format: "date-time", description: "Report data-freshness instant" })
  dataAsOf!: Date;
}

class ReconciliationDiscrepancyFactsResponse {
  @ApiProperty({ type: String, format: "uuid" })
  memberId!: string;

  @ApiProperty({ enum: [...RECONCILIATION_CURRENCIES] })
  currency!: string;

  @ApiProperty({ type: String, description: "Wallet bucket the difference was observed in" })
  bucket!: string;

  @ApiProperty({ type: String, description: "Compared metric" })
  metric!: string;

  @ApiProperty({ type: String, description: "Integer minor units on this side of the comparison" })
  amountMinor!: string;
}

class ReconciliationDiscrepancySourceReferencesResponse {
  @ApiProperty({ enum: [RECONCILIATION_PAIR] })
  pair!: string;

  @ApiProperty({ type: String })
  checkpointKey!: string;

  @ApiProperty({ type: String, format: "uuid" })
  memberId!: string;

  @ApiProperty({ type: String, nullable: true })
  ledgerAccountId!: string | null;
}

class ReconciliationDiscrepancyResponse {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string;

  @ApiProperty({ type: String, format: "uuid" })
  reconciliationRunId!: string;

  @ApiProperty({ enum: [RECONCILIATION_PAIR] })
  pair!: string;

  @ApiProperty({ type: String, description: "Bucket:metric identity inside the run" })
  identityKey!: string;

  @ApiProperty({ type: String, format: "uuid" })
  memberId!: string;

  @ApiProperty({ enum: [...RECONCILIATION_CURRENCIES] })
  currency!: string;

  @ApiProperty({
    enum: [...RECONCILIATION_DISCREPANCY_STATUSES],
    description: "DETECTED → INVESTIGATING → RESOLUTION_PENDING → RESOLVED",
  })
  status!: string;

  @ApiProperty({ enum: [...RECONCILIATION_DISCREPANCY_SEVERITIES] })
  severity!: string;

  @ApiProperty({ type: ReconciliationDiscrepancyFactsResponse })
  expectedFacts!: ReconciliationDiscrepancyFactsResponse;

  @ApiProperty({ type: ReconciliationDiscrepancyFactsResponse })
  observedFacts!: ReconciliationDiscrepancyFactsResponse;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "observed - expected in integer minor units",
  })
  amountDifferenceMinor!: string | null;

  @ApiProperty({ type: ReconciliationDiscrepancySourceReferencesResponse })
  sourceReferences!: ReconciliationDiscrepancySourceReferencesResponse;

  @ApiProperty({ type: String, format: "date-time" })
  detectedAt!: Date;

  @ApiProperty({ type: Number, minimum: 0, description: "Detection age against `dataAsOf`" })
  ageMs!: number;

  @ApiProperty({ type: String, nullable: true })
  ownerReference!: string | null;

  @ApiProperty({ type: [Object] })
  resolutionTrail!: readonly Record<string, unknown>[];

  @ApiProperty({ type: Object, nullable: true })
  resolutionEvidence!: Record<string, unknown> | null;

  @ApiProperty({
    enum: [...RECONCILIATION_DISCREPANCY_OUTCOMES],
    nullable: true,
    description: "Governed resolution outcome when the discrepancy is RESOLVED",
  })
  outcome!: string | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  resolvedAt!: Date | null;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  updatedAt!: Date;
}

class ReconciliationDiscrepancyListResponse {
  @ApiProperty({ type: [ReconciliationDiscrepancyResponse] })
  items!: readonly ReconciliationDiscrepancyResponse[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;

  @ApiProperty({ type: String, format: "date-time", description: "Report data-freshness instant" })
  dataAsOf!: Date;
}

@ApiTags("admin-reconciliation")
@ApiBearerAuth()
@Controller("api/v1/admin/reconciliation")
@UseGuards(AdminAuthGuard, AdminCapabilityGuard)
export class AdminReconciliationController {
  constructor(
    @Inject(ReconciliationInspectionService)
    private readonly inspection: ReconciliationInspectionService,
  ) {}

  @Get("runs")
  @RequireAdminCapabilities("reconciliation.read")
  @ApiOperation({
    summary: "List Ledger ↔ Wallet reconciliation runs with their inspected window and result",
  })
  @ApiQuery({ name: "memberId", required: false, type: String })
  @ApiQuery({ name: "currency", required: false, enum: [...RECONCILIATION_CURRENCIES] })
  @ApiQuery({ name: "result", required: false, enum: [...RECONCILIATION_RESULTS] })
  @ApiQuery({
    name: "from",
    required: false,
    type: String,
    description: "Inclusive lower bound of the half-open `asOf` window",
  })
  @ApiQuery({
    name: "to",
    required: false,
    type: String,
    description: "Exclusive upper bound of the half-open `asOf` window",
  })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiOkResponse({ type: ReconciliationRunListResponse })
  @ApiUnauthorizedResponse({ description: "AUTHENTICATION_REQUIRED" })
  @ApiForbiddenResponse({ description: "ACCESS_DENIED" })
  @ApiBadRequestResponse({ description: "VALIDATION_ERROR" })
  async listRuns(
    @Req() request: AdminAuthenticatedRequest,
    @Query("memberId") memberId?: string,
    @Query("currency") currency?: string,
    @Query("result") result?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ): Promise<ReconciliationRunListResponse> {
    try {
      const page = await this.inspection.listRuns({
        memberId: trimmed(memberId),
        currency: trimmed(currency),
        result: trimmed(result),
        from: parseInstant(from, "from", request),
        to: parseInstant(to, "to", request),
        limit: parseLimit(limit, request),
        cursor: trimmed(cursor),
      });
      return { items: page.items.map(toRunResponse), nextCursor: page.nextCursor, dataAsOf: page.dataAsOf };
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Get("runs/:id")
  @RequireAdminCapabilities("reconciliation.read")
  @ApiOperation({ summary: "Read one reconciliation run with its full inspected evidence" })
  @ApiOkResponse({ type: ReconciliationRunResponse })
  @ApiUnauthorizedResponse({ description: "AUTHENTICATION_REQUIRED" })
  @ApiForbiddenResponse({ description: "ACCESS_DENIED" })
  @ApiNotFoundResponse({ description: "NOT_FOUND" })
  async getRun(@Param("id") id: string): Promise<ReconciliationRunResponse> {
    try {
      return toRunResponse(await this.inspection.getRun(id));
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Get("discrepancies")
  @RequireAdminCapabilities("reconciliation.read")
  @ApiOperation({ summary: "List durable reconciliation discrepancies with their lifecycle state" })
  @ApiQuery({ name: "runId", required: false, type: String })
  @ApiQuery({ name: "memberId", required: false, type: String })
  @ApiQuery({ name: "currency", required: false, enum: [...RECONCILIATION_CURRENCIES] })
  @ApiQuery({
    name: "status",
    required: false,
    enum: [...RECONCILIATION_DISCREPANCY_STATUSES],
  })
  @ApiQuery({
    name: "severity",
    required: false,
    enum: [...RECONCILIATION_DISCREPANCY_SEVERITIES],
  })
  @ApiQuery({
    name: "from",
    required: false,
    type: String,
    description: "Inclusive lower bound of the half-open `detectedAt` window",
  })
  @ApiQuery({
    name: "to",
    required: false,
    type: String,
    description: "Exclusive upper bound of the half-open `detectedAt` window",
  })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiOkResponse({ type: ReconciliationDiscrepancyListResponse })
  @ApiUnauthorizedResponse({ description: "AUTHENTICATION_REQUIRED" })
  @ApiForbiddenResponse({ description: "ACCESS_DENIED" })
  @ApiBadRequestResponse({ description: "VALIDATION_ERROR" })
  async listDiscrepancies(
    @Req() request: AdminAuthenticatedRequest,
    @Query("runId") runId?: string,
    @Query("memberId") memberId?: string,
    @Query("currency") currency?: string,
    @Query("status") status?: string,
    @Query("severity") severity?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ): Promise<ReconciliationDiscrepancyListResponse> {
    try {
      const page = await this.inspection.listDiscrepancies({
        runId: trimmed(runId),
        memberId: trimmed(memberId),
        currency: trimmed(currency),
        status: trimmed(status),
        severity: trimmed(severity),
        from: parseInstant(from, "from", request),
        to: parseInstant(to, "to", request),
        limit: parseLimit(limit, request),
        cursor: trimmed(cursor),
      });
      return {
        items: page.items.map(toDiscrepancyResponse),
        nextCursor: page.nextCursor,
        dataAsOf: page.dataAsOf,
      };
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Get("discrepancies/:id")
  @RequireAdminCapabilities("reconciliation.read")
  @ApiOperation({
    summary: "Read one discrepancy with expected/observed facts, age, owner and resolution evidence",
  })
  @ApiOkResponse({ type: ReconciliationDiscrepancyResponse })
  @ApiUnauthorizedResponse({ description: "AUTHENTICATION_REQUIRED" })
  @ApiForbiddenResponse({ description: "ACCESS_DENIED" })
  @ApiNotFoundResponse({ description: "NOT_FOUND" })
  async getDiscrepancy(@Param("id") id: string): Promise<ReconciliationDiscrepancyResponse> {
    try {
      return toDiscrepancyResponse(await this.inspection.getDiscrepancy(id));
    } catch (error) {
      throw toHttp(error);
    }
  }
}

export function toRunResponse(run: ReconciliationRunInspection): ReconciliationRunResponse {
  return {
    id: run.id,
    pair: run.pair,
    checkpointKey: run.checkpointKey,
    memberId: run.memberId,
    currency: run.currency,
    asOf: run.asOf,
    createdAt: run.createdAt,
    sourceRange: run.sourceRange,
    sourceCheckpoint: run.sourceCheckpoint,
    inspectedCounts: run.inspectedCounts,
    totals: run.totals,
    result: run.result,
    resultSummary: run.resultSummary,
    discrepancyCount: run.discrepancyCount,
  };
}

export function toDiscrepancyResponse(
  discrepancy: ReconciliationDiscrepancyInspection,
): ReconciliationDiscrepancyResponse {
  return {
    id: discrepancy.id,
    reconciliationRunId: discrepancy.reconciliationRunId,
    pair: discrepancy.pair,
    identityKey: discrepancy.identityKey,
    memberId: discrepancy.memberId,
    currency: discrepancy.currency,
    status: discrepancy.status,
    severity: discrepancy.severity,
    expectedFacts: toFactsResponse(discrepancy.expectedFacts),
    observedFacts: toFactsResponse(discrepancy.observedFacts),
    amountDifferenceMinor: discrepancy.amountDifferenceMinor,
    sourceReferences: toSourceReferencesResponse(discrepancy.sourceReferences),
    detectedAt: discrepancy.detectedAt,
    ageMs: discrepancy.ageMs,
    ownerReference: discrepancy.ownerReference,
    resolutionTrail: discrepancy.resolutionTrail,
    resolutionEvidence: discrepancy.resolutionEvidence,
    outcome: discrepancy.outcome,
    resolvedAt: discrepancy.resolvedAt,
    createdAt: discrepancy.createdAt,
    updatedAt: discrepancy.updatedAt,
  };
}

function toFactsResponse(facts: ReconciliationDiscrepancyFacts): ReconciliationDiscrepancyFactsResponse {
  return {
    memberId: facts.memberId,
    currency: facts.currency,
    bucket: facts.bucket,
    metric: facts.metric,
    amountMinor: facts.amountMinor,
  };
}

function toSourceReferencesResponse(
  references: ReconciliationDiscrepancySourceReferences,
): ReconciliationDiscrepancySourceReferencesResponse {
  return {
    pair: references.pair,
    checkpointKey: references.checkpointKey,
    memberId: references.memberId,
    ledgerAccountId: references.ledgerAccountId,
  };
}

function toHttp(error: unknown): unknown {
  if (error instanceof ReportingRuleError) return reportingHttpException(error);
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
