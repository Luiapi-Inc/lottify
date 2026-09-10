import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
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
  AccountingPeriodFinancialReportService,
  REPORTING_COMPLETENESS_STATES,
  REPORTING_TIME_ZONE,
  type AccountingPeriodFinancialReport,
  type AccountingPeriodFinancialReportGroup,
  type AccountingPeriodCorrectionLineage,
  type AccountingPeriodReportCoverage,
  type AccountingPeriodReportCoverageGap,
  type AccountingPeriodReportRange,
  type ReportingTimeZone,
} from "../../../src/contexts/reporting/accounting-period-financial-report.service";
import { ReportingRuleError } from "../../../src/contexts/reporting/reporting-rule-error";
import { AdminAuthGuard, type AdminAuthenticatedRequest } from "./admin-auth.guard";
import {
  AdminCapabilityGuard,
  RequireAdminCapabilities,
} from "./admin-capability.guard";
import { currentCorrelationId } from "./correlation";
import { reportingHttpException } from "./reporting-error.mapper";

class AccountingPeriodReportRangeResponse {
  @ApiProperty({ type: String, format: "date-time", description: "Inclusive lower bound" })
  from!: Date;

  @ApiProperty({ type: String, format: "date-time", description: "Exclusive upper bound" })
  to!: Date;

  @ApiProperty({ enum: ["half-open"] })
  boundary!: "half-open";

  @ApiProperty({
    enum: ["EXPLICIT", "ACCOUNTING_PERIOD"],
    description: "Whether the window came from explicit instants or an authoritative Accounting Period",
  })
  source!: "EXPLICIT" | "ACCOUNTING_PERIOD";

  @ApiProperty({ type: String, format: "uuid", nullable: true })
  accountingPeriodId!: string | null;
}

class AccountingPeriodReportCoverageGapResponse {
  @ApiProperty({ type: String, format: "date-time" })
  from!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  to!: Date;
}

class AccountingPeriodReportCoverageResponse {
  @ApiProperty({ type: Number, minimum: 0 })
  authoritativePeriodCount!: number;

  @ApiProperty({
    type: [AccountingPeriodReportCoverageGapResponse],
    description: "Observable spans of the window no authoritative Accounting Period covers",
  })
  uncoveredRanges!: readonly AccountingPeriodReportCoverageGapResponse[];

  @ApiProperty({
    type: AccountingPeriodReportCoverageGapResponse,
    nullable: true,
    description: "Span of the window later than `dataAsOf`, therefore not yet observable",
  })
  unobservedRange!: AccountingPeriodReportCoverageGapResponse | null;
}

class AccountingPeriodReportGroupResponse {
  @ApiProperty({ type: String, format: "uuid" })
  accountingPeriodId!: string;

  @ApiProperty({ type: String, description: "Authoritative Accounting Period mode" })
  mode!: string;

  @ApiProperty({ type: String, description: "Authoritative Accounting Period generation kind" })
  generationKind!: string;

  @ApiProperty({ type: String, format: "date-time" })
  effectiveStart!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  effectiveEnd!: Date;

  @ApiProperty({ type: String, description: "Authoritative Accounting Period state" })
  state!: string;

  @ApiProperty({ type: Number, minimum: 0 })
  transactionCount!: number;

  @ApiProperty({ type: String, description: "Total DEBIT postings in integer minor units" })
  debitAmountMinor!: string;

  @ApiProperty({ type: String, description: "Total CREDIT postings in integer minor units" })
  creditAmountMinor!: string;
}

class AccountingPeriodCorrectionLineageResponse {
  @ApiProperty({ type: String, format: "uuid" })
  transactionId!: string;

  @ApiProperty({ type: String })
  correctionKind!: string;

  @ApiProperty({ type: String, format: "uuid" })
  accountingPeriodId!: string;

  @ApiProperty({ type: String, format: "uuid" })
  correctsTransactionId!: string;

  @ApiProperty({ type: String, format: "uuid" })
  originalAccountingPeriodId!: string;
}

class AccountingPeriodFinancialReportResponse {
  @ApiProperty({ type: String, format: "date-time" })
  generatedAt!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  dataAsOf!: Date;

  @ApiProperty({
    type: Number,
    enum: [0],
    description: "Always 0: this report reads authoritative facts directly, with no projection",
  })
  projectionLagMs!: 0;

  @ApiProperty({
    enum: [...REPORTING_COMPLETENESS_STATES],
    description:
      "CURRENT when the whole window is observable and covered by authoritative Accounting Periods; " +
      "LAGGING when the window extends past `dataAsOf`; PARTIAL when the observable window is not " +
      "fully covered; REBUILDING is reserved for projection-backed Reporting outputs and is never " +
      "returned by this authoritative read. Partial/lagging output is never definitive.",
  })
  completeness!: string;

  @ApiProperty({ enum: [REPORTING_TIME_ZONE] })
  reportingTimezone!: ReportingTimeZone;

  @ApiProperty({ type: AccountingPeriodReportRangeResponse, nullable: true })
  range!: AccountingPeriodReportRangeResponse | null;

  @ApiProperty({ type: AccountingPeriodReportCoverageResponse, nullable: true })
  coverage!: AccountingPeriodReportCoverageResponse | null;

  @ApiProperty({ type: [AccountingPeriodReportGroupResponse] })
  periods!: readonly AccountingPeriodReportGroupResponse[];

  @ApiProperty({ type: [AccountingPeriodCorrectionLineageResponse] })
  corrections!: readonly AccountingPeriodCorrectionLineageResponse[];
}

