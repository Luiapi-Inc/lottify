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
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  getSchemaPath,
} from "@nestjs/swagger";
import type { Request, Response } from "express";
import { z, type ZodType } from "zod";
import { MemberAuthService } from "../../../src/contexts/identity-access/application/member-auth.service";
import { getEnvironment } from "../../../src/platform/config/env";
import {
  MemberAuthGuard,
  type MemberAuthenticatedRequest,
} from "./member-auth.guard";

const MEMBER_REFRESH_COOKIE = "lottify_member_refresh";
const MEMBER_REFRESH_COOKIE_PATH = "/api/v1/member";

// CR #141: `LOGIN` is gone. OTP now only proves phone possession for account
// creation (REGISTER) and one-time credential enrollment (PASSWORD_ENROLL).
const OTP_SELF_SERVICE_PURPOSES = ["REGISTER", "PASSWORD_ENROLL"] as const;

const otpRequestSchema = z.object({
  purpose: z.enum(OTP_SELF_SERVICE_PURPOSES),
  phone: z.string().trim().min(1),
});
const otpVerifySchema = z.object({
  purpose: z.enum(OTP_SELF_SERVICE_PURPOSES),
  phone: z.string().trim().min(1),
  code: z.string().regex(/^\d{4,8}$/),
  password: z.string().min(1).max(256),
  deviceName: z.string().trim().max(200).optional(),
});
const loginSchema = z.object({
  // The API contract keeps the E.164 rule (CR #141 owner note): the phone format
  // is normalized by the client, never loosened server-side.
  phone: z.string().trim().min(1),
  password: z.string().min(1).max(256),
  deviceName: z.string().trim().max(200).optional(),
});
const passwordResetSchema = z.object({
  phone: z.string().trim().min(1),
  code: z.string().regex(/^\d{4,8}$/),
  password: z.string().min(1).max(256),
});
const recoveryOtpRequestSchema = z.object({
  phone: z.string().trim().min(1),
});
const recoveryOtpVerifySchema = z.object({
  phone: z.string().trim().min(1),
  code: z.string().regex(/^\d{4,8}$/),
});

class OtpRequestBody {
  @ApiProperty({ enum: [...OTP_SELF_SERVICE_PURPOSES] })
  purpose!: (typeof OTP_SELF_SERVICE_PURPOSES)[number];

  @ApiProperty({ type: String, example: "+668****5678" })
  phone!: string;
}

class OtpVerifyBody {
  @ApiProperty({ enum: [...OTP_SELF_SERVICE_PURPOSES] })
  purpose!: (typeof OTP_SELF_SERVICE_PURPOSES)[number];

  @ApiProperty({ type: String, example: "+668****5678" })
  phone!: string;

  @ApiProperty({ type: String, pattern: "^[0-9]{4,8}$", example: "123456" })
  code!: string;

  @ApiProperty({
    type: String,
    format: "password",
    description:
      "Member password. Required for both purposes: REGISTER stores it as the new account credential, PASSWORD_ENROLL sets it for an existing Member.",
  })
  password!: string;

  @ApiProperty({ type: String, required: false, example: "My Phone" })
  deviceName?: string;
}

class OtpRequestResponse {
  @ApiProperty({ enum: [...OTP_SELF_SERVICE_PURPOSES] })
  purpose!: (typeof OTP_SELF_SERVICE_PURPOSES)[number];

  @ApiProperty({ type: String, description: "Masked delivery target" })
  deliveredTo!: string;

  @ApiProperty({ type: Number, nullable: true })
  retryAfterSeconds!: number | null;
}

class MemberSessionResponse {
  @ApiProperty({ enum: ["REGISTER"] })
  purpose!: "REGISTER";

  @ApiProperty({ type: String })
  accessToken!: string;

  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ type: Boolean, example: true })
  accountCreated!: boolean;

  @ApiProperty({ type: String, nullable: true })
  deviceId!: string | null;
}

class PasswordEnrollResponse {
  @ApiProperty({ enum: ["PASSWORD_ENROLL"] })
  purpose!: "PASSWORD_ENROLL";

  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ type: Boolean, example: true })
  passwordSet!: true;

  @ApiProperty({ type: String, format: "date-time" })
  passwordUpdatedAt!: Date;
}

class MemberLoginBody {
  @ApiProperty({ type: String, example: "+668****5678" })
  phone!: string;

  @ApiProperty({ type: String, format: "password" })
  password!: string;

  @ApiProperty({ type: String, required: false, example: "My Phone" })
  deviceName?: string;
}

