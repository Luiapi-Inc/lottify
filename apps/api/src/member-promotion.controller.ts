import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { z, type ZodType } from "zod";
import {
  PromotionEntitlementService,
  type PromotionEntitlementView,
} from "../../../src/contexts/promotion/application/promotion-entitlement.service";
import { PromotionCampaignService } from "../../../src/contexts/promotion/application/promotion-campaign.service";
import { PromotionRuleError } from "../../../src/contexts/promotion/domain/rule-error";
import { promotionHttpException } from "./promotion-error.mapper";
import { currentCorrelationId } from "./correlation";
import {
  MemberAuthGuard,
  type MemberAuthenticatedRequest,
} from "./member-auth.guard";

class PromotionDiscoveryItemBody {
  @ApiProperty({ type: String })
  campaignVersionId!: string;

  @ApiProperty({ type: String })
  campaignCode!: string;

  @ApiProperty({ type: Number })
  campaignVersion!: number;

  @ApiProperty({ type: String, description: "Reward in integer minor units" })
  rewardAmountMinor!: string;

  @ApiProperty({ enum: ["THB"] })
  currency!: string;

  @ApiProperty({ type: String, description: "Turnover target in integer minor units" })
  turnoverTargetMinor!: string;

  @ApiProperty({ type: Number, description: "Contribution in basis points" })
  contributionBps!: number;

  @ApiProperty({ enum: ["BONUS", "CASH", "PROPORTIONAL"] })
  winningsDestination!: string;

  @ApiProperty({ enum: ["EXCLUSIVE", "STACKABLE"] })
  stackingMode!: string;

  @ApiProperty({ type: String, format: "date-time" })
  effectiveFrom!: Date;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  effectiveUntil!: Date | null;

  @ApiProperty({ type: String, format: "date-time" })
  expiresAt!: Date;

  @ApiProperty({ type: Boolean })
  eligible!: boolean;

  @ApiProperty({ type: String, isArray: true })
  ineligibilityReasons!: string[];
}

class PromotionDiscoveryBody {
  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ type: String, format: "date-time" })
  asOf!: Date;

  @ApiProperty({ type: PromotionDiscoveryItemBody, isArray: true })
  items!: PromotionDiscoveryItemBody[];
}

class TurnoverProgressBody {
  @ApiProperty({ type: String })
  provisionalMinor!: string;

  @ApiProperty({ type: String })
  finalizedMinor!: string;

  @ApiProperty({ type: String })
  progressMinor!: string;

  @ApiProperty({ type: String })
  targetMinor!: string;

  @ApiProperty({ type: String })
  remainingMinor!: string;

  @ApiProperty({ type: Boolean })
  releaseReached!: boolean;
}

class TurnoverEntryBody {
  @ApiProperty({ type: String })
  betReference!: string;

  @ApiProperty({ enum: ["BET", "ADJUSTMENT"] })
  entryKind!: string;

  @ApiProperty({ enum: ["PROVISIONAL", "FINALIZED", "REMOVED"] })
  state!: string;

  @ApiProperty({ type: String })
  contributionMinor!: string;

  @ApiProperty({ type: String, format: "date-time" })
  occurredAt!: Date;
}

class PromotionEntitlementBody {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ type: String })
  campaignCode!: string;

  @ApiProperty({ type: String })
  campaignVersionId!: string;

  @ApiProperty({ type: Number })
  campaignVersion!: number;

  @ApiProperty({ enum: ["ACTIVE", "RELEASE_PENDING", "COMPLETED", "EXPIRED", "REVOKED"] })
  state!: string;

  @ApiProperty({ type: Number })
  version!: number;

  @ApiProperty({ type: Object, description: "Snapshotted Campaign terms" })
  terms!: Record<string, unknown>;

  @ApiProperty({ type: String })
  rewardMinor!: string;

  @ApiProperty({ type: String })
  turnoverTargetMinor!: string;

  @ApiProperty({ type: String })
  releasedMinor!: string;

  @ApiProperty({ type: String, format: "date-time" })
  grantedAt!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  expiresAt!: Date;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  completedAt!: Date | null;

  @ApiProperty({ type: String, nullable: true })
  grantLedgerTransactionId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  releaseLedgerTransactionId!: string | null;

  @ApiProperty({ type: TurnoverProgressBody })
  turnover!: TurnoverProgressBody;

  @ApiProperty({ type: TurnoverEntryBody, isArray: true })
  turnoverEntries!: TurnoverEntryBody[];

  @ApiProperty({ type: String, isArray: true })
  allowedActions!: string[];
}

