// Result Revision lifecycle (Wayfinder Issue 03, Result revisions).
//
// A Result is the validated, Product-shaped winning data for a Draw. It is
// modeled as an immutable revision: intake creates a revision, validation and
// governed confirmation advance it, and a correction NEVER edits a confirmed
// Result — it creates a new revision that relationally SUPERSEDES the prior
// confirmed revision (Ticket 02, workflow 7).
//
// Canonical states (locked):
//   RECEIVED -> VALIDATING -> REVIEW_REQUIRED? -> CONFIRMED
//   CONFIRMED -> SUPERSEDED (only when a correction revision is confirmed)
//
// Confirmed payloads are immutable. This module is pure: it encodes only the
// legality and the terminal-immutability invariant. Guards that require world
// state (Draw state, provider evidence, approval) are applied by the caller.

export const RESULT_REVISION_STATES = [
  "RECEIVED",
  "VALIDATING",
  "REVIEW_REQUIRED",
  "CONFIRMED",
  "SUPERSEDED",
] as const;

export type ResultRevisionState = (typeof RESULT_REVISION_STATES)[number];

const TERMINAL_STATES: ReadonlySet<ResultRevisionState> = new Set([
  "CONFIRMED",
  "SUPERSEDED",
]);

/** A governed confirmation/approval command on a Result revision. */
export const RESULT_REVISION_COMMANDS = [
  "START_VALIDATION",
  "CONFIRM",
  "MARK_REVIEW_REQUIRED",
  "REVALIDATE",
] as const;

export type ResultRevisionCommand = (typeof RESULT_REVISION_COMMANDS)[number];

const COMMAND_TRANSITIONS: Readonly<
  Record<ResultRevisionState, Partial<Record<ResultRevisionCommand, ResultRevisionState>>>
> = {
  RECEIVED: { START_VALIDATION: "VALIDATING" },
  VALIDATING: {
    CONFIRM: "CONFIRMED",
    MARK_REVIEW_REQUIRED: "REVIEW_REQUIRED",
  },
  REVIEW_REQUIRED: { REVALIDATE: "VALIDATING" },
  CONFIRMED: {},
  SUPERSEDED: {},
};

export class InvalidResultRevisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidResultRevisionError";
  }
}

export interface ResultRevisionStateRecord {
  readonly state: ResultRevisionState;
}

export interface ResultRevisionTransitionInput {
  readonly current: ResultRevisionStateRecord;
  readonly command: ResultRevisionCommand;
}

export interface ResultRevisionTransitionResult {
  readonly state: ResultRevisionState;
}

export function isTerminalResultRevisionState(
  state: ResultRevisionState,
): boolean {
  return TERMINAL_STATES.has(state);
}

export function applyResultRevisionTransition(
  input: ResultRevisionTransitionInput,
): ResultRevisionTransitionResult {
  if (!RESULT_REVISION_STATES.includes(input.current.state)) {
    throw new InvalidResultRevisionError(
      `Unknown Result revision state ${input.current.state}`,
    );
  }
  if (TERMINAL_STATES.has(input.current.state)) {
    throw new InvalidResultRevisionError(
      `Result revision state ${input.current.state} is terminal and immutable`,
    );
  }
  const nextState = COMMAND_TRANSITIONS[input.current.state][input.command];
  if (nextState === undefined) {
    throw new InvalidResultRevisionError(
      `Result revision in ${input.current.state} does not allow ${input.command}`,
    );
  }
  return Object.freeze({ state: nextState });
}

/** Normalized winning-number map keyed by Bet Type code. */
export type WinningNumbers = Readonly<Record<string, string>>;

export interface ResultRevision {
  readonly id: string;
  readonly drawId: string;
  readonly revision: number;
  readonly state: ResultRevisionState;
  readonly resultSchemaVersionRef: string;
  readonly resultSourceRef: string | null;
  /** Raw provider/Product-shaped payload captured at intake. */
  readonly resultData: Readonly<Record<string, unknown>>;
  /** Normalized `{ betTypeCode: winningCanonicalNumber }` used for evaluation. */
  readonly winningNumbers: WinningNumbers;
  readonly supersedesRevisionId: string | null;
  readonly correlationId: string;
  readonly confirmedAt: Date | null;
  readonly confirmedByAdminId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface BuildResultRevisionInput {
  readonly id: string;
  readonly drawId: string;
  readonly revision: number;
  readonly state: ResultRevisionState;
  readonly resultSchemaVersionRef: string;
  readonly resultSourceRef: string | null;
  readonly resultData: Readonly<Record<string, unknown>>;
  readonly winningNumbers: WinningNumbers;
  readonly supersedesRevisionId: string | null;
  readonly correlationId: string;
  readonly confirmedAt: Date | null;
  readonly confirmedByAdminId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function createResultRevision(
  input: BuildResultRevisionInput,
): ResultRevision {
  if (!Number.isInteger(input.revision) || input.revision < 1) {
    throw new InvalidResultRevisionError(
      "Result revision number must be a positive integer",
    );
  }
  if (input.drawId.trim().length === 0) {
    throw new InvalidResultRevisionError("Result revision requires a Draw id");
  }
  if (input.resultSchemaVersionRef.trim().length === 0) {
    throw new InvalidResultRevisionError(
      "Result revision requires a Result Schema version reference",
    );
  }
  for (const betTypeCode of Object.keys(input.winningNumbers)) {
    const number = input.winningNumbers[betTypeCode];
    if (typeof number !== "string" || number.length === 0) {
      throw new InvalidResultRevisionError(
        `Result winning number for bet type ${betTypeCode} must be a non-empty canonical string`,
      );
    }
  }
  return deepFreeze({
    id: input.id,
    drawId: input.drawId,
    revision: input.revision,
    state: input.state,
    resultSchemaVersionRef: input.resultSchemaVersionRef,
    resultSourceRef: input.resultSourceRef,
    resultData: { ...input.resultData },
    winningNumbers: { ...input.winningNumbers },
    supersedesRevisionId: input.supersedesRevisionId,
    correlationId: input.correlationId,
    confirmedAt: input.confirmedAt ? new Date(input.confirmedAt.getTime()) : null,
    confirmedByAdminId: input.confirmedByAdminId,
    createdAt: new Date(input.createdAt.getTime()),
    updatedAt: new Date(input.updatedAt.getTime()),
  });
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value as Readonly<T>;
}
