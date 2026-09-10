// Result & Settlement application service (vertical 4).
//
// Owns result intake/validation/confirmation, the durable idempotent Settlement
// Batch execution, settlement-outcome reads, and the immutable Result
// correction/re-settlement workflow. It coordinates Draw lifecycle transitions
// (Lottery) and financial postings (Wallet & Ledger) strictly through ports, so
// this bounded context never imports another context.
//
// Invariants enforced here (locked by Tickets 02/03):
//   - a Result is an immutable revision; correction creates a new superseding
//     revision (never edits the prior one);
//   - a Settlement Batch is the durable execution unit; its Member-visible
//     outcome becomes authoritative only on COMPLETED, and a failed batch never
//     exposes a partial financial outcome;
//   - every financial effect is once-only: payout and reversal postings are
//     keyed by the Bet Order / payout transaction, so replay cannot duplicate a
//     payout or reverse it twice;
//   - retry/resume continues from durable per-Order checkpoints after a crash.

import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import {
  applyResultRevisionTransition,
  createResultRevision,
  isTerminalResultRevisionState,
  type ResultRevision,
  type ResultRevisionState,
  type WinningNumbers,
} from "../domain/result-revision";
import {
  advanceSettlementBatch,
  evaluateOrderSettlement,
  type SettlementBatchState,
} from "../domain/settlement-batch";
import {
  RESULT_PROVIDER_ADAPTER,
  ResultProviderAdapterError,
  type ResultProviderAdapter,
} from "../domain/result-provider.adapter";
import {
  SETTLEMENT_DRAW_PORT,
  SettlementDrawError,
  type SettlementDrawPort,
} from "./settlement.ports";
import {
  SETTLEMENT_ORDERS_PORT,
  type SettlementOrdersPort,
} from "./settlement.ports";
import {
  SETTLEMENT_WALLET_PORT,
  SettlementWalletError,
  type SettlementWalletPort,
} from "./settlement.ports";
import {
  SETTLEMENT_REPOSITORY,
  type ResultRevisionRecord,
  type SettlementBatchRecord,
  type SettlementRepository,
  type SettlementOrderRecord,
} from "./settlement.repository";

export type SettlementErrorCode =
  | "DRAW_NOT_FOUND"
  | "DRAW_STATE_CONFLICT"
  | "RESULT_SCHEMA_MISMATCH"
  | "RESULT_CONFLICT"
  | "RESULT_NOT_CONFIRMED"
  | "REVISION_NOT_FOUND"
  | "REVISION_STATE_CONFLICT"
  | "RESULT_PENDING_CONFLICT"
  | "BATCH_NOT_FOUND"
  | "BATCH_ALREADY_COMPLETED"
  | "IDEMPOTENCY_CONFLICT"
  | "SETTLEMENT_FAILED"
  | "INSUFFICIENT_FUNDS"
  | "WALLET_RESTRICTED";

export class SettlementError extends Error {
  readonly code: SettlementErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;
  constructor(
    code: SettlementErrorCode,
    message: string,
    status: number,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "SettlementError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface SettlementActor {
  readonly adminId: string;
  readonly sessionId: string;
  readonly role: string;
}

@Injectable()
export class SettlementService {
  constructor(
    @Inject(SETTLEMENT_REPOSITORY) private readonly repo: SettlementRepository,
    @Inject(SETTLEMENT_DRAW_PORT) private readonly draws: SettlementDrawPort,
    @Inject(SETTLEMENT_WALLET_PORT) private readonly wallet: SettlementWalletPort,
    @Inject(SETTLEMENT_ORDERS_PORT) private readonly orders: SettlementOrdersPort,
    @Inject(RESULT_PROVIDER_ADAPTER) private readonly provider: ResultProviderAdapter,
  ) {}

  now(): Date {
    return new Date();
  }

