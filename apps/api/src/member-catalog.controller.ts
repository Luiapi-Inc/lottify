import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import {
  LotteryConfigurationRuleError,
  LotteryConfigurationService,
  type LotteryConfigurationState,
} from "../../../src/contexts/lottery/application/lottery-configuration.service";
import { currentCorrelationId } from "./correlation";
import {
  MemberAuthGuard,
  type MemberAuthenticatedRequest,
} from "./member-auth.guard";

// Member catalog discovery is read-only and PUBLISHED-only: a Member may only
// ever see published lottery configuration, never DRAFT/REVIEW work in progress.
const MEMBER_VISIBLE_STATE: LotteryConfigurationState = "PUBLISHED";

class CatalogVersionBody {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: Number })
  version!: number;

  @ApiProperty({ type: Number })
  revision!: number;

  @ApiProperty({ enum: ["DRAFT", "REVIEW", "PUBLISHED"] })
  state!: string;

  @ApiProperty({ type: String, format: "date-time" })
  effectiveFrom!: string;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  effectiveUntil!: string | null;
}

class CatalogEnabledBetTypeBody {
  @ApiProperty({ type: String })
  betTypeId!: string;

  @ApiProperty({ type: String })
  betTypeCode!: string;

  @ApiProperty({ type: String })
  betTypeVersionId!: string;

  @ApiProperty({ type: Number })
  betTypeVersion!: number;

  @ApiProperty({ enum: ["DRAFT", "REVIEW", "PUBLISHED"] })
  betTypeVersionState!: string;

  @ApiProperty({ type: Number })
  betTypeVersionRevision!: number;
}

class MemberProductVersionBody extends CatalogVersionBody {
  @ApiProperty({ type: String })
  timezone!: string;

  @ApiProperty({ type: String })
  scheduleTemplateRef!: string;

  @ApiProperty({ type: String })
  resultSchemaVersionRef!: string;

  @ApiProperty({ type: String })
  settlementRuleVersionRef!: string;

  @ApiProperty({ type: String })
  defaultPayoutPolicyRef!: string;

  @ApiProperty({ type: String })
  defaultLimitPolicyRef!: string;

  @ApiProperty({ type: String })
  defaultRestrictionPolicyRef!: string;

  @ApiProperty({ type: [CatalogEnabledBetTypeBody] })
  enabledBetTypes!: CatalogEnabledBetTypeBody[];
}

class MemberProductSummaryBody {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: [CatalogVersionBody] })
  versions!: CatalogVersionBody[];
}

class MemberProductPageBody {
  @ApiProperty({ type: [MemberProductSummaryBody] })
  items!: MemberProductSummaryBody[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

class MemberProductDetailBody {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: [MemberProductVersionBody] })
  versions!: MemberProductVersionBody[];
}

class MemberBetTypeSummaryBody {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ type: [CatalogVersionBody] })
  versions!: CatalogVersionBody[];
}

class MemberBetTypePageBody {
  @ApiProperty({ type: [MemberBetTypeSummaryBody] })
  items!: MemberBetTypeSummaryBody[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

class MemberBetTypeVersionBody extends CatalogVersionBody {
  @ApiProperty({ type: String })
  canonicalNumberFormat!: string;

  @ApiProperty({ type: String })
  validationPattern!: string;

  @ApiProperty({
    type: Object,
    description: "Default payout configuration (opaque configuration value).",
  })
  defaultPayout!: Record<string, unknown>;

  @ApiProperty({ type: String, description: "Minimum stake in minor units." })
  minStakeMinor!: string;

  @ApiProperty({ type: String, description: "Maximum stake in minor units." })
  maxStakeMinor!: string;

  @ApiProperty({ type: String })
  limitPolicyRef!: string;

  @ApiProperty({ type: String })
  restrictionPolicyRef!: string;

  @ApiProperty({ type: String })
  settlementRuleVersionRef!: string;
}

class MemberBetTypeDetailBody {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ type: [MemberBetTypeVersionBody] })
  versions!: MemberBetTypeVersionBody[];
}

// Shapes returned by LotteryConfigurationService (typed locally so the response
// mappers convert Date -> ISO and never leak persistence internals).
interface ServiceVersionSummary {
  id: string;
  version: number;
  revision: number;
  state: string;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
}

