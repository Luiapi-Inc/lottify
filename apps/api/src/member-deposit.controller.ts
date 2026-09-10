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
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from "@nestjs/swagger";
import { z, type ZodType } from "zod";
import { DepositService } from "../../../src/contexts/payments/application/deposit.service";
import { DepositError, type Deposit } from "../../../src/contexts/payments/domain/deposit";
import { currentCorrelationId } from "./correlation";
import { DepositMethodService } from "./deposit-method.service";
import {
  MemberAuthGuard,
  type MemberAuthenticatedRequest,
} from "./member-auth.guard";

const depositInitiateSchema = z.object({
  providerCode: z.string().trim().min(1).max(100),
  methodCode: z.string().trim().min(1).max(100),
  amountMinor: z
    .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
    .transform((value) => BigInt(typeof value === "number" ? value : value)),
  currency: z.literal("THB"),
});

class DepositInitiateBody {
  @ApiProperty({ type: String, example: "corridor" })
  providerCode!: string;

  @ApiProperty({ type: String, example: "bank-transfer" })
  methodCode!: string;

  @ApiProperty({ type: Number, description: "Positive amount in integer minor units" })
  amountMinor!: number;

  @ApiProperty({ enum: ["THB"] })
  currency!: "THB";
}

class DepositMethodSummaryBody {
  @ApiProperty({ type: String })
  methodCode!: string;

  @ApiProperty({ type: String })
  providerCode!: string;
}

class DepositMethodDescriptionBody extends DepositMethodSummaryBody {
  @ApiProperty({ enum: ["THB"] })
  currency!: "THB";

  @ApiProperty({ type: String, description: "Fee in integer minor units" })
  feeMinor!: string;

  @ApiProperty({ type: [String] })
  instructions!: readonly string[];
}

class DepositBody {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ type: String })
  providerCode!: string;

  @ApiProperty({ type: String })
  methodCode!: string;

  @ApiProperty({ type: String })
  amountMinor!: string;

  @ApiProperty({ enum: ["THB"] })
  currency!: string;

  @ApiProperty({
    enum: ["INITIATED", "PENDING", "REVIEW_REQUIRED", "COMPLETED", "REJECTED"],
  })
  status!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Ledger transaction id when the deposit was credited",
  })
  ledgerTransactionId!: string | null;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  updatedAt!: Date;
}

const DEPOSIT_IDEMPOTENCY_HEADER = "idempotency-key";

@ApiTags("Member Deposits")
@Controller("api/v1/member/deposits")
@UseGuards(MemberAuthGuard)
export class MemberDepositController {
  constructor(
    @Inject(DepositService)
    private readonly deposits: DepositService,
    @Inject(DepositMethodService)
    private readonly methods: DepositMethodService,
  ) {}


  @Get("methods")
  @ApiBearerAuth()
  @ApiOperation({ summary: "List deposit methods available to the Member" })
  @ApiOkResponse({ type: [DepositMethodSummaryBody] })
  listMethods(): readonly DepositMethodSummaryBody[] {
    return this.methods.list();
  }

  @Get("methods/:code")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Describe one deposit method including fee and payment instructions" })
  @ApiOkResponse({ type: DepositMethodDescriptionBody })
  describeMethod(@Param("code") code: string): DepositMethodDescriptionBody {
    const method = this.methods.describe(code);
    if (!method) {
      throw new NotFoundException({
        code: "DEPOSIT_METHOD_NOT_FOUND",
        message: "Deposit method was not found",
        details: {},
      });
    }
    return { ...method, feeMinor: method.feeMinor.toString() };
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth()
  @ApiHeader({
    name: DEPOSIT_IDEMPOTENCY_HEADER,
    required: true,
    description: "Scoped Idempotency-Key. Same key + same payload returns the prior result.",
  })
  @ApiBody({ type: DepositInitiateBody })
  @ApiOkResponse({ type: DepositBody })
  async initiate(
    @Req() request: MemberAuthenticatedRequest,
    @Body() body: DepositInitiateBody,
  ): Promise<DepositBody> {
    const input = parseBody(depositInitiateSchema, body);
    const idempotencyKey = request.header(DEPOSIT_IDEMPOTENCY_HEADER)?.trim();
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Idempotency-Key header is required for deposit initiation",
        details: {},
      });
    }
    const correlationId = currentCorrelationId() ?? request.memberAuth!.sessionId;
    try {
      const deposit = await this.deposits.initiateDeposit(
        request.memberAuth!.memberId,
        {
          providerCode: input.providerCode,
          methodCode: input.methodCode,
          amountMinor: input.amountMinor,
          currency: input.currency,
          idempotencyKey,
        },
        correlationId,
      );
      return toDepositBody(deposit);
    } catch (error) {
      throw mapDepositError(error, depositErrorsFromInitiate);
    }
  }

  @Post(":id/reconcile")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Reconcile a Deposit against the provider; credits only on proven APPROVED",
  })
  @ApiOkResponse({ type: DepositBody })
  async reconcile(
    @Req() request: MemberAuthenticatedRequest,
    @Param("id") depositId: string,
  ): Promise<DepositBody> {
    const correlationId = currentCorrelationId() ?? request.memberAuth!.sessionId;
    try {
      const deposit = await this.deposits.reconcileDeposit(
        request.memberAuth!.memberId,
        depositId,
        correlationId,
      );
      return toDepositBody(deposit);
    } catch (error) {
      throw mapDepositError(error, depositErrorsFromRead);
    }
  }

  @Get(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Read a Member Deposit by id" })
  @ApiOkResponse({ type: DepositBody })
  async get(
    @Req() request: MemberAuthenticatedRequest,
    @Param("id") depositId: string,
  ): Promise<DepositBody> {
    try {
      const deposit = await this.deposits.getDeposit(
        request.memberAuth!.memberId,
        depositId,
      );
      return toDepositBody(deposit);
    } catch (error) {
      throw mapDepositError(error, depositErrorsFromRead);
    }
  }
}

function toDepositBody(deposit: Deposit): DepositBody {
  return {
    id: deposit.id,
    memberId: deposit.memberId,
    providerCode: deposit.providerCode,
    methodCode: deposit.methodCode,
    amountMinor: deposit.amountMinor.toString(),
    currency: deposit.currency,
    status: deposit.status,
    ledgerTransactionId: deposit.ledgerTransactionId,
    createdAt: deposit.createdAt,
    updatedAt: deposit.updatedAt,
  };
}

function parseBody<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: "INVALID_DEPOSIT_REQUEST",
      message: "Invalid deposit initiation request",
      details: {},
    });
  }
  return parsed.data;
}

type DepositErrorMap = {
  conflict: Set<string>;
  notFound: Set<string>;
};

const depositErrorsFromInitiate: DepositErrorMap = {
  conflict: new Set(["IDEMPOTENCY_CONFLICT"]),
  notFound: new Set([]),
};

const depositErrorsFromRead: DepositErrorMap = {
  conflict: new Set([]),
  notFound: new Set(["NOT_FOUND"]),
};

function mapDepositError(error: unknown, map: DepositErrorMap): never {
  if (!(error instanceof DepositError)) {
    throw error;
  }
  if (map.conflict.has(error.code)) {
    throw new ConflictException({
      code: error.code,
      message: error.message,
      details: {},
    });
  }
  if (map.notFound.has(error.code)) {
    throw new NotFoundException({
      code: error.code,
      message: error.message,
      details: {},
    });
  }
  throw new BadRequestException({
    code: error.code,
    message: error.message,
    details: {},
  });
}