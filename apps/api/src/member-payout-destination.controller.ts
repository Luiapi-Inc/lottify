import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from "@nestjs/swagger";
import { z, type ZodType } from "zod";
import { PayoutDestinationService } from "../../../src/contexts/payments/application/payout-destination.service";
import {
  PAYOUT_DESTINATION_TYPES,
  PayoutDestinationError,
  type PayoutDestination,
  type PayoutDestinationType,
} from "../../../src/contexts/payments/domain/payout-destination";
import { currentCorrelationId } from "./correlation";
import {
  MemberAuthGuard,
  type MemberAuthenticatedRequest,
} from "./member-auth.guard";

const addDestinationSchema = z.object({
  type: z.enum(PAYOUT_DESTINATION_TYPES),
  bankCode: z.string().trim().min(1).max(32),
  accountNumber: z.string().trim().min(6).max(40),
  accountHolderName: z.string().trim().min(1).max(140),
});

class AddPayoutDestinationBody {
  @ApiProperty({ enum: [...PAYOUT_DESTINATION_TYPES], example: "BANK_ACCOUNT" })
  type!: PayoutDestinationType;

  @ApiProperty({ type: String, example: "KBANK" })
  bankCode!: string;

  @ApiProperty({ type: String, description: "Raw account reference; never persisted as-is" })
  accountNumber!: string;

  @ApiProperty({ type: String })
  accountHolderName!: string;
}

class PayoutDestinationBody {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ enum: [...PAYOUT_DESTINATION_TYPES] })
  type!: string;

  @ApiProperty({ type: String })
  bankCode!: string;

  @ApiProperty({ type: String, description: "Masked display value only" })
  accountNumberMasked!: string;

  @ApiProperty({ type: String })
  accountHolderName!: string;

  @ApiProperty({ enum: ["THB"] })
  currency!: string;

  @ApiProperty({ enum: ["PENDING", "VERIFIED", "REJECTED"] })
  status!: string;

  @ApiProperty({ type: String, nullable: true })
  verificationEvidenceRef!: string | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  verifiedAt!: Date | null;

  @ApiProperty({ type: Number })
  version!: number;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  updatedAt!: Date;
}

class PayoutDestinationListBody {
  @ApiProperty({ type: [PayoutDestinationBody] })
  items!: readonly PayoutDestinationBody[];
}

@ApiTags("Member Payout Destinations")
@Controller("api/v1/member/payout-destinations")
@UseGuards(MemberAuthGuard)
export class MemberPayoutDestinationController {
  constructor(
    @Inject(PayoutDestinationService)
    private readonly destinations: PayoutDestinationService,
  ) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Register a Member-linked Payout Destination pending verification",
  })
  @ApiBody({ type: AddPayoutDestinationBody })
  @ApiCreatedResponse({ type: PayoutDestinationBody })
  async add(
    @Req() request: MemberAuthenticatedRequest,
    @Body() body: AddPayoutDestinationBody,
  ): Promise<PayoutDestinationBody> {
    const input = parseBody(addDestinationSchema, body);
    try {
      const destination = await this.destinations.addDestination(
        request.memberAuth!.memberId,
        input,
      );
      return toDestinationBody(destination);
    } catch (error) {
      throw mapPayoutDestinationError(error);
    }
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the Member's Payout Destinations" })
  @ApiOkResponse({ type: PayoutDestinationListBody })
  async list(
    @Req() request: MemberAuthenticatedRequest,
  ): Promise<PayoutDestinationListBody> {
    const items = await this.destinations.listDestinations(request.memberAuth!.memberId);
    return { items: items.map(toDestinationBody) };
  }

  @Get(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Read one Payout Destination owned by the Member" })
  @ApiOkResponse({ type: PayoutDestinationBody })
  async get(
    @Req() request: MemberAuthenticatedRequest,
    @Param("id") destinationId: string,
  ): Promise<PayoutDestinationBody> {
    try {
      const destination = await this.destinations.getDestination(
        request.memberAuth!.memberId,
        destinationId,
      );
      return toDestinationBody(destination);
    } catch (error) {
      throw mapPayoutDestinationError(error);
    }
  }

  @Post(":id/verify")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Request independent verification of the Payout Destination; only normalized evidence crosses the seam",
  })
  @ApiOkResponse({ type: PayoutDestinationBody })
  async verify(
    @Req() request: MemberAuthenticatedRequest,
    @Param("id") destinationId: string,
  ): Promise<PayoutDestinationBody> {
    const correlationId =
      currentCorrelationId() ?? request.memberAuth!.sessionId;
    try {
      const destination = await this.destinations.verifyDestination(
        request.memberAuth!.memberId,
        destinationId,
        correlationId,
      );
      return toDestinationBody(destination);
    } catch (error) {
      throw mapPayoutDestinationError(error);
    }
  }
}

function toDestinationBody(destination: PayoutDestination): PayoutDestinationBody {
  return {
    id: destination.id,
    memberId: destination.memberId,
    type: destination.type,
    bankCode: destination.bankCode,
    accountNumberMasked: destination.accountNumberMasked,
    accountHolderName: destination.accountHolderName,
    currency: destination.currency,
    status: destination.status,
    verificationEvidenceRef: destination.verificationEvidenceRef,
    verifiedAt: destination.verifiedAt,
    version: destination.version,
    createdAt: destination.createdAt,
    updatedAt: destination.updatedAt,
  };
}

function parseBody<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: "INVALID_PAYOUT_DESTINATION_REQUEST",
      message: "Invalid Payout Destination request",
      details: {},
    });
  }
  return parsed.data;
}

function mapPayoutDestinationError(error: unknown): never {
  if (!(error instanceof PayoutDestinationError)) throw error;
  const body = { code: error.code, message: error.message, details: {} };
  if (error.code === "NOT_FOUND") throw new NotFoundException(body);
  if (
    error.code === "DUPLICATE" ||
    error.code === "SHARED_DESTINATION_BLOCKED" ||
    error.code === "STATE_CONFLICT" ||
    error.code === "VERSION_CONFLICT"
  ) {
    throw new ConflictException(body);
  }
  throw new BadRequestException(body);
}