interface ServiceProductSummary {
  id: string;
  versions: ServiceVersionSummary[];
}

interface ServiceEnabledBetType {
  betTypeId: string;
  betTypeCode: string;
  betTypeVersionId: string;
  betTypeVersion: number;
  betTypeVersionState: string;
  betTypeVersionRevision: number;
}

interface ServiceProductVersion extends ServiceVersionSummary {
  timezone: string;
  scheduleTemplateRef: string;
  resultSchemaVersionRef: string;
  settlementRuleVersionRef: string;
  defaultPayoutPolicyRef: string;
  defaultLimitPolicyRef: string;
  defaultRestrictionPolicyRef: string;
  enabledBetTypes: ServiceEnabledBetType[];
}

interface ServiceProductDetail {
  id: string;
  versions: ServiceProductVersion[];
}

interface ServiceBetTypeSummary {
  id: string;
  code: string;
  versions: ServiceVersionSummary[];
}

interface ServiceBetTypeVersion extends ServiceVersionSummary {
  canonicalNumberFormat: string;
  validationPattern: string;
  defaultPayout: Record<string, unknown>;
  minStakeMinor: string;
  maxStakeMinor: string;
  limitPolicyRef: string;
  restrictionPolicyRef: string;
  settlementRuleVersionRef: string;
}

interface ServiceBetTypeDetail {
  id: string;
  code: string;
  versions: ServiceBetTypeVersion[];
}

@ApiTags("Member Lottery Catalog")
@Controller("api/v1/member")
@UseGuards(MemberAuthGuard)
export class MemberCatalogController {
  constructor(
    @Inject(LotteryConfigurationService)
    private readonly configuration: LotteryConfigurationService,
  ) {}