  /**
   * Fetches and normalizes the authoritative Result from the configured
   * provider and intakes it as a Result revision. An ambiguous provider outcome
   * never auto-settles — it raises a classified error and the intake is left
   * unconfirmed (Ticket 09).
   */
  async ingestFromProvider(input: {
    drawId: string;
    correlationId: string;
  }): Promise<ResultRevision> {
    const correlationId = input.correlationId || randomUUID();
    const draw = await this.requireDraw(input.drawId);
    let providerResult;
    try {
      providerResult = await this.provider.fetchResult({
        drawId: input.drawId,
        resultSourceRef: draw.resultSourceRef,
        correlationId,
      });
    } catch (error) {
      if (error instanceof ResultProviderAdapterError) {
        if (error.category === "BUSINESS_REJECTION") {
          throw new SettlementError(
            "RESULT_CONFLICT",
            `Result provider rejected intake for Draw ${input.drawId}: ${error.message}`,
            409,
            { category: error.category },
          );
        }
        throw new SettlementError(
          "SETTLEMENT_FAILED",
          `Result provider could not be reached for Draw ${input.drawId} (${error.category})`,
          502,
          { category: error.category },
        );
      }
      throw new SettlementError(
        "SETTLEMENT_FAILED",
        `Result provider outcome is ambiguous for Draw ${input.drawId}`,
        502,
        { category: "AMBIGUOUS_OUTCOME" },
      );
    }

    return this.intakeResult({
      drawId: input.drawId,
      winningNumbers: providerResult.result.winningNumbers,
      resultData: { ...providerResult.result.winningNumbers },
      resultSchemaVersionRef: providerResult.result.resultSchemaVersionRef,
      resultSourceRef: providerResult.identity.providerId,
      correlationId,
    });
  }

  /**
   * Intake of an explicit Result payload (admin command). Validates the winning
   * numbers against the Draw's Result Schema / Bet Type validation patterns,
   * persists the revision (RECEIVED) and marks the Draw RESULT_PENDING. A
   * confirmed Result cannot be re-intaked except through the correction
   * workflow; re-intaking the identical unconfirmed payload is idempotent.
   */
  async intakeResult(input: {
    drawId: string;
    winningNumbers: WinningNumbers;
    resultData?: Readonly<Record<string, unknown>>;
    resultSchemaVersionRef: string;
    resultSourceRef?: string | null;
    correlationId?: string;
    now?: Date;
    actor?: SettlementActor;
  }): Promise<ResultRevision> {
    const now = input.now ?? this.now();
    const correlationId = input.correlationId || randomUUID();
    if (!input.resultSchemaVersionRef?.trim()) {
      throw new SettlementError(
        "RESULT_SCHEMA_MISMATCH",
        "Result intake requires a Result Schema version reference",
        400,
        { field: "resultSchemaVersionRef" },
      );
    }
    if (Object.keys(input.winningNumbers).length === 0) {
      throw new SettlementError(
        "RESULT_SCHEMA_MISMATCH",
        "Result intake requires at least one winning number",
        400,
        { field: "winningNumbers" },
      );
    }

    const draw = await this.requireDraw(input.drawId);
    if (draw.state !== "CLOSED" && draw.state !== "RESULT_PENDING") {
      throw new SettlementError(
        "DRAW_STATE_CONFLICT",
        `Result intake requires a CLOSED (or RESULT_PENDING) Draw (state ${draw.state})`,
        409,
        { state: draw.state },
      );
    }

    this.validateWinningNumbers(input.winningNumbers, draw.betTypes);

    const latest = await this.repo.findLatestRevision(input.drawId);
    if (latest && !isTerminalResultRevisionState(latest.state)) {
      if (sameWinningNumbers(latest.winningNumbers, input.winningNumbers)) {
        return this.toRevision(latest);
      }
      throw new SettlementError(
        "RESULT_PENDING_CONFLICT",
        `A Result revision for Draw ${input.drawId} is already awaiting confirmation with different data`,
        409,
        { revision: latest.revision, state: latest.state },
      );
    }
    if (latest && latest.state === "CONFIRMED" && latest.supersedesRevisionId === null) {
      // The Draw has an active confirmed Result; a changed intake is a
      // correction and must go through the correction workflow.
      if (sameWinningNumbers(latest.winningNumbers, input.winningNumbers)) {
        throw new SettlementError(
          "RESULT_CONFLICT",
          `Draw ${input.drawId} already has an active confirmed Result`,
          409,
          { revision: latest.revision },
        );
      }
      throw new SettlementError(
        "RESULT_CONFLICT",
        `Draw ${input.drawId} has a confirmed Result; changed results use the correction workflow`,
        409,
        { revision: latest.revision, codeHint: "correctResult" },
      );
    }

    const revisionNumber = latest ? latest.revision + 1 : 1;
    const revision = createResultRevision({
      id: randomUUID(),
      drawId: input.drawId,
      revision: revisionNumber,
      state: "RECEIVED",
      resultSchemaVersionRef: input.resultSchemaVersionRef.trim(),
      resultSourceRef: input.resultSourceRef?.trim() || null,
      resultData: input.resultData ?? { ...input.winningNumbers },
      winningNumbers: { ...input.winningNumbers },
      supersedesRevisionId: null,
      correlationId,
      confirmedAt: null,
      confirmedByAdminId: null,
      createdAt: now,
      updatedAt: now,
    });
    const record = await this.repo.createResultRevision({
      id: revision.id,
      drawId: revision.drawId,
      revision: revision.revision,
      state: revision.state,
      resultSchemaVersionRef: revision.resultSchemaVersionRef,
      resultSourceRef: revision.resultSourceRef,
      resultData: revision.resultData,
      winningNumbers: revision.winningNumbers,
      supersedesRevisionId: revision.supersedesRevisionId,
      correlationId: revision.correlationId,
    });

    if (draw.state === "CLOSED") {
      await this.draws.transition({
        drawId: input.drawId,
        command: "MARK_RESULT_PENDING",
        expectedVersion: draw.version,
      });
    }

    return this.toRevision(record);
  }

