import type { PaymentCurrency, PaymentProviderOutcome } from "./payment-provider-result";

/**
 * Locked Withdrawal lifecycle (Ticket 03). Payments owns the orchestration from
 * request through balance reservation, review/approval, provider payout,
 * confirmation evidence and Ledger finalization. Provider acceptance is not
 * completion: `COMPLETED` requires both payout evidence and authoritative Ledger
 * finalization.
 */
export const WITHDRAWAL_STATES = [
  "REQUESTED",
  "RESERVING",
  "REVIEWING",
  "APPROVED",
  "PAYOUT_PROCESSING",
  "PAYOUT_CONFIRMED",
  "FINALIZING",
  "COMPLETED",
  "CANCELLING",
  "CANCELLED",
  "REJECTED",
  "FAILED",
  "RECONCILING",
] as const;

export type WithdrawalState = (typeof WITHDRAWAL_STATES)[number];

export const WITHDRAWAL_TERMINAL_STATES = [
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
  "FAILED",
] as const;

export type WithdrawalTerminalState = (typeof WITHDRAWAL_TERMINAL_STATES)[number];

const WITHDRAWAL_TRANSITIONS: Record<WithdrawalState, readonly WithdrawalState[]> = {
  REQUESTED: ["RESERVING", "REJECTED"],
  RESERVING: ["REVIEWING", "APPROVED", "REJECTED"],
  REVIEWING: ["APPROVED", "REJECTED", "CANCELLING"],
  /**
   * `APPROVED -> REJECTED` is the mandatory pre-payout eligibility recheck
   * (Ticket 06): an approved withdrawal whose destination is no longer eligible
   * is rejected with authoritative Reservation release rather than paid out.
   */
  APPROVED: ["PAYOUT_PROCESSING", "CANCELLING", "REJECTED"],
  PAYOUT_PROCESSING: ["PAYOUT_CONFIRMED", "RECONCILING", "FAILED"],
  PAYOUT_CONFIRMED: ["FINALIZING"],
  FINALIZING: ["COMPLETED"],
  COMPLETED: [],
  CANCELLING: ["CANCELLED"],
  CANCELLED: [],
  REJECTED: [],
  FAILED: [],
  RECONCILING: ["PAYOUT_CONFIRMED", "FAILED"],
};

export const WITHDRAWAL_ACTOR_TYPES = ["MEMBER", "ADMIN", "SYSTEM", "PROVIDER"] as const;

export type WithdrawalActorType = (typeof WITHDRAWAL_ACTOR_TYPES)[number];

export const WITHDRAWAL_QUEUES = ["REVIEW", "APPROVAL", "PAYOUT", "RECONCILIATION"] as const;

export type WithdrawalQueue = (typeof WITHDRAWAL_QUEUES)[number];

export const WITHDRAWAL_SEVERITIES = ["LOW", "MEDIUM", "HIGH"] as const;

export type WithdrawalSeverity = (typeof WITHDRAWAL_SEVERITIES)[number];

export const WITHDRAWAL_ERROR_CODES = [
  "INVALID",
  "NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
  "STATE_CONFLICT",
  "VERSION_CONFLICT",
  "INSUFFICIENT_FUNDS",
  "PAYOUT_DESTINATION_NOT_ELIGIBLE",
  "WITHDRAWAL_BLOCKED",
  "PAYOUT_NOT_RETRYABLE",
  "PAYOUT_PROVIDER_REJECTED",
] as const;

export type WithdrawalErrorCode = (typeof WITHDRAWAL_ERROR_CODES)[number];

export class WithdrawalError extends Error {
  readonly code: WithdrawalErrorCode;

  constructor(code: WithdrawalErrorCode, message: string) {
    super(message);
    this.name = "WithdrawalError";
    this.code = code;
  }
}

/**
 * Payout provider identity used by this vertical. No production payout provider
 * is wired yet (Ticket 09 sequencing), so the deterministic payout fake is the
 * default binding and this code selects its scenario.
 */
export const PAYOUT_PROVIDER_ID = "payout-rail";

export const WITHDRAWAL_ELIGIBILITY_OUTCOMES = ["ALLOW", "REVIEW_REQUIRED", "DENY"] as const;

export type WithdrawalEligibilityOutcome = (typeof WITHDRAWAL_ELIGIBILITY_OUTCOMES)[number];