  @Get("products")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "List published Lottery Products available to the Member",
    description:
      "Discovery exposes only PUBLISHED configuration; DRAFT/REVIEW work in progress is never visible to a Member.",
  })
  @ApiQuery({ name: "limit", required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiOkResponse({ type: MemberProductPageBody })
  async listProducts(
    @Req() _request: MemberAuthenticatedRequest,
    @Query("limit") limit: string | undefined,
    @Query("cursor") cursor: string | undefined,
  ): Promise<MemberProductPageBody> {
    try {
      const page = await this.configuration.listProducts({
        limit: parseLimit(limit),
        cursor: cursor?.trim() || undefined,
        state: MEMBER_VISIBLE_STATE,
      });
      // A Product with no PUBLISHED version is not yet available to bet on, so it
      // is not part of Member discovery. The page cursor still comes from the
      // service page so pagination stays walkable.
      const items = (page.items as ServiceProductSummary[])
        .filter((item) => item.versions.length > 0)
        .map(toProductSummaryBody);
      return { items, nextCursor: page.nextCursor };
    } catch (error) {
      throw mapCatalogError(error);
    }
  }

  @Get("products/:id")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get a published Lottery Product with its enabled Bet Types",
  })
  @ApiOkResponse({ type: MemberProductDetailBody })
  async getProduct(
    @Req() _request: MemberAuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<MemberProductDetailBody> {
    try {
      const product = (await this.configuration.getProduct(
        id.trim(),
        MEMBER_VISIBLE_STATE,
      )) as ServiceProductDetail;
      return toProductDetailBody(product);
    } catch (error) {
      throw mapCatalogError(error, "PRODUCT_NOT_FOUND");
    }
  }

  @Get("bet-types")
  @ApiBearerAuth()
  @ApiOperation({ summary: "List published Lottery Bet Types available to the Member" })
  @ApiQuery({ name: "limit", required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiOkResponse({ type: MemberBetTypePageBody })
  async listBetTypes(
    @Req() _request: MemberAuthenticatedRequest,
    @Query("limit") limit: string | undefined,
    @Query("cursor") cursor: string | undefined,
  ): Promise<MemberBetTypePageBody> {
    try {
      const page = await this.configuration.listBetTypes({
        limit: parseLimit(limit),
        cursor: cursor?.trim() || undefined,
        state: MEMBER_VISIBLE_STATE,
      });
      const items = (page.items as ServiceBetTypeSummary[])
        .filter((item) => item.versions.length > 0)
        .map((item) => ({
          id: item.id,
          code: item.code,
          versions: item.versions.map(toVersionBody),
        }));
      return { items, nextCursor: page.nextCursor };
    } catch (error) {
      throw mapCatalogError(error);
    }
  }

  @Get("bet-types/:id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get a published Lottery Bet Type with its published versions" })
  @ApiOkResponse({ type: MemberBetTypeDetailBody })
  async getBetType(
    @Req() _request: MemberAuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<MemberBetTypeDetailBody> {
    try {
      const betType = (await this.configuration.getBetType(
        id.trim(),
        MEMBER_VISIBLE_STATE,
      )) as ServiceBetTypeDetail;
      return {
        id: betType.id,
        code: betType.code,
        versions: betType.versions.map(toBetTypeVersionBody),
      };
    } catch (error) {
      throw mapCatalogError(error, "BET_TYPE_NOT_FOUND");
    }
  }
}

function toVersionBody(version: ServiceVersionSummary): CatalogVersionBody {
  return {
    id: version.id,
    version: version.version,
    revision: version.revision,
    state: version.state,
    effectiveFrom: version.effectiveFrom.toISOString(),
    effectiveUntil: version.effectiveUntil?.toISOString() ?? null,
  };
}

function toEnabledBetTypeBody(
  link: ServiceEnabledBetType,
): CatalogEnabledBetTypeBody {
  return {
    betTypeId: link.betTypeId,
    betTypeCode: link.betTypeCode,
    betTypeVersionId: link.betTypeVersionId,
    betTypeVersion: link.betTypeVersion,
    betTypeVersionState: link.betTypeVersionState,
    betTypeVersionRevision: link.betTypeVersionRevision,
  };
}

function toProductSummaryBody(
  product: ServiceProductSummary,
): MemberProductSummaryBody {
  return {
    id: product.id,
    versions: product.versions.map(toVersionBody),
  };
}

function toProductVersionBody(
  version: ServiceProductVersion,
): MemberProductVersionBody {
  return {
    ...toVersionBody(version),
    timezone: version.timezone,
    scheduleTemplateRef: version.scheduleTemplateRef,
    resultSchemaVersionRef: version.resultSchemaVersionRef,
    settlementRuleVersionRef: version.settlementRuleVersionRef,
    defaultPayoutPolicyRef: version.defaultPayoutPolicyRef,
    defaultLimitPolicyRef: version.defaultLimitPolicyRef,
    defaultRestrictionPolicyRef: version.defaultRestrictionPolicyRef,
    enabledBetTypes: version.enabledBetTypes.map(toEnabledBetTypeBody),
  };
}

function toProductDetailBody(product: ServiceProductDetail): MemberProductDetailBody {
  return {
    id: product.id,
    versions: product.versions.map(toProductVersionBody),
  };
}

function toBetTypeVersionBody(
  version: ServiceBetTypeVersion,
): MemberBetTypeVersionBody {
  return {
    ...toVersionBody(version),
    canonicalNumberFormat: version.canonicalNumberFormat,
    validationPattern: version.validationPattern,
    defaultPayout: version.defaultPayout,
    minStakeMinor: version.minStakeMinor,
    maxStakeMinor: version.maxStakeMinor,
    limitPolicyRef: version.limitPolicyRef,
    restrictionPolicyRef: version.restrictionPolicyRef,
    settlementRuleVersionRef: version.settlementRuleVersionRef,
  };
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new HttpException(
      {
        code: "VALIDATION_ERROR",
        message: "limit must be an integer between 1 and 100",
        details: { field: "limit" },
        correlationId: currentCorrelationId() ?? "unknown",
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  return parsed;
}

function mapCatalogError(error: unknown, notFoundCode?: string): HttpException {
  // NotFoundException extends HttpException, so the more specific case must be
  // handled first or the raw Nest error would leak past this mapper.
  if (error instanceof NotFoundException) {
    return new HttpException(
      {
        code: notFoundCode ?? "NOT_FOUND",
        message: error.message,
        details: {},
        correlationId: currentCorrelationId() ?? randomUUID(),
      },
      HttpStatus.NOT_FOUND,
    );
  }
  if (error instanceof HttpException) return error;
  if (error instanceof LotteryConfigurationRuleError) {
    return new HttpException(
      {
        code: error.code,
        message: error.message,
        details: error.details,
        correlationId: currentCorrelationId() ?? randomUUID(),
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  throw error;
}