// Login returns the rotating refresh credential as an httpOnly cookie, so the
// JSON body carries only the short-lived access token plus the resolved identity.
class MemberLoginResponse {
  @ApiProperty({ type: String })
  accessToken!: string;

  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ type: String, nullable: true })
  deviceId!: string | null;
}

class PasswordResetBody {
  @ApiProperty({ type: String, example: "+668****5678" })
  phone!: string;

  @ApiProperty({ type: String, pattern: "^[0-9]{4,8}$", example: "123456" })
  code!: string;

  @ApiProperty({ type: String, format: "password" })
  password!: string;
}

class PasswordResetResponse {
  @ApiProperty({ enum: ["RECOVERY"] })
  purpose!: "RECOVERY";

  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ type: Boolean, example: true })
  passwordReset!: true;

  @ApiProperty({ type: String, format: "date-time" })
  passwordUpdatedAt!: Date;
}

class RecoveryOtpRequestBody {
  @ApiProperty({ type: String, example: "+66812345678" })
  phone!: string;
}

class RecoveryOtpVerifyBody {
  @ApiProperty({ type: String, example: "+66812345678" })
  phone!: string;

  @ApiProperty({ type: String, pattern: "^[0-9]{4,8}$", example: "123456" })
  code!: string;
}

class RecoveryOtpRequestResponse {
  @ApiProperty({ enum: ["RECOVERY"] })
  purpose!: "RECOVERY";

  @ApiProperty({ type: String, description: "Delivery target for the recovery possession challenge" })
  deliveredTo!: string;

  @ApiProperty({ type: Number, nullable: true })
  retryAfterSeconds!: number | null;
}

class RecoveryOtpVerificationResponse {
  @ApiProperty({ enum: ["RECOVERY"] })
  purpose!: "RECOVERY";

  @ApiProperty({ type: Boolean, example: true })
  verified!: true;

  @ApiProperty({ type: String, description: "Opaque possession-evidence reference for the later recovery workflow" })
  evidenceRef!: string;
}

// A refresh rotates the credential in place: the rotating refresh token is set as
// an httpOnly cookie, so the JSON body carries only the new short-lived access
// token. The body deliberately does NOT mirror MemberSessionResponse.
class MemberRefreshResponse {
  @ApiProperty({ type: String })
  accessToken!: string;
}

class MemberRevokedResponse {
  @ApiProperty({ type: Boolean, example: true })
  revoked!: true;
}

class MemberMeResponse {
  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ type: String })
  phone!: string;

  @ApiProperty({ enum: ["ACTIVE", "DISABLED"] })
  status!: string;

  @ApiProperty({
    type: Boolean,
    description:
      "False when this Member still has to complete password enrollment (every pre-CR #141 account).",
  })
  passwordEnrolled!: boolean;
}

@ApiTags("Member Auth")
@ApiExtraModels(MemberSessionResponse, PasswordEnrollResponse)
@Controller("api/v1/member/auth")
export class MemberAuthController {
  constructor(
    @Inject(MemberAuthService)
    private readonly memberAuth: MemberAuthService,
  ) {}

  @Post("otp/request")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Request a purpose-scoped OTP for a Member phone" })
  @ApiBody({ type: OtpRequestBody })
  @ApiOkResponse({ type: OtpRequestResponse })
  requestOtp(@Body() body: OtpRequestBody): Promise<unknown> {
    const input = parseBody(otpRequestSchema, body);
    return this.memberAuth.requestOtp(input.purpose, input.phone);
  }