class PromotionEntitlementPageBody {
  @ApiProperty({ type: PromotionEntitlementBody, isArray: true })
  items!: PromotionEntitlementBody[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

const claimSchema = z.object({
  campaignVersionId: z.string().trim().min(1).max(100),
});

class ClaimPromotionBody {
  @ApiProperty({ type: String, format: "uuid" })
  campaignVersionId!: string;
}

const CLAIM_IDEMPOTENCY_HEADER = "idempotency-key";

@ApiTags("Member Promotions")
@Controller("api/v1/member/promotions")
@UseGuards(MemberAuthGuard)
export class MemberPromotionController {
  constructor(
    @Inject(PromotionCampaignService)
    private readonly campaigns: PromotionCampaignService,
    @Inject(PromotionEntitlementService)
    private readonly entitlements: PromotionEntitlementService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Discover published Promotions with the Member's eligibility decision",
  })
  @ApiOkResponse({ type: PromotionDiscoveryBody })
  async discover(@Req() request: MemberAuthenticatedRequest): Promise<PromotionDiscoveryBody> {
    const discovery = await this.campaigns.discoverForMember(
      request.memberAuth!.memberId,
      new Date(),
    );
    return {
      memberId: discovery.memberId,
      asOf: discovery.asOf,
      items: discovery.items.map((item) => ({
        campaignVersionId: item.campaignVersionId,
        campaignCode: item.campaignCode,
        campaignVersion: item.campaignVersion,
        rewardAmountMinor: item.rewardAmountMinor,
        currency: item.currency,
        turnoverTargetMinor: item.turnoverTargetMinor,
        contributionBps: item.contributionBps,
        winningsDestination: item.winningsDestination,
        stackingMode: item.stackingMode,
        effectiveFrom: item.effectiveFrom,
        effectiveUntil: item.effectiveUntil,
        expiresAt: item.expiresAt,
        eligible: item.eligible,
        ineligibilityReasons: [...item.ineligibilityReasons],
      })),
    };
  }

  @Get("entitlements")
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the Member's Promotion Entitlements with turnover progress" })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiQuery({
    name: "state",
    required: false,
    enum: ["ACTIVE", "RELEASE_PENDING", "COMPLETED", "EXPIRED", "REVOKED"],
  })
  @ApiOkResponse({ type: PromotionEntitlementPageBody })
  async listEntitlements(
    @Req() request: MemberAuthenticatedRequest,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
    @Query("state") state?: string,
  ): Promise<PromotionEntitlementPageBody> {
    try {
      const requestedLimit = limit === undefined || limit === "" ? 20 : Number(limit);
      const page = await this.entitlements.listEntitlements(request.memberAuth!.memberId, {
        limit: requestedLimit,
        ...(cursor ? { cursor } : {}),
        ...(state ? { state } : {}),
      });
      return {
        items: page.items.map(toEntitlementBody),
        nextCursor: page.nextCursor,
      };
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Post("entitlements")
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiHeader({
    name: CLAIM_IDEMPOTENCY_HEADER,
    required: true,
    description: "Scoped Idempotency-Key. Same key + same payload returns the prior result.",
  })
  @ApiBody({ type: ClaimPromotionBody })
  @ApiOkResponse({ type: PromotionEntitlementBody })
  async claim(
    @Req() request: MemberAuthenticatedRequest,
    @Body() body: ClaimPromotionBody,
  ): Promise<PromotionEntitlementBody> {
    const input = parseBody(claimSchema, body);
    const idempotencyKey = request.header(CLAIM_IDEMPOTENCY_HEADER)?.trim();
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Idempotency-Key header is required for claiming a Promotion",
        details: {},
      });
    }
    try {
      const entitlement = await this.entitlements.claimEntitlementIdempotent(
        request.memberAuth!.memberId,
        { campaignVersionId: input.campaignVersionId, idempotencyKey },
        new Date(),
        currentCorrelationId() ?? request.memberAuth!.sessionId,
      );
      return toEntitlementBody(entitlement);
    } catch (error) {
      throw toHttp(error);
    }
  }

  @Get("entitlements/:id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Read one Promotion Entitlement with its turnover trail" })
  @ApiOkResponse({ type: PromotionEntitlementBody })
  async getEntitlement(
    @Req() request: MemberAuthenticatedRequest,
    @Param("id") entitlementId: string,
  ): Promise<PromotionEntitlementBody> {
    try {
      const entitlement = await this.entitlements.getEntitlement(
        request.memberAuth!.memberId,
        entitlementId,
      );
      return toEntitlementBody(entitlement);
    } catch (error) {
      throw toHttp(error);
    }
  }
}

export function toEntitlementBody(view: PromotionEntitlementView): PromotionEntitlementBody {
  return {
    id: view.id,
    memberId: view.memberId,
    campaignCode: view.campaignCode,
    campaignVersionId: view.campaignVersionId,
    campaignVersion: view.campaignVersion,
    state: view.state,
    version: view.version,
    terms: view.terms as unknown as Record<string, unknown>,
    rewardMinor: view.rewardMinor.toString(),
    turnoverTargetMinor: view.turnoverTargetMinor.toString(),
    releasedMinor: view.releasedMinor.toString(),
    grantedAt: view.grantedAt,
    expiresAt: view.expiresAt,
    completedAt: view.completedAt,
    grantLedgerTransactionId: view.grantLedgerTransactionId,
    releaseLedgerTransactionId: view.releaseLedgerTransactionId,
    turnover: {
      provisionalMinor: view.turnover.provisionalMinor.toString(),
      finalizedMinor: view.turnover.finalizedMinor.toString(),
      progressMinor: view.turnover.progressMinor.toString(),
      targetMinor: view.turnover.targetMinor.toString(),
      remainingMinor: view.turnover.remainingMinor.toString(),
      releaseReached: view.turnover.releaseReached,
    },
    turnoverEntries: view.turnoverEntries.map((entry) => ({
      betReference: entry.betReference,
      entryKind: entry.entryKind,
      state: entry.state,
      contributionMinor: entry.contributionMinor.toString(),
      occurredAt: entry.occurredAt,
    })),
    allowedActions: [...view.allowedActions],
  };
}

function toHttp(error: unknown): unknown {
  if (error instanceof PromotionRuleError) return promotionHttpException(error);
  if (error instanceof NotFoundException) return error;
  return error;
}

function parseBody<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "campaignVersionId is required",
      details: {},
    });
  }
  return parsed.data;
}