@ApiTags("admin-reports")
@ApiBearerAuth()
@Controller("api/v1/admin/reports")
@UseGuards(AdminAuthGuard, AdminCapabilityGuard)
export class AdminReportingController {
  constructor(
    @Inject(AccountingPeriodFinancialReportService)
    private readonly reports: AccountingPeriodFinancialReportService,
  ) {}

  @Get("accounting-period-financial")
  @RequireAdminCapabilities("report.read")
  @ApiOperation({
    summary:
      "Accounting-period financial report for a declared half-open window with freshness state",
  })
  @ApiQuery({
    name: "accountingPeriodId",
    required: false,
    type: String,
    description: "Authoritative Accounting Period identity; its stored bounds become the window",
  })
  @ApiQuery({
    name: "from",
    required: false,
    type: String,
    description: "Inclusive lower bound of the half-open window (with `to`)",
  })
  @ApiQuery({
    name: "to",
    required: false,
    type: String,
    description: "Exclusive upper bound of the half-open window (with `from`)",
  })
  @ApiQuery({
    name: "timezone",
    required: false,
    enum: [REPORTING_TIME_ZONE],
    description: "Declared reporting timezone",
  })
  @ApiOkResponse({ type: AccountingPeriodFinancialReportResponse })
  @ApiUnauthorizedResponse({ description: "AUTHENTICATION_REQUIRED" })
  @ApiForbiddenResponse({ description: "ACCESS_DENIED" })
  @ApiBadRequestResponse({ description: "VALIDATION_ERROR / UNSUPPORTED_REPORTING_TIME_ZONE" })
  @ApiNotFoundResponse({ description: "NOT_FOUND" })
  async accountingPeriodFinancial(
    @Req() request: AdminAuthenticatedRequest,
    @Query("accountingPeriodId") accountingPeriodId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("timezone") timezone?: string,
  ): Promise<AccountingPeriodFinancialReportResponse> {
    const periodId = trimmed(accountingPeriodId);
    const fromInstant = parseInstant(from, "from", request);
    const toInstant = parseInstant(to, "to", request);
    const declaredTimezone = trimmed(timezone) as ReportingTimeZone | undefined;

    try {
      if (periodId) {
        if (fromInstant || toInstant) {
          throw apiError(
            request,
            "Declare either accountingPeriodId or the from/to window, not both",
            { field: "accountingPeriodId" },
          );
        }
        return toReportResponse(
          await this.reports.buildForAccountingPeriod({
            accountingPeriodId: periodId,
            timezone: declaredTimezone,
          }),
        );
      }
      if (!fromInstant || !toInstant) {
        throw apiError(
          request,
          "Declare the reporting window with accountingPeriodId or from and to",
          { field: "from" },
        );
      }
      return toReportResponse(
        await this.reports.buildForRange({
          from: fromInstant,
          to: toInstant,
          timezone: declaredTimezone,
        }),
      );
    } catch (error) {
      throw toHttp(error);
    }
  }
}

function toHttp(error: unknown): unknown {
  if (error instanceof ReportingRuleError) return reportingHttpException(error);
  if (error instanceof HttpException) return error;
  return error;
}

export function toReportResponse(
  report: AccountingPeriodFinancialReport,
): AccountingPeriodFinancialReportResponse {
  return {
    generatedAt: report.generatedAt,
    dataAsOf: report.dataAsOf,
    projectionLagMs: report.projectionLagMs,
    completeness: report.completeness,
    reportingTimezone: report.reportingTimezone,
    range: report.range ? toRangeResponse(report.range) : null,
    coverage: report.coverage ? toCoverageResponse(report.coverage) : null,
    periods: report.periods.map(toGroupResponse),
    corrections: report.corrections.map(toCorrectionResponse),
  };
}

function toRangeResponse(range: AccountingPeriodReportRange): AccountingPeriodReportRangeResponse {
  return {
    from: range.from,
    to: range.to,
    boundary: range.boundary,
    source: range.source,
    accountingPeriodId: range.accountingPeriodId,
  };
}

function toCoverageResponse(
  coverage: AccountingPeriodReportCoverage,
): AccountingPeriodReportCoverageResponse {
  return {
    authoritativePeriodCount: coverage.authoritativePeriodCount,
    uncoveredRanges: coverage.uncoveredRanges.map(toCoverageGapResponse),
    unobservedRange: coverage.unobservedRange ? toCoverageGapResponse(coverage.unobservedRange) : null,
  };
}

function toCoverageGapResponse(
  gap: AccountingPeriodReportCoverageGap,
): AccountingPeriodReportCoverageGapResponse {
  return { from: gap.from, to: gap.to };
}

function toGroupResponse(
  group: AccountingPeriodFinancialReportGroup,
): AccountingPeriodReportGroupResponse {
  return {
    accountingPeriodId: group.accountingPeriodId,
    mode: group.mode,
    generationKind: group.generationKind,
    effectiveStart: group.effectiveStart,
    effectiveEnd: group.effectiveEnd,
    state: group.state,
    transactionCount: group.transactionCount,
    debitAmountMinor: group.debitAmountMinor.toString(),
    creditAmountMinor: group.creditAmountMinor.toString(),
  };
}

function toCorrectionResponse(
  correction: AccountingPeriodCorrectionLineage,
): AccountingPeriodCorrectionLineageResponse {
  return {
    transactionId: correction.transactionId,
    correctionKind: correction.correctionKind,
    accountingPeriodId: correction.accountingPeriodId,
    correctsTransactionId: correction.correctsTransactionId,
    originalAccountingPeriodId: correction.originalAccountingPeriodId,
  };
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