  @Post("otp/verify")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Verify an OTP: REGISTER creates the account with the supplied password and authenticates, PASSWORD_ENROLL sets a credential without a session",
  })
  @ApiBody({ type: OtpVerifyBody })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(MemberSessionResponse) },
        { $ref: getSchemaPath(PasswordEnrollResponse) },
      ],
    },
  })
  async verifyOtp(
    @Body() body: OtpVerifyBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const input = parseBody(otpVerifySchema, body);
    const result = await this.memberAuth.verifyOtp(
      input.purpose,
      input.phone,
      input.code,
      input.password,
      input.deviceName,
    );
    if (result.purpose === "PASSWORD_ENROLL") return result;
    this.setRefreshCookie(response, result.refreshToken);
    return {
      purpose: result.purpose,
      accessToken: result.accessToken,
      memberId: result.memberId,
      accountCreated: result.accountCreated,
      deviceId: result.deviceId,
    };
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Authenticate a Member with phone + password and establish a session",
  })
  @ApiBody({ type: MemberLoginBody })
  @ApiOkResponse({ type: MemberLoginResponse })
  async login(
    @Body() body: MemberLoginBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MemberLoginResponse> {
    const input = parseBody(loginSchema, body);
    const result = await this.memberAuth.login({
      phone: input.phone,
      password: input.password,
      ...(input.deviceName ? { deviceName: input.deviceName } : {}),
    });
    this.setRefreshCookie(response, result.refreshToken);
    return {
      accessToken: result.accessToken,
      memberId: result.memberId,
      deviceId: result.deviceId,
    };
  }

  @Post("password/reset")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Reset a forgotten Member password using RECOVERY OTP possession evidence",
  })
  @ApiBody({ type: PasswordResetBody })
  @ApiOkResponse({ type: PasswordResetResponse })
  resetPassword(@Body() body: PasswordResetBody): Promise<PasswordResetResponse> {
    const input = parseBody(passwordResetSchema, body);
    return this.memberAuth.resetMemberPassword(input);
  }

  @Post("recovery/otp/request")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Request a RECOVERY OTP possession challenge without establishing authentication",
  })
  @ApiBody({ type: RecoveryOtpRequestBody })
  @ApiOkResponse({ type: RecoveryOtpRequestResponse })
  requestRecoveryOtp(
    @Body() body: RecoveryOtpRequestBody,
  ): Promise<RecoveryOtpRequestResponse> {
    const input = parseBody(recoveryOtpRequestSchema, body);
    return this.memberAuth.requestRecoveryOtp(input.phone);
  }

  @Post("recovery/otp/verify")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Verify RECOVERY OTP possession evidence without issuing a Member session",
  })
  @ApiBody({ type: RecoveryOtpVerifyBody })
  @ApiOkResponse({ type: RecoveryOtpVerificationResponse })
  verifyRecoveryOtp(
    @Body() body: RecoveryOtpVerifyBody,
  ): Promise<RecoveryOtpVerificationResponse> {
    const input = parseBody(recoveryOtpVerifySchema, body);
    return this.memberAuth.verifyRecoveryOtp(input.phone, input.code);
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Rotate the Member refresh credential" })
  @ApiOkResponse({ type: MemberRefreshResponse })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MemberRefreshResponse> {
    const refreshToken = readCookie(request, MEMBER_REFRESH_COOKIE);
    if (!refreshToken) {
      throw new UnauthorizedException("Member refresh cookie required");
    }
    const tokens = await this.memberAuth.refresh(refreshToken);
    this.setRefreshCookie(response, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Revoke the current Member refresh session" })
  @ApiOkResponse({ type: MemberRevokedResponse })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MemberRevokedResponse> {
    try {
      return await this.memberAuth.logout(
        readCookie(request, MEMBER_REFRESH_COOKIE),
      );
    } finally {
      this.clearRefreshCookie(response);
    }
  }

  @Post("revoke-all")
  @HttpCode(HttpStatus.OK)
  @UseGuards(MemberAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Revoke every active session for the Member" })
  @ApiOkResponse({ type: MemberRevokedResponse })
  revokeAll(@Req() request: MemberAuthenticatedRequest): Promise<MemberRevokedResponse> {
    return this.memberAuth.revokeAll(request.memberAuth!.memberId);
  }

  @Get("me")
  @UseGuards(MemberAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Return server-authoritative Member identity" })
  @ApiOkResponse({ type: MemberMeResponse })
  me(@Req() request: MemberAuthenticatedRequest): Promise<unknown> {
    return this.memberAuth.me(request.memberAuth!.memberId);
  }

  private setRefreshCookie(response: Response, refreshToken: string): void {
    const env = getEnvironment();
    response.cookie(MEMBER_REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: env.APP_ENV === "staging" || env.APP_ENV === "production",
      sameSite: "lax",
      path: MEMBER_REFRESH_COOKIE_PATH,
      maxAge: env.REFRESH_TOKEN_TTL_SECONDS * 1_000,
    });
  }

  private clearRefreshCookie(response: Response): void {
    const env = getEnvironment();
    response.clearCookie(MEMBER_REFRESH_COOKIE, {
      httpOnly: true,
      secure: env.APP_ENV === "staging" || env.APP_ENV === "production",
      sameSite: "lax",
      path: MEMBER_REFRESH_COOKIE_PATH,
    });
  }
}

function parseBody<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException("Invalid Member request");
  }
  return parsed.data;
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}
