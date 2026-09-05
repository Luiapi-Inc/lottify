import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from "@nestjs/swagger";
import type { Request, Response } from "express";
import { z, type ZodType } from "zod";
import { AdminAuthService } from "../../../src/contexts/identity-access/application/admin-auth.service";
import {
  ADMIN_CAPABILITIES,
  ADMIN_ROLES,
  type AdminCapability,
  type AdminRole,
} from "../../../src/contexts/identity-access/domain/admin-auth.repository";
import { getEnvironment } from "../../../src/platform/config/env";
import {
  AdminAuthGuard,
  type AdminAuthenticatedRequest,
} from "./admin-auth.guard";

const ADMIN_REFRESH_COOKIE = "lottify_admin_refresh";
const ADMIN_REFRESH_COOKIE_PATH = "/api/v1/admin/auth";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
const setupSchema = z.object({ setupToken: z.string().min(1) });
const confirmSchema = z.object({
  setupToken: z.string().min(1),
  secret: z.string().min(16).max(128),
  code: z.string().regex(/^\d{6}$/),
});
const verifySchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});
const reauthSchema = z.object({
  actionClass: z.string().trim().min(1).max(100),
  code: z.string().regex(/^\d{6}$/),
});

class AdminLoginBody {
  @ApiProperty({ type: String, format: "email", example: "admin@example.com" })
  email!: string;

  @ApiProperty({ type: String, format: "password" })
  password!: string;
}

class AdminMfaSetupBody {
  @ApiProperty({ type: String })
  setupToken!: string;
}

class AdminMfaConfirmBody {
  @ApiProperty({ type: String })
  setupToken!: string;

  @ApiProperty({ type: String, example: "JBSWY3DPEHPK3PXP" })
  secret!: string;

  @ApiProperty({ type: String, pattern: "^[0-9]{6}$", example: "123456" })
  code!: string;
}

class AdminMfaVerifyBody {
  @ApiProperty({ type: String })
  challengeToken!: string;

  @ApiProperty({ type: String, pattern: "^[0-9]{6}$", example: "123456" })
  code!: string;
}

class AdminReauthBody {
  @ApiProperty({ type: String, example: "accounting-period.close" })
  actionClass!: string;

  @ApiProperty({ type: String, pattern: "^[0-9]{6}$", example: "123456" })
  code!: string;
}

class AdminAccessTokenResponse {
  @ApiProperty({ type: String })
  accessToken!: string;
}

class AdminRevokedResponse {
  @ApiProperty({ type: Boolean, example: true })
  revoked!: true;
}

class AdminMeResponse {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String, format: "email" })
  email!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ enum: [...ADMIN_ROLES] })
  role!: AdminRole;

  @ApiProperty({ enum: [...ADMIN_CAPABILITIES], isArray: true })
  capabilities!: readonly AdminCapability[];
}

@ApiTags("Admin Auth")
@Controller("api/v1/admin/auth")
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Authenticate Admin credentials and start mandatory MFA" })
  login(@Body() body: AdminLoginBody) {
    const input = parseBody(loginSchema, body);
    return this.adminAuth.login(input.email, input.password);
  }

  @Post("mfa/setup")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Create an Admin TOTP enrollment secret" })
  mfaSetup(@Body() body: AdminMfaSetupBody) {
    const input = parseBody(setupSchema, body);
    return this.adminAuth.setupMfa(input.setupToken);
  }

  @Post("mfa/confirm")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Confirm and enable mandatory Admin TOTP MFA" })
  mfaConfirm(@Body() body: AdminMfaConfirmBody) {
    const input = parseBody(confirmSchema, body);
    return this.adminAuth.confirmMfa(input.setupToken, input.secret, input.code);
  }

  @Post("mfa/verify")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Verify Admin MFA and establish the authenticated session" })
  @ApiOkResponse({ type: AdminAccessTokenResponse })
  async mfaVerify(
    @Body() body: AdminMfaVerifyBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AdminAccessTokenResponse> {
    const input = parseBody(verifySchema, body);
    const tokens = await this.adminAuth.verifyMfa(
      input.challengeToken,
      input.code,
      request.ip,
      request.get("user-agent"),
    );
    this.setRefreshCookie(response, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Rotate the HttpOnly Admin refresh credential" })
  @ApiOkResponse({ type: AdminAccessTokenResponse })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AdminAccessTokenResponse> {
    const refreshToken = readCookie(request, ADMIN_REFRESH_COOKIE);
    if (!refreshToken) {
      throw new UnauthorizedException("Admin refresh cookie required");
    }
    const tokens = await this.adminAuth.refresh(
      refreshToken,
      request.ip,
      request.get("user-agent"),
    );
    this.setRefreshCookie(response, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Revoke the current Admin refresh-token family" })
  @ApiOkResponse({ type: AdminRevokedResponse })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AdminRevokedResponse> {
    try {
      return await this.adminAuth.logout(readCookie(request, ADMIN_REFRESH_COOKIE));
    } finally {
      this.clearRefreshCookie(response);
    }
  }

  @Post("revoke-all")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Revoke every active session for the current Admin" })
  @ApiOkResponse({ type: AdminRevokedResponse })
  revokeAll(@Req() request: AdminAuthenticatedRequest) {
    return this.adminAuth.revokeAll(request.adminAuth!.adminId);
  }

  @Post("me")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Return server-authoritative Admin identity and capabilities" })
  @ApiOkResponse({ type: AdminMeResponse })
  me(@Req() request: AdminAuthenticatedRequest) {
    return this.adminAuth.me(request.adminAuth!);
  }

  @Post("reauth")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create scoped fresh-MFA evidence for a sensitive action class" })
  reauth(
    @Body() body: AdminReauthBody,
    @Req() request: AdminAuthenticatedRequest,
  ) {
    const input = parseBody(reauthSchema, body);
    return this.adminAuth.reauthenticate(
      request.adminAuth!,
      input.actionClass,
      input.code,
    );
  }

  private setRefreshCookie(response: Response, refreshToken: string): void {
    const env = getEnvironment();
    response.cookie(ADMIN_REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: env.APP_ENV === "staging" || env.APP_ENV === "production",
      sameSite: "lax",
      path: ADMIN_REFRESH_COOKIE_PATH,
      maxAge: env.REFRESH_TOKEN_TTL_SECONDS * 1_000,
    });
  }

  private clearRefreshCookie(response: Response): void {
    const env = getEnvironment();
    response.clearCookie(ADMIN_REFRESH_COOKIE, {
      httpOnly: true,
      secure: env.APP_ENV === "staging" || env.APP_ENV === "production",
      sameSite: "lax",
      path: ADMIN_REFRESH_COOKIE_PATH,
    });
  }
}

function parseBody<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException("Invalid Admin authentication request");
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
