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
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
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

const otpRequestSchema = z.object({
  purpose: z.enum(["LOGIN", "REGISTER"]),
  phone: z.string().trim().min(1),
});
const otpVerifySchema = z.object({
  purpose: z.enum(["LOGIN", "REGISTER"]),
  phone: z.string().trim().min(1),
  code: z.string().regex(/^\d{4,8}$/),
  deviceName: z.string().trim().max(200).optional(),
});

class OtpRequestBody {
  @ApiProperty({ enum: ["LOGIN", "REGISTER"] })
  purpose!: "LOGIN" | "REGISTER";

  @ApiProperty({ type: String, example: "+66812345678" })
  phone!: string;
}

class OtpVerifyBody {
  @ApiProperty({ enum: ["LOGIN", "REGISTER"] })
  purpose!: "LOGIN" | "REGISTER";

  @ApiProperty({ type: String, example: "+66812345678" })
  phone!: string;

  @ApiProperty({ type: String, pattern: "^[0-9]{4,8}$", example: "123456" })
  code!: string;

  @ApiProperty({ type: String, required: false, example: "My Phone" })
  deviceName?: string;
}

class OtpRequestResponse {
  @ApiProperty({ enum: ["LOGIN", "REGISTER"] })
  purpose!: "LOGIN" | "REGISTER";

  @ApiProperty({ type: String, description: "Masked delivery target" })
  deliveredTo!: string;

  @ApiProperty({ type: Number, nullable: true })
  retryAfterSeconds!: number | null;
}

class MemberSessionResponse {
  @ApiProperty({ type: String })
  accessToken!: string;

  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ type: Boolean })
  accountCreated!: boolean;

  @ApiProperty({ type: String, nullable: true })
  deviceId!: string | null;
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
}

@ApiTags("Member Auth")
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
  @ApiOperation({ summary: "Verify an OTP and establish a Member session" })
  @ApiBody({ type: OtpVerifyBody })
  @ApiOkResponse({ type: MemberSessionResponse })
  async verifyOtp(
    @Body() body: OtpVerifyBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const input = parseBody(otpVerifySchema, body);
    const result = await this.memberAuth.verifyOtp(
      input.purpose,
      input.phone,
      input.code,
      input.deviceName,
    );
    this.setRefreshCookie(response, result.refreshToken);
    return {
      accessToken: result.accessToken,
      memberId: result.memberId,
      accountCreated: result.accountCreated,
      deviceId: result.deviceId,
    };
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Rotate the Member refresh credential" })
  @ApiOkResponse({ type: MemberSessionResponse })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
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
