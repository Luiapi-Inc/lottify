export const DRAW_STATES = [
  "DRAFT",
  "SCHEDULED",
  "OPEN",
  "CLOSED",
  "RESULT_PENDING",
  "RESULT_CONFIRMED",
  "SETTLING",
  "SETTLED",
  "CANCELLING",
  "CANCELLED",
] as const;

export type DrawState = (typeof DRAW_STATES)[number];

export const DRAW_LIFECYCLE_COMMANDS = [
  "SCHEDULE",
  "OPEN",
  "CLOSE",
  "MARK_RESULT_PENDING",
  "CONFIRM_RESULT",
  "START_SETTLEMENT",
  "COMPLETE_SETTLEMENT",
  "REQUEST_CANCELLATION",
  "COMPLETE_CANCELLATION",
  "REOPEN",
] as const;

export type DrawLifecycleCommand = (typeof DRAW_LIFECYCLE_COMMANDS)[number];

export interface DrawLifecycleContext {
  privilegedReopen?: boolean;
  resultExists?: boolean;
}

const STANDARD_TRANSITIONS: Readonly<
  Partial<Record<DrawState, Partial<Record<DrawLifecycleCommand, DrawState>>>>
> = {
  DRAFT: {
    SCHEDULE: "SCHEDULED",
    REQUEST_CANCELLATION: "CANCELLING",
  },
  SCHEDULED: {
    OPEN: "OPEN",
    REQUEST_CANCELLATION: "CANCELLING",
  },
  OPEN: {
    CLOSE: "CLOSED",
    REQUEST_CANCELLATION: "CANCELLING",
  },
  CLOSED: {
    MARK_RESULT_PENDING: "RESULT_PENDING",
    REQUEST_CANCELLATION: "CANCELLING",
  },
  RESULT_PENDING: {
    CONFIRM_RESULT: "RESULT_CONFIRMED",
  },
  RESULT_CONFIRMED: {
    START_SETTLEMENT: "SETTLING",
  },
  SETTLING: {
    COMPLETE_SETTLEMENT: "SETTLED",
  },
  CANCELLING: {
    COMPLETE_CANCELLATION: "CANCELLED",
  },
};

export class IllegalDrawTransitionError extends Error {
  constructor(
    readonly state: DrawState,
    readonly command: DrawLifecycleCommand,
    message = `Draw command ${command} is not allowed from ${state}`,
  ) {
    super(message);
    this.name = "IllegalDrawTransitionError";
  }
}

export function isTerminalDrawState(state: DrawState): boolean {
  return state === "SETTLED" || state === "CANCELLED";
}

export function transitionDraw(
  state: DrawState,
  command: DrawLifecycleCommand,
  context: DrawLifecycleContext = {},
): DrawState {
  if (isTerminalDrawState(state)) {
    throw new IllegalDrawTransitionError(
      state,
      command,
      `Draw state ${state} is terminal`,
    );
  }

  if (command === "REOPEN") {
    if (state !== "CLOSED") {
      throw new IllegalDrawTransitionError(state, command);
    }
    if (context.privilegedReopen !== true) {
      throw new IllegalDrawTransitionError(
        state,
        command,
        "Draw reopen requires privileged authorization",
      );
    }
    if (context.resultExists === true) {
      throw new IllegalDrawTransitionError(
        state,
        command,
        "Draw cannot reopen after a Result exists",
      );
    }
    return "OPEN";
  }

  const nextState = STANDARD_TRANSITIONS[state]?.[command];
  if (!nextState) {
    throw new IllegalDrawTransitionError(state, command);
  }
  return nextState;
}
