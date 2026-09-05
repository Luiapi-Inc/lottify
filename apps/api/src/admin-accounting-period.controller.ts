import {
  Controller,
  Get,
  Inject,
  Param,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { AccountingPeriodService } from "../../../src/contexts/wallet-ledger/application/accounting-period.service";
import {
  ACCOUNTING_PERIOD_GENERATION_KINDS,
  ACCOUNTING_PERIOD_MODES,
  ACCOUNTING_PERIOD_STATES,
  ACCOUNTING_TIME_ZONE,
  type AccountingPeriodView,
} from "../../../src/contexts/wallet-ledger/domain/accounting-period";
import { AdminAuthGuard } from "./admin-auth.guard";
import {
  AdminCapabilityGuard,
  RequireAdminCapabilities,
} from "./admin-capability.guard";

class AccountingPeriodResponse {
  @ApiProperty({ type: String, description: "Opaque immutable Accounting Period identity" })
  id!: string;

  @ApiProperty({ enum: [...ACCOUNTING_PERIOD_MODES] })
  mode!: AccountingPeriodView["mode"];

  @ApiProperty({ enum: [...ACCOUNTING_PERIOD_GENERATION_KINDS] })
  generationKind!: AccountingPeriodView["generationKind"];

  @ApiProperty({ type: String, format: "date-time" })
  effectiveStart!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  effectiveEnd!: Date;

  @ApiProperty({ enum: [ACCOUNTING_TIME_ZONE] })
  accountingTimezone!: typeof ACCOUNTING_TIME_ZONE;

  @ApiProperty({ enum: [...ACCOUNTING_PERIOD_STATES] })
  state!: AccountingPeriodView["state"];

  @ApiProperty({ type: Number, minimum: 1 })
  version!: number;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  updatedAt!: Date;

  @ApiProperty({ type: [String], description: "Currently permitted explicit commands" })
  allowedActions!: readonly string[];
}

@ApiTags("Admin Accounting Periods")
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, AdminCapabilityGuard)
@RequireAdminCapabilities("accounting-period.read")
@Controller("api/v1/admin/accounting-periods")
export class AdminAccountingPeriodController {
  constructor(
    @Inject(AccountingPeriodService)
    private readonly accountingPeriods: AccountingPeriodService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List authoritative Accounting Periods" })
  @ApiOkResponse({ type: [AccountingPeriodResponse] })
  @ApiUnauthorizedResponse({ description: "Admin authentication required" })
  @ApiForbiddenResponse({ description: "Insufficient Admin capability" })
  list(): Promise<readonly AccountingPeriodView[]> {
    return this.accountingPeriods.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one authoritative Accounting Period" })
  @ApiParam({
    name: "id",
    type: String,
    description: "Opaque immutable Accounting Period identity",
  })
  @ApiOkResponse({ type: AccountingPeriodResponse })
  @ApiUnauthorizedResponse({ description: "Admin authentication required" })
  @ApiForbiddenResponse({ description: "Insufficient Admin capability" })
  @ApiNotFoundResponse({ description: "Accounting Period not found" })
  getById(@Param("id") id: string): Promise<AccountingPeriodView> {
    return this.accountingPeriods.getById(id);
  }
}
