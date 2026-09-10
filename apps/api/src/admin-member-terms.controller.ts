import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { createHash } from "node:crypto";
import { z } from "zod";
import { AdminAuthService } from "../../../src/contexts/identity-access/application/admin-auth.service";
import {
  TermsService,
  type TermsDocumentView,
} from "../../../src/contexts/member/application/terms.service";
import {
  MEMBER_TERMS_PUBLISH_ACTION_CLASS,
  TERMS_DOCUMENT_STATES,
} from "../../../src/contexts/member/domain/terms-document";
import {
  AdminAuthGuard,
  type AdminAuthenticatedRequest,
} from "./admin-auth.guard";
import {
  AdminCapabilityGuard,
  RequireAdminCapabilities,
} from "./admin-capability.guard";
import { currentCorrelationId } from "./correlation";
import { toOnboardingHttp } from "./onboarding-error.mapper";

const IDEMPOTENCY_HEADER = "idempotency-key";

const createVersionSchema = z
  .object({
    code: z.string().trim().min(1).max(100).default("MEMBER_TERMS"),
    version: z.number().int().min(1),
    title: z.string().trim().min(1).max(200),
    body: z.string().min(1).max(100_000),
    policyVersion: z.string().trim().min(1).max(200),
    effectiveFrom: z.string().trim().min(1),
    effectiveUntil: z.string().trim().min(1).nullable().optional(),
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

const expectedVersionSchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

class CreateTermsVersionBody {
  @ApiProperty({ type: String, required: false, default: "MEMBER_TERMS" })
  code?: string;

  @ApiProperty({ type: Number, example: 1 })
  version!: number;

  @ApiProperty({ type: String, example: "ข้อตกลงการใช้งาน Lottify" })
  title!: string;

  @ApiProperty({ type: String, description: "The exact Terms text a Member accepts" })
  body!: string;

  @ApiProperty({ type: String, description: "Effective policy version governing this document" })
  policyVersion!: string;

  @ApiProperty({ type: String, example: "2026-10-01T00:00:00.000Z" })
  effectiveFrom!: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  effectiveUntil?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  reason?: string | null;
}

class ExpectedRevisionBody {
  @ApiProperty({ type: Number, example: 1 })
  expectedRevision!: number;

  @ApiProperty({ type: String, required: false })
  reason?: string;
}

class TermsVersionBody {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ type: Number })
  version!: number;

  @ApiProperty({ type: Number, description: "Optimistic-concurrency revision" })
  revision!: number;

  @ApiProperty({ enum: [...TERMS_DOCUMENT_STATES] })
  state!: string;

  @ApiProperty({ type: String })
  title!: string;

  @ApiProperty({ type: String })
  body!: string;

  @ApiProperty({ type: String })
  contentDigest!: string;

  @ApiProperty({ type: String })
  policyVersion!: string;

  @ApiProperty({ type: String, format: "date-time" })
  effectiveFrom!: Date;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  effectiveUntil!: Date | null;

  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  publishedAt!: Date | null;

  @ApiProperty({ type: String, nullable: true })
  approvalEvidenceRef!: string | null;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  updatedAt!: Date;
}

