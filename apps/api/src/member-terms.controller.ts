import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
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
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";
import {
  TermsService,
  type MemberTermsStatus,
} from "../../../src/contexts/member/application/terms.service";
import { currentCorrelationId } from "./correlation";
import {
  MemberAuthGuard,
  type MemberAuthenticatedRequest,
} from "./member-auth.guard";
import { toOnboardingHttp } from "./onboarding-error.mapper";

const IDEMPOTENCY_HEADER = "idempotency-key";

const acceptTermsSchema = z
  .object({
    documentId: z.string().trim().min(1).max(100),
  })
  .strict();

class AcceptTermsRequestBody {
  @ApiProperty({
    type: String,
    format: "uuid",
    description: "The Terms version the Member is accepting (from GET /member/terms)",
  })
  documentId!: string;
}

class RequiredTermsBody {
  @ApiProperty({ type: String })
  documentId!: string;

  @ApiProperty({ type: String, example: "MEMBER_TERMS" })
  code!: string;

  @ApiProperty({ type: Number })
  version!: number;

  @ApiProperty({ type: String })
  title!: string;

  @ApiProperty({ type: String, description: "The exact text the Member must read before accepting" })
  body!: string;

  @ApiProperty({ type: String, description: "SHA-256 over the accepted Terms content" })
  contentDigest!: string;

  @ApiProperty({ type: String, description: "Policy version governing this Terms version" })
  policyVersion!: string;

  @ApiProperty({ type: String, format: "date-time" })
  effectiveFrom!: Date;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  effectiveUntil!: Date | null;

  @ApiProperty({
    type: Boolean,
    description: "True only when a durable acceptance for this exact version exists",
  })
  accepted!: boolean;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  acceptedAt!: Date | null;

  @ApiProperty({ type: String, nullable: true })
  acceptanceId!: string | null;
}

class TermsAcceptanceBody {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ type: String })
  documentId!: string;

  @ApiProperty({ type: String })
  documentCode!: string;

  @ApiProperty({ type: Number })
  documentVersion!: number;

  @ApiProperty({ type: String })
  contentDigest!: string;

  @ApiProperty({ type: String, example: "MEMBER_SELF_SERVICE" })
  source!: string;

  @ApiProperty({ type: String, format: "date-time" })
  acceptedAt!: Date;
}

class MemberTermsBody {
  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ type: String, format: "date-time" })
  asOf!: Date;

  @ApiProperty({
    type: [RequiredTermsBody],
    description: "Terms versions currently required for this Member (may be empty)",
  })
  required!: RequiredTermsBody[];

  @ApiProperty({
    type: [TermsAcceptanceBody],
    description: "This Member's immutable Terms acceptances",
  })
  acceptances!: TermsAcceptanceBody[];

  @ApiProperty({
    type: Boolean,
    description: "Every currently required Terms version has a durable acceptance",
  })
  satisfied!: boolean;
}

class AcceptTermsBody {
  @ApiProperty({ type: String })
  acceptanceId!: string;

  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ type: String })
  documentId!: string;

  @ApiProperty({ type: String })
  documentCode!: string;

  @ApiProperty({ type: Number })
  documentVersion!: number;

  @ApiProperty({ type: String, description: "SHA-256 over the accepted Terms content" })
  contentDigest!: string;

  @ApiProperty({ type: String, example: "MEMBER_SELF_SERVICE" })
  source!: string;

  @ApiProperty({ type: String, format: "date-time" })
  acceptedAt!: Date;

  @ApiProperty({
    type: Boolean,
    description: "False on the first acceptance; true when this Member had already accepted it",
  })
  alreadyAccepted!: boolean;
}

