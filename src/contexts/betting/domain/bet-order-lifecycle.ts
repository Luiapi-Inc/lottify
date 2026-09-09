// Bet Order lifecycle state machine (Wayfinder Issue 03, Bet Order / Bet Line).
//
// Canonical states (locked):
//   DRAFT -> QUOTED -> CONFIRMING -> CONFIRMED -> SETTLED
//   CONFIRMED -> CANCELLING -> CANCELLED
//   QUOTED -> EXPIRED
//   CONFIRMING -> REJECTED
// Terminal states are EXPIRED, REJECTED, CANCELLED and SETTLED.
//
// Two layers are separated here so retry semantics stay honest:
//   1. Member commands (CONFIRM / CANCEL) are what the client may submit. A
//      command moves QUOTED -> CONFIRMING or CONFIRMED -> CANCELLING; retrying
//      the command from the in-flight CONFIRMING/CANCELLING state is an
//      idempotent in-place no-op so a durable retry can never double-debit or
//      double-refund.
//   2. Orchestration outcomes resolve the in-flight state only after the
//      authoritative Wallet & Ledger / refund effect is durable: a successful
//      reserve+commit resolves CONFIRMING -> CONFIRMED, an authoritative
//      denial resolves CONFIRMING -> REJECTED, and a posted refund resolves
//      CANCELLING -> CANCELLED.
//
// This module is pure: it encodes only legality, optimistic concurrency and
// terminal-immutability invariants. Guards that require current world state
// (Draw cutoff, Member eligibility, exposure, reservation/refund success) are
// applied by the caller before invoking a transition and are not assumed here.

export const BET_ORDER_STATES = [
  "DRAFT",
  "QUOTED",
  "CONFIRMING",
  "CONFIRMED",
  "CANCELLING",
  "CANCELLED",
  "EXPIRED",
  "REJECTED",
  "SETTLED",
] as const;

export type BetOrderState = (typeof BET_ORDER_STATES)[number];

const TERMINAL_STATES: ReadonlySet<BetOrderState> = new Set<BetOrderState>([
  "EXPIRED",
  "REJECTED",
  "CANCELLED",
  "SETTLED",
]);

export interface BetOrderStateRecord {
  readonly state: BetOrderState;
  /** Optimistic-concurrency guard: every durable state change increments this. */
  readonly version: number;
}

/**
 * Member-facing commands the client may submit against an Order. Internal
 * outcomes (EXPIRED, REJECTED, SETTLED, and the confirmed/cancelled
 * resolutions) are never client commands.
 */
export const BET_ORDER_COMMANDS = ["CONFIRM", "CANCEL"] as const;
export type BetOrderCommand = (typeof BET_ORDER_COMMANDS)[number];

/** Authoritative outcomes that resolve an in-flight Order. */
export const BET_ORDER_RESOLUTIONS = ["CONFIRMED", "REJECTED", "CANCELLED"] as const;
export type BetOrderResolution = (typeof BET_ORDER_RESOLUTIONS)[number];

const COMMAND_TRANSITIONS: Readonly<
  Record<BetOrderState, Partial<Record<BetOrderCommand, BetOrderState>>>
> = {
  DRAFT: {},
  QUOTED: { CONFIRM: "CONFIRMING" },
  CONFIRMING: { CONFIRM: "CONFIRMING" },
  CONFIRMED: { CANCEL: "CANCELLING" },
  CANCELLING: { CANCEL: "CANCELLING" },
  CANCELLED: {},
  EXPIRED: {},
  REJECTED: {},
  SETTLED: {},
};

// Which in-flight states each resolution may legally resolve.
const RESOLUTION_PRECONDITIONS: Readonly<
  Record<BetOrderResolution, BetOrderState>
> = {
  CONFIRMED: "CONFIRMING",
  REJECTED: "CONFIRMING",
  CANCELLED: "CANCELLING",
};

export class InvalidBetOrderStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBetOrderStateError";
  }
}

export type BetOrderRuleCode =
  | "INVALID_STATE"
  | "VERSION_CONFLICT"
  | "ILLEGAL_ACTION";

export class BetOrderCommandError extends Error {
  readonly command: string;
  readonly state: BetOrderState;
  readonly code: BetOrderRuleCode;
  readonly details: Record<string, unknown>;

  constructor(
    command: string,
    state: BetOrderState,
    code: BetOrderRuleCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "BetOrderCommandError";
    this.command = command;
    this.state = state;
    this.code = code;
    this.details = details;
  }
}