export function withdrawalCanTransition(from: WithdrawalState, to: WithdrawalState): boolean {
  return WITHDRAWAL_TRANSITIONS[from].includes(to);
}

export function assertWithdrawalTransition(from: WithdrawalState, to: WithdrawalState): void {
  if (!withdrawalCanTransition(from, to)) {
    throw new WithdrawalError(
      "STATE_CONFLICT",
      `Withdrawal cannot transition from ${from} to ${to}`,
    );
  }
}

export function withdrawalIsTerminal(state: WithdrawalState): boolean {
  return WITHDRAWAL_TERMINAL_STATES.includes(state as WithdrawalTerminalState);
}

/**
 * Whether the Withdrawal still holds an active Reservation. `LOCKED`/CASH value
 * is never transferred by a Reservation, so only a released or consumed
 * Reservation frees the Member's available spendable balance.
 */
export function withdrawalRetainsReservation(state: WithdrawalState): boolean {
  return !(
    state === "REQUESTED" ||
    withdrawalIsTerminal(state)
  );
}

/**
 * Intent-specific operation queue (Ticket 12). Review, approval, payout
 * processing and reconciliation are separate operational queues.
 */
export function withdrawalQueue(
  state: WithdrawalState,
  requiresApproval: boolean,
): WithdrawalQueue | null {
  if (state === "REVIEWING") return requiresApproval ? "APPROVAL" : "REVIEW";
  if (
    state === "APPROVED" ||
    state === "PAYOUT_PROCESSING" ||
    state === "PAYOUT_CONFIRMED" ||
    state === "FINALIZING"
  ) {
    return "PAYOUT";
  }
  if (state === "RECONCILING") return "RECONCILIATION";
  return null;
}

export function withdrawalStatesForQueue(queue: WithdrawalQueue): readonly WithdrawalState[] {
  switch (queue) {
    case "REVIEW":
      return ["REVIEWING"];
    case "APPROVAL":
      return ["REVIEWING"];
    case "PAYOUT":
      return ["APPROVED", "PAYOUT_PROCESSING", "PAYOUT_CONFIRMED", "FINALIZING"];
    case "RECONCILIATION":
      return ["RECONCILING"];
  }
}

export function withdrawalSeverity(state: WithdrawalState): WithdrawalSeverity {
  if (state === "RECONCILING" || state === "FAILED") return "HIGH";
  if (state === "REVIEWING" || state === "PAYOUT_PROCESSING" || state === "CANCELLING") {
    return "MEDIUM";
  }
  return "LOW";
}

export interface WithdrawalAllowedActions {
  member: readonly string[];
  admin: readonly string[];
}

/**
 * Explicitly permitted commands for the current state. Clients never infer
 * authorization or legal transitions from status alone (Ticket 10), and a
 * `RECONCILING` withdrawal never exposes a blind payout retry (Ticket 12).
 */
export function withdrawalAllowedActions(state: WithdrawalState): WithdrawalAllowedActions {
  const admin: string[] = [];
  if (state === "REVIEWING") admin.push("approve", "reject");
  if (state === "APPROVED") admin.push("request-payout");
  if (state === "PAYOUT_PROCESSING" || state === "RECONCILING") admin.push("reconcile");
  if (state === "PAYOUT_CONFIRMED" || state === "FINALIZING") admin.push("finalize");
  return {
    member: state === "REVIEWING" || state === "APPROVED" ? ["cancel"] : [],
    admin,
  };
}

/**
 * Maps a normalized payout provider outcome to the Withdrawal state. A
 * definitive provider rejection is a resolved `FAILED` with authoritative
 * Reservation release; an unknown/ambiguous outcome retains the Reservation and
 * enters `RECONCILING` (Ticket 02/09).
 */
export function withdrawalStateForPayoutOutcome(outcome: PaymentProviderOutcome): WithdrawalState {
  switch (outcome) {
    case "APPROVED":
      return "PAYOUT_CONFIRMED";
    case "PENDING":
      return "PAYOUT_PROCESSING";
    case "REJECTED":
      return "FAILED";
  }
}

export function validateWithdrawalInitiation(input: {
  amountMinor: bigint;
  currency: PaymentCurrency;
}): void {
  if (input.amountMinor <= 0n) {
    throw new WithdrawalError(
      "INVALID",
      "Withdrawal amount must be a positive integer in minor units",
    );
  }
}