@ApiTags("Member Terms")
@Controller("api/v1/member/terms")
@UseGuards(MemberAuthGuard)
export class MemberTermsController {
  constructor(@Inject(TermsService) private readonly terms: TermsService) {}

  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Read the Member's currently required Terms version(s) and acceptance status",
    description:
      "Reports the Terms version(s) that are published and effective right now, plus this Member's durable acceptances. An acceptance is never assumed.",
  })
  @ApiOkResponse({ type: MemberTermsBody })
  async getTerms(@Req() request: MemberAuthenticatedRequest): Promise<MemberTermsBody> {
    try {
      const status = await this.terms.getMemberTerms(
        request.memberAuth!.memberId,
        new Date(),
      );
      return toTermsBody(status);
    } catch (error) {
      throw toOnboardingHttp(error);
    }
  }

  @Post("accept")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Accept the currently required Terms version",
    description:
      "Records immutable acceptance evidence once per Member + Terms version. Idempotent: replaying the same Idempotency-Key returns the prior result, and re-accepting the same version returns the existing evidence instead of duplicating it. A version that is not currently required is denied.",
  })
  @ApiHeader({
    name: IDEMPOTENCY_HEADER,
    required: true,
    description: "Scoped Idempotency-Key. Same key + same payload returns the prior result.",
  })
  @ApiBody({ type: AcceptTermsRequestBody })
  @ApiOkResponse({ type: AcceptTermsBody })
  async accept(
    @Req() request: MemberAuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<AcceptTermsBody> {
    const input = parseBody(body);
    const idempotencyKey = request.header(IDEMPOTENCY_HEADER)?.trim();
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Idempotency-Key header is required for accepting Member Terms",
        details: {},
        correlationId: currentCorrelationId() ?? "unknown",
      });
    }
    try {
      const result = await this.terms.acceptTerms({
        memberId: request.memberAuth!.memberId,
        documentId: input.documentId,
        idempotencyKey,
        correlationId: currentCorrelationId() ?? request.memberAuth!.sessionId,
        evidence: {
          ipAddress: request.ip ?? null,
          userAgent: request.header("user-agent") ?? null,
        },
        at: new Date(),
      });
      return {
        acceptanceId: result.acceptance.id,
        memberId: result.acceptance.memberId,
        documentId: result.acceptance.documentId,
        documentCode: result.acceptance.documentCode,
        documentVersion: result.acceptance.documentVersion,
        contentDigest: result.acceptance.contentDigest,
        source: result.acceptance.source,
        acceptedAt: result.acceptance.acceptedAt,
        alreadyAccepted: result.alreadyAccepted,
      };
    } catch (error) {
      throw toOnboardingHttp(error);
    }
  }
}

export function toTermsBody(status: MemberTermsStatus): MemberTermsBody {
  return {
    memberId: status.memberId,
    asOf: status.asOf,
    required: status.required.map((entry) => ({
      documentId: entry.document.id,
      code: entry.document.code,
      version: entry.document.version,
      title: entry.document.title,
      body: entry.document.body,
      contentDigest: entry.document.contentDigest,
      policyVersion: entry.document.policyVersion,
      effectiveFrom: entry.document.effectiveFrom,
      effectiveUntil: entry.document.effectiveUntil,
      accepted: entry.accepted,
      acceptedAt: entry.acceptedAt,
      acceptanceId: entry.acceptanceId,
    })),
    acceptances: status.acceptances.map((acceptance) => ({
      id: acceptance.id,
      memberId: acceptance.memberId,
      documentId: acceptance.documentId,
      documentCode: acceptance.documentCode,
      documentVersion: acceptance.documentVersion,
      contentDigest: acceptance.contentDigest,
      source: acceptance.source,
      acceptedAt: acceptance.acceptedAt,
    })),
    satisfied: status.satisfied,
  };
}

function parseBody(value: unknown): z.infer<typeof acceptTermsSchema> {
  const parsed = acceptTermsSchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "documentId is required",
      details: { field: parsed.error.issues[0]?.path.join(".") ?? "body" },
      correlationId: currentCorrelationId() ?? "unknown",
    });
  }
  return parsed.data;
}