export interface BetOrderTransitionInput {
  readonly current: BetOrderStateRecord;
  /** Expected version; a stale write must fail with VERSION_CONFLICT. */
  readonly expectedVersion: number;
  readonly command: BetOrderCommand;
}

export interface BetOrderResolutionInput {
  readonly current: BetOrderStateRecord;
  readonly expectedVersion: number;
  readonly resolution: BetOrderResolution;
}

export interface BetOrderTransitionResult {
  readonly state: BetOrderState;
  readonly version: number;
}

function assertValidStateRecord(record: BetOrderStateRecord): void {
  if (
    !BET_ORDER_STATES.includes(record.state) ||
    !Number.isInteger(record.version) ||
    record.version < 1
  ) {
    throw new InvalidBetOrderStateError(
      "Bet Order state record must carry a legal state and a positive integer version",
    );
  }
}

function assertFreshVersion(
  current: BetOrderStateRecord,
  expectedVersion: number,
  operation: string,
): void {
  if (expectedVersion !== current.version) {
    throw new BetOrderCommandError(
      operation,
      current.state,
      "VERSION_CONFLICT",
      "Bet Order has changed since it was read; refresh and re-evaluate",
      { expectedVersion, currentVersion: current.version },
    );
  }
}

/** The commands a client may legally submit from a given Order state. */
export function allowedBetOrderActions(
  state: BetOrderState,
): readonly BetOrderCommand[] {
  if (!BET_ORDER_STATES.includes(state)) {
    throw new InvalidBetOrderStateError(`Unknown Bet Order state ${state}`);
  }
  return BET_ORDER_COMMANDS.filter(
    (command) => COMMAND_TRANSITIONS[state][command] !== undefined,
  );
}

export function isTerminalBetOrderState(state: BetOrderState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Applies a member command under optimistic concurrency. Rejects stale writes
 * with VERSION_CONFLICT and terminal or illegal commands with INVALID_STATE /
 * ILLEGAL_ACTION. A retry of an in-flight CONFIRM/CANCEL is an idempotent
 * no-op that preserves the current state and version.
 */
export function applyBetOrderCommand(
  input: BetOrderTransitionInput,
): BetOrderTransitionResult {
  assertValidStateRecord(input.current);
  assertFreshVersion(input.current, input.expectedVersion, input.command);

  if (TERMINAL_STATES.has(input.current.state)) {
    throw new BetOrderCommandError(
      input.command,
      input.current.state,
      "INVALID_STATE",
      `Cannot ${input.command} a terminal Bet Order`,
      { state: input.current.state },
    );
  }

  const nextState = COMMAND_TRANSITIONS[input.current.state][input.command];
  if (nextState === undefined) {
    throw new BetOrderCommandError(
      input.command,
      input.current.state,
      "ILLEGAL_ACTION",
      `Bet Order in ${input.current.state} does not allow ${input.command}`,
      { allowedActions: allowedBetOrderActions(input.current.state) },
    );
  }

  const inPlaceRetry = nextState === input.current.state;
  return Object.freeze({
    state: nextState,
    version: inPlaceRetry ? input.current.version : input.current.version + 1,
  });
}

/**
 * Resolves an in-flight Order to an authoritative outcome. Only a CONFIRMING
 * Order may become CONFIRMED/REJECTED and only a CANCELLING Order may become
 * CANCELLED; this forces the caller to prove the Wallet & Ledger / refund
 * effect before terminal financial state is reached.
 */
export function applyBetOrderResolution(
  input: BetOrderResolutionInput,
): BetOrderTransitionResult {
  assertValidStateRecord(input.current);
  assertFreshVersion(input.current, input.expectedVersion, input.resolution);

  if (TERMINAL_STATES.has(input.current.state)) {
    throw new BetOrderCommandError(
      input.resolution,
      input.current.state,
      "INVALID_STATE",
      `Cannot resolve a terminal Bet Order`,
      { state: input.current.state },
    );
  }

  const requiredState = RESOLUTION_PRECONDITIONS[input.resolution];
  if (input.current.state !== requiredState) {
    throw new BetOrderCommandError(
      input.resolution,
      input.current.state,
      "INVALID_STATE",
      `Resolution ${input.resolution} requires a ${requiredState} Bet Order`,
      { state: input.current.state },
    );
  }

  return Object.freeze({
    state: input.resolution,
    version: input.current.version + 1,
  });
}