class TermsVersionListBody {
  @ApiProperty({ type: [TermsVersionBody] })
  items!: TermsVersionBody[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

@ApiTags("admin-member-terms")
@ApiBearerAuth()
@Controller("api/v1/admin/member-terms")
@UseGuards(AdminAuthGuard, AdminCapabilityGuard)
export class AdminMemberTermsController {
  constructor(
    @Inject(TermsService)
    private readonly terms: TermsService,
    @Inject(AdminAuthService)
    private readonly adminAuth: AdminAuthService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireAdminCapabilities("member-terms.manage")
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true })
  @ApiBody({ type: CreateTermsVersionBody })
  @ApiCreatedResponse({ type: TermsVersionBody })
  @ApiOperation({ summary: "Author a DRAFT Member Terms version" })
  async createVersion(
    @Req() request: AdminAuthenticatedRequest,
    @Body() body: CreateTermsVersionBody,
    @Headers(IDEMPOTENCY_HEADER) key?: string,
  ): Promise<TermsVersionBody> {
    const admin = requiredAdmin(request);
    const input = parseBody(createVersionSchema, body, "Invalid Member Terms version request");
    return this.executeIdempotent(
      request,
      key,
      `admin:${admin.adminId}:member-terms:create`,
      input,
      async () =>
        toVersionBody(
          await this.terms.createDraftVersion({
            code: input.code,
            version: input.version,
            title: input.title,
            body: input.body,
            policyVersion: input.policyVersion,
            effectiveFrom: parseInstant(input.effectiveFrom, "effectiveFrom"),
            effectiveUntil: input.effectiveUntil
              ? parseInstant(input.effectiveUntil, "effectiveUntil")
              : null,
            reason: input.reason ?? null,
            actor: { adminId: admin.adminId, sessionId: admin.sessionId, role: admin.role },
          }),
        ),
    );
  }

  @Get()
  @RequireAdminCapabilities("member-terms.read")
  @ApiOperation({ summary: "List Member Terms versions" })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiQuery({ name: "state", required: false, enum: [...TERMS_DOCUMENT_STATES] })
  @ApiOkResponse({ type: TermsVersionListBody })
  async list(
    @Req() request: AdminAuthenticatedRequest,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
    @Query("state") state?: string,
  ): Promise<TermsVersionListBody> {
    try {
      const page = await this.terms.listVersions({
        limit: parseLimit(limit),
        cursor: cursor?.trim() || undefined,
        state: parseState(state),
      });
      return {
        items: page.items.map(toVersionBody),
        nextCursor: page.nextCursor,
      };
    } catch (error) {
      throw toOnboardingHttp(error);
    }
  }

  @Get(":id")
  @RequireAdminCapabilities("member-terms.read")
  @ApiOperation({ summary: "Read a Member Terms version" })
  @ApiOkResponse({ type: TermsVersionBody })
  async get(
    @Req() request: AdminAuthenticatedRequest,
    @Param("id") documentId: string,
  ): Promise<TermsVersionBody> {
    try {
      return toVersionBody(await this.terms.getVersion(documentId));
    } catch (error) {
      throw toOnboardingHttp(error);
    }
  }

  @Post(":id/publish")
  @HttpCode(HttpStatus.OK)
  @RequireAdminCapabilities("member-terms.approve")
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true })
  @ApiBody({ type: ExpectedRevisionBody })
  @ApiOkResponse({ type: TermsVersionBody })
  @ApiOperation({
    summary: "Approve and publish a Member Terms version (fresh MFA required)",
    description:
      "Maker-checker: the publishing Admin must differ from the author. A published version becomes the required Terms for every Member inside its effective window and can never be rewritten.",
  })
  async publish(
    @Req() request: AdminAuthenticatedRequest,
    @Param("id") documentId: string,
    @Body() body: ExpectedRevisionBody,
    @Headers(IDEMPOTENCY_HEADER) key?: string,
  ): Promise<TermsVersionBody> {
    const admin = requiredAdmin(request);
    const input = parseBody(expectedVersionSchema, body, "expectedRevision is required");
    const reason = input.reason ?? "Approve and publish Member Terms version";
    try {
      const reauth = await this.adminAuth.requireFreshMfa(admin, MEMBER_TERMS_PUBLISH_ACTION_CLASS);
      return (await this.executeIdempotent(
        request,
        key,
        `admin:${admin.adminId}:member-terms:${documentId}:publish`,
        input,
        async () =>
          toVersionBody(
            await this.terms.publishVersion({
              documentId,
              expectedRevision: input.expectedRevision,
              actor: { adminId: admin.adminId, sessionId: admin.sessionId, role: admin.role },
              reauthEvidenceId: reauth.id,
              reason,
              correlationId: correlationId(request),
            }),
          ),
      )) as TermsVersionBody;
    } catch (error) {
      throw toOnboardingHttp(error);
    }
  }

  @Post(":id/retire")
  @HttpCode(HttpStatus.OK)
  @RequireAdminCapabilities("member-terms.manage")
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true })
  @ApiBody({ type: ExpectedRevisionBody })
  @ApiOkResponse({ type: TermsVersionBody })
  @ApiOperation({ summary: "Retire a published Member Terms version" })
  async retire(
    @Req() request: AdminAuthenticatedRequest,
    @Param("id") documentId: string,
    @Body() body: ExpectedRevisionBody,
    @Headers(IDEMPOTENCY_HEADER) key?: string,
  ): Promise<TermsVersionBody> {
    const admin = requiredAdmin(request);
    const input = parseBody(expectedVersionSchema, body, "expectedRevision is required");
    try {
      return (await this.executeIdempotent(
        request,
        key,
        `admin:${admin.adminId}:member-terms:${documentId}:retire`,
        input,
        async () =>
          toVersionBody(
            await this.terms.retireVersion({
              documentId,
              expectedRevision: input.expectedRevision,
              actor: { adminId: admin.adminId, sessionId: admin.sessionId, role: admin.role },
              reason: input.reason ?? "Retire Member Terms version",
            }),
          ),
      )) as TermsVersionBody;
    } catch (error) {
      throw toOnboardingHttp(error);
    }
  }

  private async executeIdempotent(
    request: AdminAuthenticatedRequest,
    key: string | undefined,
    scope: string,
    payload: Record<string, unknown>,
    execute: () => Promise<TermsVersionBody>,
  ): Promise<TermsVersionBody> {
    if (!key?.trim()) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        "IDEMPOTENCY_KEY_REQUIRED",
        "Idempotency-Key header is required",
        {},
      );
    }
    const fingerprint = createHash("sha256")
      .update(canonicalJson(payload), "utf8")
      .digest("hex");
    try {
      return (await this.terms.executeCommand(
        { scope, key: key.trim(), fingerprint, responseCode: 200 },
        execute,
      )) as TermsVersionBody;
    } catch (error) {
      throw toOnboardingHttp(error);
    }
  }
}