  /**
   * Confirms a Result revision (governed command). Advances RECEIVED -> VALIDATING
   * -> CONFIRMED and, on a first (non-correction) confirmation, moves the Draw
   * RESULT_PENDING -> RESULT_CONFIRMED. A correction's confirmation never mutates
   * historical Draw state — the correction trail lives in the revision chain.
   */
  async confirmResult(input: {
    drawId: string;
    revision: number;
    actor: SettlementActor;
    now?: Date;
  }): Promise<ResultRevision> {
    const now = input.now ?? this.now();
    const record = await this.repo.findRevision(input.drawId, input.revision);
    if (!record) {
      throw new SettlementError(
        "REVISION_NOT_FOUND",
        `Result revision ${input.revision} for Draw ${input.drawId} not found`,
        404,
        {},
      );
    }
    if (record.state === "CONFIRMED") {
      return this.toRevision(record);
    }
    if (record.state === "SUPERSEDED") {
      throw new SettlementError(
        "REVISION_STATE_CONFLICT",
        `Result revision ${input.revision} is SUPERSEDED and cannot be confirmed`,
        409,
        { state: record.state },
      );
    }
    if (record.state === "REVIEW_REQUIRED") {
      throw new SettlementError(
        "REVISION_STATE_CONFLICT",
        `Result revision ${input.revision} requires review resolution before confirmation`,
        409,
        { state: record.state },
      );
    }

    const validated = applyResultRevisionTransition({
      current: { state: record.state },
      command: "START_VALIDATION",
    });
    const confirmed = applyResultRevisionTransition({
      current: { state: validated.state },
      command: "CONFIRM",
    });

    const persisted = await this.repo.updateResultRevisionState(
      record.id,
      confirmed.state,
      { confirmedAt: now, confirmedByAdminId: input.actor.adminId },
    );

    const draw = await this.requireDraw(input.drawId);
    if (draw.state === "RESULT_PENDING") {
      await this.draws.transition({
        drawId: input.drawId,
        command: "CONFIRM_RESULT",
        expectedVersion: draw.version,
      });
    }

    return this.toRevision(persisted);
  }

