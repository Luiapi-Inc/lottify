// Settlement Batch lifecycle + Bet Line evaluation (Wayfinder Issues 02, 03, 10).
//
// Settlement is the deterministic process that evaluates confirmed Bet Lines
// against a validated Result and posts the resulting financial effects. The
// Settlement Batch is the durable execution unit: its internal work may progress
// incrementally (CALCULATING -> POSTING -> COMMITTING) while its Member-visible
// outcome becomes authoritative only when the batch reaches COMPLETED.
//
// Canonical state machine (locked):
//   PENDING -> CALCULATING -> POSTING -> COMMITTING -> COMPLETED
//   any in-flight state -> FAILED -> RETRY_PENDING -> (resume from durable state)
//   A failed batch never exposes partial financial outcome to Members; a retry
//   resumes from durable checkpoints and every Ledger posting is idempotent, so
//   replay cannot duplicate a payout or reversal.
//
// This module is pure: it encodes only legality and the payout contract. The
// caller is responsible for durable state, idempotent financial postings and
// crash recovery.

export const SETTLEMENT_BATCH_STATES = [
  "PENDING",
  "CALCULATING",
  "POSTING",
  "COMMITTING",
  "COMPLETED",
  "FAILED",
  "RETRY_PENDING",
] as const;

export type SettlementBatchState = (typeof SETTLEMENT_BATCH_STATES)[number];

const IN_FLIGHT_STATES: ReadonlySet<SettlementBatchState> = new Set([
  "PENDING",
  "CALCULATING",
  "POSTING",
  "COMMITTING",
]);

export class InvalidSettlementBatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSettlementBatchError";
  }
}

export const SETTLEMENT_BATCH_FAILURES = ["FAILED", "RETRY_PENDING"] as const;

export type SettlementBatchAdvance = "CALCULATING" | "POSTING" | "COMMITTING" | "COMPLETED";

/**
 * Advance an in-flight batch one deterministic step, or mark it FAILED /
 * RETRY_PENDING. A COMPLETED batch is terminal and cannot be re-advanced.
 */
export function advanceSettlementBatch(
  state: SettlementBatchState,
  next: SettlementBatchAdvance | "FAILED" | "RETRY_PENDING",
): SettlementBatchState {
  if (state === "COMPLETED") {
    throw new InvalidSettlementBatchError(
      "A COMPLETED Settlement Batch is terminal and cannot be advanced",
    );
  }
  if (!IN_FLIGHT_STATES.has(state)) {
    throw new InvalidSettlementBatchError(
      `Settlement Batch in ${state} cannot be advanced`,
    );
  }

  if (next === "FAILED" || next === "RETRY_PENDING") {
    return next;
  }

  const inFlightOrder = ["PENDING", "CALCULATING", "POSTING", "COMMITTING"] as const;
  const advanceOrder = ["CALCULATING", "POSTING", "COMMITTING", "COMPLETED"] as const;
  const currentIndex = inFlightOrder.indexOf(
    state as (typeof inFlightOrder)[number],
  );
  const nextIndex = advanceOrder.indexOf(next);
  // The advance order aligns with the in-flight order: PENDING(0)->CALCULATING,
  // CALCULATING(1)->POSTING, POSTING(2)->COMMITTING, COMMITTING(3)->COMPLETED.
  if (currentIndex === -1 || nextIndex === -1 || nextIndex !== currentIndex) {
    throw new InvalidSettlementBatchError(
      `Illegal Settlement Batch advance ${state} -> ${next}`,
    );
  }
  return next;
}

// ---------------------------------------------------------------------------
// Bet Line evaluation against a validated Result.
// ---------------------------------------------------------------------------

export interface SettleLineInput {
  readonly betTypeCode: string;
  readonly canonicalNumber: string;
  readonly stakeMinor: bigint;
  readonly resolvedPayout: unknown;
}

/**
 * The v1 FIXED payout contract. `resolvedPayout` is `{ kind: "FIXED",
 * amountMinor }` where `amountMinor` is the total winning return for a
 * reference stake of 100 minor units (1 THB). A winning line therefore pays
 * `stake * amountMinor / 100` (integer, floored); the fixed return includes the
 * return of the stake, matching the standard Thai huay odds model, so a winning
 * stake is NOT separately refunded. Losing lines pay nothing. This is a
 * deterministic integer computation — never binary floating point.
 */
export function settlementPayoutMinor(line: SettleLineInput): bigint {
  const payout = normalizePayout(line.resolvedPayout);
  if (payout === null || payout.kind !== "FIXED") {
    throw new InvalidSettlementBatchError(
      `Bet Type ${line.betTypeCode} has an unsupported payout kind for settlement`,
    );
  }
  if (!Number.isSafeInteger(Number(payout.amountMinor)) || payout.amountMinor < 0n) {
    throw new InvalidSettlementBatchError(
      `Bet Type ${line.betTypeCode} FIXED payout must be a non-negative integer amount`,
    );
  }
  if (line.stakeMinor < 0n) {
    throw new InvalidSettlementBatchError(
      `Bet Line ${line.betTypeCode}:${line.canonicalNumber} stake must be non-negative`,
    );
  }
  // Reference unit: 100 minor units (1 THB). floor(stake * amountMinor / 100).
  return (line.stakeMinor * payout.amountMinor) / 100n;
}

export interface EvaluateBetLineInput extends SettleLineInput {
  readonly winningNumber: string | undefined;
}

export type BetLineSettlementOutcome = "WIN" | "LOSE";

export function evaluateBetLine(
  input: EvaluateBetLineInput,
): { outcome: BetLineSettlementOutcome; payoutMinor: bigint } {
  const isWin =
    input.winningNumber !== undefined &&
    input.winningNumber === input.canonicalNumber;
  if (!isWin) {
    return { outcome: "LOSE", payoutMinor: 0n };
  }
  return { outcome: "WIN", payoutMinor: settlementPayoutMinor(input) };
}

export interface EvaluateOrderInput {
  readonly orderId: string;
  readonly lines: readonly SettleLineInput[];
  readonly winningNumbers: Readonly<Record<string, string>>;
}

export interface OrderSettlementResult {
  readonly orderId: string;
  readonly outcome: "WIN" | "LOSE";
  readonly payoutMinor: bigint;
}

/**
 * An Order wins if ANY of its Bet Lines matches the Result. Its payout is the
 * sum of every winning line's payout (the fixed return includes the stake
 * return, so the win is the full return of each winning line).
 */
export function evaluateOrderSettlement(
  input: EvaluateOrderInput,
): OrderSettlementResult {
  let payoutMinor = 0n;
  let anyWin = false;
  for (const line of input.lines) {
    const { outcome, payoutMinor: linePayout } = evaluateBetLine({
      betTypeCode: line.betTypeCode,
      canonicalNumber: line.canonicalNumber,
      stakeMinor: line.stakeMinor,
      resolvedPayout: line.resolvedPayout,
      winningNumber: input.winningNumbers[line.betTypeCode],
    });
    if (outcome === "WIN") {
      anyWin = true;
      payoutMinor += linePayout;
    }
  }
  return {
    orderId: input.orderId,
    outcome: anyWin ? "WIN" : "LOSE",
    payoutMinor,
  };
}

function normalizePayout(value: unknown): {
  kind: string;
  amountMinor: bigint;
} | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const kind = record["kind"];
  if (kind !== "FIXED") return null;
  const amountMinor = record["amountMinor"];
  if (typeof amountMinor !== "bigint" && typeof amountMinor !== "number") return null;
  return { kind, amountMinor: BigInt(amountMinor) };
}