export function toVersionBody(view: TermsDocumentView): TermsVersionBody {
  return {
    id: view.id,
    code: view.code,
    version: view.version,
    revision: view.revision,
    state: view.state,
    title: view.title,
    body: view.body,
    contentDigest: view.contentDigest,
    policyVersion: view.policyVersion,
    effectiveFrom: view.effectiveFrom,
    effectiveUntil: view.effectiveUntil,
    reason: view.reason,
    publishedAt: view.publishedAt,
    approvalEvidenceRef: view.approvalEvidenceRef,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

function requiredAdmin(request: AdminAuthenticatedRequest) {
  if (!request.adminAuth) {
    throw apiError(
      HttpStatus.UNAUTHORIZED,
      "AUTHENTICATION_REQUIRED",
      "Admin authentication required",
      {},
    );
  }
  return request.adminAuth;
}

function correlationId(request: AdminAuthenticatedRequest): string {
  return currentCorrelationId() ?? request.adminAuth?.sessionId ?? "unknown";
}

function parseBody<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw apiError(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", message, {
      field: parsed.error.issues[0]?.path.join(".") ?? "body",
    });
  }
  return parsed.data;
}

function parseInstant(value: string, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      "VALIDATION_ERROR",
      `${field} must be an RFC 3339 timestamp`,
      { field },
    );
  }
  return date;
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      "VALIDATION_ERROR",
      "limit must be an integer between 1 and 100",
      { field: "limit" },
    );
  }
  return parsed;
}

function parseState(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if ((TERMS_DOCUMENT_STATES as readonly string[]).includes(value)) return value;
  throw apiError(
    HttpStatus.BAD_REQUEST,
    "VALIDATION_ERROR",
    "state must be DRAFT, PUBLISHED or RETIRED",
    { field: "state" },
  );
}

function apiError(
  status: number,
  code: string,
  message: string,
  details: Record<string, unknown>,
): HttpException {
  return new HttpException(
    { code, message, details, correlationId: currentCorrelationId() ?? "unknown" },
    status,
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.keys(item as Record<string, unknown>)
          .sort()
          .map((key) => [key, (item as Record<string, unknown>)[key]]),
      );
    }
    return item;
  });
}
