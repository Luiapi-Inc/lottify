import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from "@nestjs/swagger";
import { MemberAuthService } from "../../../src/contexts/identity-access/application/member-auth.service";
import {
  MemberAuthGuard,
  type MemberAuthenticatedRequest,
} from "./member-auth.guard";

class MemberSessionViewBody {
  @ApiProperty({ type: String })
  sessionId!: string;

  @ApiProperty({ type: String, nullable: true })
  deviceId!: string | null;

  @ApiProperty({ type: String, format: "date-time" })
  expiresAt!: Date;
}

class MemberDeviceViewBody {
  @ApiProperty({ type: String })
  deviceId!: string;

  @ApiProperty({ type: String, nullable: true })
  name!: string | null;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  lastUsedAt!: Date | null;
}

class MemberRevokedResponse {
  @ApiProperty({ type: Boolean, example: true })
  revoked!: true;
}

@ApiTags("Member Sessions & Devices")
@Controller("api/v1/member")
@UseGuards(MemberAuthGuard)
export class MemberSessionDeviceController {
  constructor(
    @Inject(MemberAuthService)
    private readonly memberAuth: MemberAuthService,
  ) {}

  @Get("sessions")
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the Member's active sessions" })
  @ApiOkResponse({ type: MemberSessionViewBody, isArray: true })
  sessions(@Req() request: MemberAuthenticatedRequest): Promise<unknown> {
    return this.memberAuth.listSessions(request.memberAuth!.memberId);
  }

  @Delete("sessions/:id")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Revoke one of the Member's sessions" })
  @ApiOkResponse({ type: MemberRevokedResponse })
  async revokeSession(
    @Param("id") sessionId: string,
    @Req() request: MemberAuthenticatedRequest,
  ): Promise<MemberRevokedResponse> {
    await this.memberAuth.revokeSession(request.memberAuth!.memberId, sessionId);
    return { revoked: true };
  }

  @Get("devices")
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the Member's logical devices" })
  @ApiOkResponse({ type: MemberDeviceViewBody, isArray: true })
  devices(@Req() request: MemberAuthenticatedRequest): Promise<unknown> {
    return this.memberAuth.listDevices(request.memberAuth!.memberId);
  }

  @Delete("devices/:id")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Revoke all sessions for one of the Member's devices" })
  @ApiOkResponse({ type: MemberRevokedResponse })
  async revokeDevice(
    @Param("id") deviceId: string,
    @Req() request: MemberAuthenticatedRequest,
  ): Promise<MemberRevokedResponse> {
    await this.memberAuth.revokeDevice(request.memberAuth!.memberId, deviceId);
    return { revoked: true };
  }
}
