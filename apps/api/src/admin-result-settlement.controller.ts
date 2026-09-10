import {
  Body,
  Controller,
  Get,
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
  ApiOperation,
  ApiProperty,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";
import {
  SettlementError,
  SettlementService,
} from "../../../src/contexts/result-settlement/application/settlement.service";
import { currentCorrelationId } from "./correlation";
import {
  AdminAuthGuard,
  type AdminAuthenticatedRequest,
} from "./admin-auth.guard";
import {
  AdminCapabilityGuard,
  RequireAdminCapabilities,
} from "./admin-capability.guard";

const resultSchema = z.object({
  winningNumbers: z.record(z.string(), z.string()),
  resultData: z.record(z.string(), z.unknown()).optional(),
  resultSchemaVersionRef: z.string().trim().min(1),
  resultSourceRef: z.string().trim().optional(),
});

class ResultRevisionBody {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  drawId!: string;
  @ApiProperty({ type: Number })
  revision!: number;
  @ApiProperty({ enum: ["RECEIVED", "VALIDATING", "REVIEW_REQUIRED", "CONFIRMED", "SUPERSEDED"] })
  state!: string;
  @ApiProperty({ type: String })
  resultSchemaVersionRef!: string;
  @ApiProperty({ type: String, nullable: true })
  resultSourceRef!: string | null;
  @ApiProperty({ type: Object })
  winningNumbers!: Record<string, string>;
  @ApiProperty({ type: String, nullable: true })
  supersedesRevisionId!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  confirmedAt!: Date | null;
  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;
  @ApiProperty({ type: String, format: "date-time" })
  updatedAt!: Date;
}

class SettlementBatchBody {
  @ApiProperty({ type: String })
  id!: string;
  @ApiProperty({ type: String })
  drawId!: string;
  @ApiProperty({ type: String })
  resultRevisionId!: string;
  @ApiProperty({ enum: ["PENDING", "CALCULATING", "POSTING", "COMMITTING", "COMPLETED", "FAILED", "RETRY_PENDING"] })
  state!: string;
  @ApiProperty({ type: Number })
  version!: number;
  @ApiProperty({ type: String })
  totalStakeMinor!: string;
  @ApiProperty({ type: String })
  totalPayoutMinor!: string;
  @ApiProperty({ type: Number })
  winningOrderCount!: number;
  @ApiProperty({ type: Number })
  losingOrderCount!: number;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  completedAt!: Date | null;
  @ApiProperty({ type: String, format: "date-time" })
  startedAt!: Date;
  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;
  @ApiProperty({ type: String, format: "date-time" })
  updatedAt!: Date;
}

class SettlementOrderBody {
  @ApiProperty({ type: String })
  orderId!: string;
  @ApiProperty({ type: String })
  memberId!: string;
  @ApiProperty({ enum: ["WIN", "LOSE"] })
  outcome!: string;
  @ApiProperty({ type: String })
  stakeMinor!: string;
  @ApiProperty({ type: String })
  payoutMinor!: string;
  @ApiProperty({ type: String, nullable: true })
  payoutTransactionId!: string | null;
}

@ApiTags("admin-result-settlement")
@ApiBearerAuth()
@Controller("api/v1/admin")
@UseGuards(AdminAuthGuard, AdminCapabilityGuard)
export class AdminResultSettlementController {
  constructor(
    @Inject(SettlementService)
    private readonly settlement: SettlementService,
  ) {}

  @Post("draws/:drawId/result")
  @RequireAdminCapabilities("result.manage")
  @ApiOperation({ summary: "Intake a Result revision for a Draw" })
  @ApiBody({ type: Object })
  async intake(
    @Param("drawId") drawId: string,
    @Body() body: unknown,
  ): Promise<ResultRevisionBody> {
    try {
      const input = parseResultBody(body);
      const revision = await this.settlement.intakeResult({
        drawId: drawId.trim(),
        winningNumbers: input.winningNumbers,
        resultData: input.resultData,
        resultSchemaVersionRef: input.resultSchemaVersionRef,
        resultSourceRef: input.resultSourceRef ?? null,
        correlationId: currentCorrelationId() ?? undefined,
      });
      return toRevisionBody(revision);
    } catch (error) {
      throw mapSettlementError(error);
    }
  }

  @Post("draws/:drawId/result/ingest-from-provider")
  @RequireAdminCapabilities("result.manage")
  @ApiOperation({ summary: "Ingest the authoritative Result from the configured provider" })
  async ingestFromProvider(
    @Param("drawId") drawId: string,
  ): Promise<ResultRevisionBody> {
    try {
      const revision = await this.settlement.ingestFromProvider({
        drawId: drawId.trim(),
        correlationId: currentCorrelationId() ?? "",
      });
      return toRevisionBody(revision);
    } catch (error) {
      throw mapSettlementError(error);
    }
  }

  @Post("draws/:drawId/results/:revision/confirm")
  @RequireAdminCapabilities("result.manage")
  @ApiOperation({ summary: "Confirm a Result revision (governed command)" })
  async confirm(
    @Param("drawId") drawId: string,
    @Param("revision") revision: string,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<ResultRevisionBody> {
    const admin = requiredAdmin(request);
    try {
      const confirmed = await this.settlement.confirmResult({
        drawId: drawId.trim(),
        revision: parseRevision(revision),
        actor: admin,
      });
      return toRevisionBody(confirmed);
    } catch (error) {
      throw mapSettlementError(error);
    }
  }

  @Post("draws/:drawId/results/:revision/correct")
  @RequireAdminCapabilities("result.manage")
  @ApiOperation({
    summary: "Immutable Result correction (new revision, compensating postings)",
  })
  async correct(
    @Param("drawId") drawId: string,
    @Param("revision") revision: string,
    @Body() body: unknown,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<unknown> {
    const admin = requiredAdmin(request);
    const input = parseResultBody(body);
    try {
      const correction = await this.settlement.correctResult({
        drawId: drawId.trim(),
        winningNumbers: input.winningNumbers,
        resultData: input.resultData,
        resultSchemaVersionRef: input.resultSchemaVersionRef,
        resultSourceRef: input.resultSourceRef ?? null,
        actor: admin,
        correlationId: currentCorrelationId() ?? undefined,
      });
      return {
        revision: toRevisionBody(correction.revision),
        reversedCount: correction.reversedCount,
      };
    } catch (error) {
      throw mapSettlementError(error);
    }
  }

  @Post("draws/:drawId/settlement")
  @RequireAdminCapabilities("settlement.manage")
  @ApiOperation({
    summary: "Run (or resume) the durable Settlement Batch for a Draw",
  })
  async runSettlement(
    @Param("drawId") drawId: string,
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<SettlementBatchBody> {
    const admin = requiredAdmin(request);
    try {
      const batch = await this.settlement.runSettlement({
        drawId: drawId.trim(),
        correlationId: currentCorrelationId() ?? "",
        actor: admin,
      });
      return toBatchBody(batch);
    } catch (error) {
      throw mapSettlementError(error);
    }
  }

  @Get("draws/:drawId/settlement")
  @RequireAdminCapabilities("settlement.read")
  @ApiOperation({ summary: "Read the Settlement Batch for a Draw" })
  async getBatch(@Param("drawId") drawId: string): Promise<SettlementBatchBody> {
    try {
      const batch = await this.settlement.getBatch({ drawId: drawId.trim() });
      return toBatchBody(batch);
    } catch (error) {
      throw mapSettlementError(error);
    }
  }

  @Get("settlement/:batchId/orders")
  @RequireAdminCapabilities("settlement.read")
  @ApiOperation({ summary: "List the per-Order settlement checkpoints of a batch" })
  async listOrders(
    @Param("batchId") batchId: string,
    @Query() _query: unknown,
  ): Promise<{ items: SettlementOrderBody[] }> {
    try {
      const orders = await this.settlement.listOrdersForBatch(batchId.trim());
      return {
        items: orders.map((order) => ({
          orderId: order.orderId,
          memberId: order.memberId,
          outcome: order.outcome,
          stakeMinor: order.stakeMinor.toString(),
          payoutMinor: order.payoutMinor.toString(),
          payoutTransactionId: order.payoutTransactionId,
        })),
      };
    } catch (error) {
      throw mapSettlementError(error);
    }
  }
}

function parseResultBody(value: unknown): z.infer<typeof resultSchema> {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpException(
      {
        code: "VALIDATION_ERROR",
        message: "Invalid Result payload",
        details: { field: parsed.error.issues[0]?.path.join(".") ?? "body" },
        correlationId: currentCorrelationId() ?? "unknown",
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  return parsed.data;
}

function parseRevision(value: string): number {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1) {
    throw new HttpException(
      {
        code: "VALIDATION_ERROR",
        message: "revision must be a positive integer",
        details: { field: "revision" },
        correlationId: currentCorrelationId() ?? "unknown",
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  return revision;
}

function requiredAdmin(
  request: AdminAuthenticatedRequest | null,
): { adminId: string; sessionId: string; role: string } {
  if (!request || !request.adminAuth) {
    throw new HttpException(
      {
        code: "AUTHENTICATION_REQUIRED",
        message: "Admin authentication required",
        details: {},
        correlationId: currentCorrelationId() ?? "unknown",
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
  return request.adminAuth;
}

function toRevisionBody(revision: {
  id: string;
  drawId: string;
  revision: number;
  state: string;
  resultSchemaVersionRef: string;
  resultSourceRef: string | null;
  winningNumbers: Readonly<Record<string, string>>;
  supersedesRevisionId: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ResultRevisionBody {
  return {
    id: revision.id,
    drawId: revision.drawId,
    revision: revision.revision,
    state: revision.state,
    resultSchemaVersionRef: revision.resultSchemaVersionRef,
    resultSourceRef: revision.resultSourceRef,
    winningNumbers: { ...revision.winningNumbers },
    supersedesRevisionId: revision.supersedesRevisionId,
    confirmedAt: revision.confirmedAt,
    createdAt: revision.createdAt,
    updatedAt: revision.updatedAt,
  };
}

function toBatchBody(batch: {
  id: string;
  drawId: string;
  resultRevisionId: string;
  state: string;
  version: number;
  totalStakeMinor: bigint;
  totalPayoutMinor: bigint;
  winningOrderCount: number;
  losingOrderCount: number;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): SettlementBatchBody {
  return {
    id: batch.id,
    drawId: batch.drawId,
    resultRevisionId: batch.resultRevisionId,
    state: batch.state,
    version: batch.version,
    totalStakeMinor: batch.totalStakeMinor.toString(),
    totalPayoutMinor: batch.totalPayoutMinor.toString(),
    winningOrderCount: batch.winningOrderCount,
    losingOrderCount: batch.losingOrderCount,
    startedAt: batch.startedAt,
    completedAt: batch.completedAt,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
}

export function mapSettlementError(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  if (error instanceof SettlementError) {
    return new HttpException(
      {
        code: error.code,
        message: error.message,
        details: error.details,
        correlationId: currentCorrelationId() ?? "unknown",
      },
      error.status,
    );
  }
  throw error;
}
