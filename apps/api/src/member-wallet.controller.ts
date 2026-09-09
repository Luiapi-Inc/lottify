import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { MemberWalletService } from "../../../src/contexts/wallet-ledger/application/member-wallet.service";
import {
  MemberAuthGuard,
  type MemberAuthenticatedRequest,
} from "./member-auth.guard";

class WalletBucketBody {
  @ApiProperty({ enum: ["CASH", "BONUS", "LOCKED"] })
  bucket!: string;

  @ApiProperty({ type: String, description: "Posted balance in integer minor units" })
  postedMinor!: string;

  @ApiProperty({ type: String, description: "Active reservations in integer minor units" })
  reservedMinor!: string;

  @ApiProperty({ type: String, description: "Spendable balance in integer minor units" })
  availableMinor!: string;
}

class WalletBalanceBody {
  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ enum: ["THB"] })
  currency!: string;

  @ApiProperty({ type: String, format: "date-time" })
  dataAsOf!: Date;

  @ApiProperty({ type: WalletBucketBody, isArray: true })
  buckets!: WalletBucketBody[];
}

class WalletTransactionBody {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  businessTransactionId!: string;

  @ApiProperty({ type: String })
  operationType!: string;

  @ApiProperty({ type: String })
  correlationId!: string;

  @ApiProperty({ type: String, format: "date-time" })
  postedAt!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  effectiveAt!: Date;

  @ApiProperty({ type: String, description: "Signed net impact to the Member in minor units" })
  netImpactMinor!: string;
}

class WalletTransactionPageBody {
  @ApiProperty({ type: WalletTransactionBody, isArray: true })
  items!: WalletTransactionBody[];

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

@ApiTags("Member Wallet")
@Controller("api/v1/member/wallet")
@UseGuards(MemberAuthGuard)
export class MemberWalletController {
  constructor(
    @Inject(MemberWalletService)
    private readonly wallet: MemberWalletService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Read the Member's Wallet balances (bounded buckets)" })
  @ApiOkResponse({ type: WalletBalanceBody })
  async balance(@Req() request: MemberAuthenticatedRequest): Promise<WalletBalanceBody> {
    const projection = await this.wallet.getBalance(request.memberAuth!.memberId);
    return {
      memberId: projection.memberId,
      currency: projection.currency,
      dataAsOf: projection.dataAsOf,
      buckets: projection.buckets.map((bucket) => ({
        bucket: bucket.bucket,
        postedMinor: bucket.postedMinor.toString(),
        reservedMinor: bucket.reservedMinor.toString(),
        availableMinor: bucket.availableMinor.toString(),
      })),
    };
  }

  @Get("transactions")
  @ApiBearerAuth()
  @ApiOperation({
    summary: "List the Member's Ledger-backed transaction history with cursor pagination",
  })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "cursor", required: false, type: String })
  @ApiOkResponse({ type: WalletTransactionPageBody })
  async transactions(
    @Req() request: MemberAuthenticatedRequest,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ): Promise<WalletTransactionPageBody> {
    const requestedLimit = limit === undefined ? 20 : Number(limit);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
      throw new BadRequestException({
        code: "INVALID_QUERY",
        message: "limit must be an integer between 1 and 100",
        details: {},
      });
    }
    let page: Awaited<ReturnType<typeof this.wallet.listTransactions>>;
    try {
      page = await this.wallet.listTransactions(request.memberAuth!.memberId, {
        limit: requestedLimit,
        cursor: cursor ?? null,
      });
    } catch (error) {
      if (error instanceof Error && /cursor/i.test(error.message)) {
        throw new BadRequestException({
          code: "INVALID_CURSOR",
          message: "The transaction cursor is invalid",
          details: {},
        });
      }
      throw error;
    }
    return {
      items: page.items.map((item) => ({
        id: item.id,
        businessTransactionId: item.businessTransactionId,
        operationType: item.operationType,
        correlationId: item.correlationId,
        postedAt: item.postedAt,
        effectiveAt: item.effectiveAt,
        netImpactMinor: item.netImpactMinor.toString(),
      })),
      nextCursor: page.nextCursor,
    };
  }
}