import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";
import {
  ProfileService,
  type MemberProfileView,
} from "../../../src/contexts/member/application/profile.service";
import {
  assertNoServerOwnedProfileFields,
  MANDATORY_PROFILE_FIELDS,
} from "../../../src/contexts/member/domain/profile-fields";
import { currentCorrelationId } from "./correlation";
import {
  MemberAuthGuard,
  type MemberAuthenticatedRequest,
} from "./member-auth.guard";
import { toOnboardingHttp } from "./onboarding-error.mapper";

/**
 * Strict on purpose: only the Member's own editable profile fields are
 * accepted. A body carrying a server-owned fact (`phone`, `status`, KYC or Terms
 * state) is a client error — never a silent no-op that could look accepted.
 */
const profilePatchSchema = z
  .object({
    fullName: z.string().trim().max(200).nullable().optional(),
    dateOfBirth: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "dateOfBirth must be a YYYY-MM-DD calendar date")
      .nullable()
      .optional(),
    province: z.string().trim().max(100).nullable().optional(),
  })
  .strict();

class MemberProfileBody {
  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ type: String, description: "Login identity owned by Identity & Access" })
  phone!: string;

  @ApiProperty({ type: String, nullable: true })
  fullName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "1990-01-01" })
  dateOfBirth!: string | null;

  @ApiProperty({ type: String, nullable: true })
  province!: string | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  profileUpdatedAt!: Date | null;

  @ApiProperty({ enum: [...MANDATORY_PROFILE_FIELDS], isArray: true })
  mandatoryFields!: string[];

  @ApiProperty({
    enum: [...MANDATORY_PROFILE_FIELDS],
    isArray: true,
    description: "Mandatory fields with no stored value",
  })
  missingMandatoryFields!: string[];

  @ApiProperty({
    type: Boolean,
    description: "True only when every mandatory field has a stored value",
  })
  profileComplete!: boolean;
}

class UpdateMemberProfileBody {
  @ApiProperty({ type: String, required: false, nullable: true })
  fullName?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true, example: "1990-01-01" })
  dateOfBirth?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  province?: string | null;
}

@ApiTags("Member Profile")
@Controller("api/v1/member/profile")
@UseGuards(MemberAuthGuard)
export class MemberProfileController {
  constructor(@Inject(ProfileService) private readonly profiles: ProfileService) {}

  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Read the Member's own profile and which mandatory fields are missing",
  })
  @ApiOkResponse({ type: MemberProfileBody })
  async getProfile(@Req() request: MemberAuthenticatedRequest): Promise<MemberProfileBody> {
    try {
      return toProfileBody(await this.profiles.getProfile(request.memberAuth!.memberId));
    } catch (error) {
      throw toOnboardingHttp(error);
    }
  }

  @Patch()
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Update the Member's own profile fields",
    description:
      "Editable fields are the mandatory profile data only. Server-owned facts (phone, account status, KYC and Terms state) can never be set through the profile.",
  })
  @ApiBody({ type: UpdateMemberProfileBody })
  @ApiOkResponse({ type: MemberProfileBody })
  async updateProfile(
    @Req() request: MemberAuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<MemberProfileBody> {
    try {
      assertNoServerOwnedProfileFields(asRecord(body));
      const patch = parsePatch(body);
      const profile = await this.profiles.updateProfile(
        request.memberAuth!.memberId,
        patch,
      );
      return toProfileBody(profile);
    } catch (error) {
      throw toOnboardingHttp(error);
    }
  }
}

export function toProfileBody(profile: MemberProfileView): MemberProfileBody {
  return {
    memberId: profile.memberId,
    phone: profile.phone,
    fullName: profile.fullName,
    dateOfBirth: profile.dateOfBirth,
    province: profile.province,
    profileUpdatedAt: profile.profileUpdatedAt,
    mandatoryFields: [...profile.mandatoryFields],
    missingMandatoryFields: [...profile.missingMandatoryFields],
    profileComplete: profile.profileComplete,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "A Member profile patch body is required",
      details: { field: "body" },
      correlationId: currentCorrelationId() ?? "unknown",
    });
  }
  return value as Record<string, unknown>;
}

function parsePatch(value: unknown): z.infer<typeof profilePatchSchema> {
  const parsed = profilePatchSchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "Invalid Member profile patch",
      details: {
        field: parsed.error.issues[0]?.path.join(".") ?? "body",
        reason: parsed.error.issues[0]?.message ?? "invalid value",
      },
      correlationId: currentCorrelationId() ?? "unknown",
    });
  }
  return parsed.data;
}