  /**
   * The immutable Result correction workflow (Ticket 02 workflow 7). Creates a
   * new superseding revision, confirms it, marks the prior confirmed revision
   * SUPERSEDED, and reverses the prior settlement's financial effects with
   * compensating Ledger postings (once-only). Re-settlement then posts the
   * corrected payouts via a new Settlement Batch.
   */
  async correctResult(input: {
    drawId: string;
    winningNumbers: WinningNumbers;
    resultData?: Readonly<Record<string, unknown>>;
    resultSchemaVersionRef: string;
    resultSourceRef?: string | null;
    actor: SettlementActor;
    correlationId?: string;
    now?: Date;
  }): Promise<{ revision: ResultRevision; reversedCount: number }> {
    const now = input.now ?? this.now();
    const correlationId = input.correlationId || randomUUID();
    if (!input.resultSchemaVersionRef?.trim()) {
      throw new SettlementError(
        "RESULT_SCHEMA_MISMATCH",
        "Result correction requires a Result Schema version reference",
        400,
        { field: "resultSchemaVersionRef" },
      );
    }

    const active = await this.repo.findActiveConfirmedRevision(input.drawId);
    if (!active) {
      throw new SettlementError(
        "RESULT_NOT_CONFIRMED",
        `Draw ${input.drawId} has no confirmed Result to correct`,
        409,
        {},
      );
    }
    const draw = await this.requireDraw(input.drawId);
    this.validateWinningNumbers(input.winningNumbers, draw.betTypes);

    // Reverse the prior settlement's payouts once-only (compensating postings).
    const priorBatch = await this.repo.findSettlementBatchByCorrelation(
      `SETTLEMENT_BATCH:${input.drawId}`,
      active.id,
    );
    let reversedCount = 0;
    if (priorBatch) {
      const posted = await this.repo.listBatchOrders(priorBatch.id);
      for (const order of posted) {
        if (!order.payoutTransactionId) continue;
        try {
          await this.wallet.reverseSettlementPayout({
            orderId: order.orderId,
            payoutTransactionId: order.payoutTransactionId,
            memberId: order.memberId,
            drawId: input.drawId,
            currency: "THB",
            correlationId,
          });
          reversedCount += 1;
        } catch (error) {
          if (error instanceof SettlementWalletError) throw error;
          throw error;
        }
      }
    }

    const maxRevision = await this.repo.findMaxRevisionNumber(input.drawId);
    const revision = createResultRevision({
      id: randomUUID(),
      drawId: input.drawId,
      revision: maxRevision + 1,
      state: "RECEIVED",
      resultSchemaVersionRef: input.resultSchemaVersionRef.trim(),
      resultSourceRef: input.resultSourceRef?.trim() || null,
      resultData: input.resultData ?? { ...input.winningNumbers },
      winningNumbers: { ...input.winningNumbers },
      supersedesRevisionId: active.id,
      correlationId,
      confirmedAt: null,
      confirmedByAdminId: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.repo.createResultRevision({
      id: revision.id,
      drawId: revision.drawId,
      revision: revision.revision,
      state: revision.state,
      resultSchemaVersionRef: revision.resultSchemaVersionRef,
      resultSourceRef: revision.resultSourceRef,
      resultData: revision.resultData,
      winningNumbers: revision.winningNumbers,
      supersedesRevisionId: revision.supersedesRevisionId,
      correlationId: revision.correlationId,
    });

    // Mark the prior confirmed revision SUPERSEDED, then confirm the correction.
    await this.repo.updateResultRevisionState(active.id, "SUPERSEDED");
    const confirmedRecord = await this.repo.updateResultRevisionState(
      revision.id,
      "CONFIRMED",
      { confirmedAt: now, confirmedByAdminId: input.actor.adminId },
    );

    return { revision: this.toRevision(confirmedRecord), reversedCount };
  }

  /**
   * Creates (or resumes) the durable Settlement Batch for a Draw's active
   * confirmed Result and executes it to COMPLETED. Idempotent by the Result
   * revision: a re-driven run returns the same batch, and a crashed batch
   * resumes from its durable per-Order checkpoints without re-posting a payout.
   */
  async runSettlement(input: {
    drawId: string;
    correlationId?: string;
    actor?: SettlementActor;
    now?: Date;
  }): Promise<SettlementBatchRecord> {
    const now = input.now ?? this.now();
    const correlationId = input.correlationId || randomUUID();

    const revision = await this.repo.findActiveConfirmedRevision(input.drawId);
    if (!revision) {
      throw new SettlementError(
        "RESULT_NOT_CONFIRMED",
        `Draw ${input.drawId} has no active confirmed Result to settle`,
        409,
        {},
      );
    }

    const scope = `SETTLEMENT_BATCH:${input.drawId}`;
    const key = revision.id;
    const fingerprint = settlementFingerprint(input.drawId, revision.id);

    const existing = await this.repo.findSettlementBatchByCorrelation(scope, key);
    const draw = await this.requireDraw(input.drawId);

    let batch: SettlementBatchRecord;
    if (existing) {
      if (existing.state === "COMPLETED") {
        return existing;
      }
      batch = existing;
      if (draw.state === "RESULT_CONFIRMED") {
        const transitioned = await this.draws.transition({
          drawId: input.drawId,
          command: "START_SETTLEMENT",
          expectedVersion: draw.version,
        });
        void transitioned;
      }
    } else {
      const created = await this.repo.createSettlementBatch({
        id: randomUUID(),
        drawId: input.drawId,
        resultRevisionId: revision.id,
        correlationId,
        idempotencyScope: scope,
        idempotencyKey: key,
        fingerprint,
      });
      batch = created;
      if (draw.state === "RESULT_CONFIRMED") {
        await this.draws.transition({
          drawId: input.drawId,
          command: "START_SETTLEMENT",
          expectedVersion: draw.version,
        });
      }
    }

    return this.executeBatch(batch, revision, now);
  }

  /**
   * Executes the batch through its locked state machine using the batch's
   * durable rows as the checkpoint source of truth, so a crash anywhere between
   * a payout posting and COMPLETED resumes exactly where it stopped. Every
   * payout/reversal is idempotent per Order.
   */
  private async executeBatch(
    batch: SettlementBatchRecord,
    revision: ResultRevisionRecord,
    now: Date,
  ): Promise<SettlementBatchRecord> {
    let state: SettlementBatchState = batch.state;
    let drawVersion = 0;
    let drawWasSettling = false;

    const draw = await this.requireDraw(batch.drawId);
    if (draw.state === "SETTLING" || draw.state === "SETTLED") {
      drawWasSettling = true;
      drawVersion = draw.version;
    }

    try {
      // ---- CALCULATING: gather + evaluate, persist durable per-Order rows ----
      if (state === "PENDING" || state === "CALCULATING") {
        state = advanceSettlementBatch(state, "CALCULATING");
        await this.repo.updateBatchState(batch.id, state);

        const orders = await this.orders.listSettleableOrders(
          batch.drawId,
          batch.id,
        );
        for (const order of orders) {
          const evaluation = evaluateOrderSettlement({
            orderId: order.orderId,
            lines: order.lines,
            winningNumbers: revision.winningNumbers,
          });
          await this.repo.upsertSettlementOrder(batch.id, {
            orderId: order.orderId,
            memberId: order.memberId,
            outcome: evaluation.outcome,
            stakeMinor: order.totalStakeMinor,
            payoutMinor: evaluation.payoutMinor,
            status: "EVALUATED",
            payoutTransactionId: null,
          });
        }
        state = advanceSettlementBatch(state, "POSTING");
        await this.repo.updateBatchState(batch.id, state);
      }

      // ---- POSTING: post payouts once-only, using durable rows ----
      if (state === "POSTING") {
        const rows = await this.repo.listBatchOrders(batch.id);
        for (const row of rows) {
          if (row.status === "POSTED") continue;
          let payoutTransactionId: string | null = null;
          if (row.outcome === "WIN") {
            if (row.payoutMinor <= 0n) {
              throw new SettlementError(
                "SETTLEMENT_FAILED",
                `Winning Order ${row.orderId} resolved a non-positive payout`,
                500,
                { orderId: row.orderId },
              );
            }
            const posted = await this.wallet.postSettlementPayout({
              orderId: row.orderId,
              memberId: row.memberId,
              drawId: batch.drawId,
              amountMinor: row.payoutMinor,
              currency: "THB",
              correlationId: batch.correlationId,
            });
            payoutTransactionId = posted.transactionId;
          }
          await this.repo.upsertSettlementOrder(batch.id, {
            orderId: row.orderId,
            memberId: row.memberId,
            outcome: row.outcome,
            stakeMinor: row.stakeMinor,
            payoutMinor: row.payoutMinor,
            status: "POSTED",
            payoutTransactionId,
          });
        }
        state = advanceSettlementBatch(state, "COMMITTING");
        await this.repo.updateBatchState(batch.id, state);
      }

      // ---- COMMITTING: mark orders SETTLED (once-only), then COMPLETED ----
      if (state === "COMMITTING") {
        const rows = await this.repo.listBatchOrders(batch.id);
        for (const row of rows) {
          await this.orders.markOrderSettled({
            orderId: row.orderId,
            outcome: row.outcome,
            payoutMinor: row.payoutMinor,
            payoutTransactionId: row.payoutTransactionId,
          });
        }

        const totalStakeMinor = rows.reduce((sum, row) => sum + row.stakeMinor, 0n);
        const totalPayoutMinor = rows.reduce((sum, row) => sum + row.payoutMinor, 0n);
        const winningOrderCount = rows.filter((row) => row.outcome === "WIN").length;
        const losingOrderCount = rows.filter((row) => row.outcome === "LOSE").length;

        state = advanceSettlementBatch(state, "COMPLETED");
        await this.repo.updateBatchState(batch.id, state, {
          totalPayoutMinor,
          winningOrderCount,
          losingOrderCount,
          completedAt: now,
        });
      }
    } catch (error) {
      await this.repo.updateBatchState(batch.id, "FAILED");
      if (error instanceof SettlementError) throw error;
      throw error;
    }

    // The Member-visible outcome is authoritative only now that the batch is
    // COMPLETED; only a first settlement advances the Draw to SETTLED (a
    // correction re-settlement leaves the historical Draw SETTLED).
    if (drawWasSettling && draw.state === "SETTLING") {
      await this.draws.transition({
        drawId: batch.drawId,
        command: "COMPLETE_SETTLEMENT",
        expectedVersion: drawVersion,
      });
    }

    const completed = await this.repo.findBatchById(batch.id);
    if (!completed) {
      throw new SettlementError(
        "BATCH_NOT_FOUND",
        `Settlement Batch ${batch.id} disappeared during execution`,
        500,
        {},
      );
    }
    return completed;
  }

  async getBatch(input: { drawId?: string; batchId?: string }): Promise<SettlementBatchRecord> {
    if (input.batchId) {
      throw new SettlementError(
        "BATCH_NOT_FOUND",
        "Settlement batch lookup by id is not supported yet",
        501,
        {},
      );
    }
    if (!input.drawId) {
      throw new SettlementError(
        "BATCH_NOT_FOUND",
        "A Draw id is required to read a Settlement Batch",
        400,
        {},
      );
    }
    const batch = await this.repo.findActiveBatch(input.drawId);
    if (!batch) {
      throw new SettlementError(
        "BATCH_NOT_FOUND",
        `No Settlement Batch found for Draw ${input.drawId}`,
        404,
        {},
      );
    }
    return batch;
  }

  async listOrdersForBatch(batchId: string): Promise<readonly SettlementOrderRecord[]> {
    return this.repo.listBatchOrders(batchId);
  }

  /**
   * Member-facing settlement outcome read for a Bet Order. The outcome is only
   * authoritative (member-visible) when the batch that produced it has
   * COMPLETED; an in-flight or failed batch never exposes a partial outcome.
   */
  async getOrderSettlementOutcome(memberId: string, orderId: string): Promise<{
    orderId: string;
    outcome: "WIN" | "LOSE" | null;
    payoutMinor: bigint;
    batchState: string | null;
    authoritative: boolean;
  }> {
    const row = await this.repo.findSettlementOrderByOrderId(orderId);
    if (!row || row.memberId !== memberId) {
      throw new SettlementError(
        "BATCH_NOT_FOUND",
        `No settlement outcome found for Order ${orderId}`,
        404,
        {},
      );
    }
    const batch = await this.repo.findBatchById(row.batchId);
    const authoritative = batch?.state === "COMPLETED";
    return {
      orderId: row.orderId,
      outcome: authoritative ? row.outcome : null,
      payoutMinor: row.payoutMinor,
      batchState: batch?.state ?? null,
      authoritative,
    };
  }

  private async requireDraw(drawId: string): Promise<{
    state: string;
    version: number;
    resultSchemaVersionRef: string;
    resultSourceRef: string | null;
    betTypes: ReadonlyArray<{ betTypeCode: string; validationPattern: string }>;
  }> {
    const draw = await this.draws.loadDraw(drawId);
    if (!draw) {
      throw new SettlementError(
        "DRAW_NOT_FOUND",
        `Lottery Draw ${drawId} not found`,
        404,
        {},
      );
    }
    return draw;
  }

  private validateWinningNumbers(
    winningNumbers: WinningNumbers,
    betTypes: ReadonlyArray<{ betTypeCode: string; validationPattern: string }>,
  ): void {
    const byCode = new Map(betTypes.map((betType) => [betType.betTypeCode, betType]));
    for (const [betTypeCode, number] of Object.entries(winningNumbers)) {
      const betType = byCode.get(betTypeCode);
      if (!betType) {
        throw new SettlementError(
          "RESULT_SCHEMA_MISMATCH",
          `Winning number references Bet Type ${betTypeCode} which is not enabled on this Draw`,
          400,
          { betTypeCode },
        );
      }
      const pattern = new RegExp(betType.validationPattern);
      if (typeof number !== "string" || !pattern.test(number)) {
        throw new SettlementError(
          "RESULT_SCHEMA_MISMATCH",
          `Winning number "${number}" for Bet Type ${betTypeCode} does not match its validation pattern`,
          400,
          { betTypeCode, validationPattern: betType.validationPattern },
        );
      }
    }
  }

  private toRevision(record: ResultRevisionRecord): ResultRevision {
    return createResultRevision({
      id: record.id,
      drawId: record.drawId,
      revision: record.revision,
      state: record.state,
      resultSchemaVersionRef: record.resultSchemaVersionRef,
      resultSourceRef: record.resultSourceRef,
      resultData: record.resultData,
      winningNumbers: record.winningNumbers,
      supersedesRevisionId: record.supersedesRevisionId,
      correlationId: record.correlationId,
      confirmedAt: record.confirmedAt,
      confirmedByAdminId: record.confirmedByAdminId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}

export function settlementFingerprint(drawId: string, revisionId: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ drawId, revisionId }))
    .digest("hex");
}

export function sameWinningNumbers(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index] as string;
    if (key !== rightKeys[index]) return false;
    if (left[key] !== right[key]) return false;
  }
  return true;
}
