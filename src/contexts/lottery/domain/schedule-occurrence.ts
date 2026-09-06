export const SCHEDULE_OCCURRENCE_PROVENANCE = [
  "SCHEDULE_GENERATED",
  "MANUAL_EXCEPTION",
] as const;

export type ScheduleOccurrenceProvenance =
  (typeof SCHEDULE_OCCURRENCE_PROVENANCE)[number];

export interface ScheduleOccurrence {
  readonly occurrenceIdentity: string;
  readonly localDate: string;
  readonly openAt: Date;
  readonly cutoffAt: Date;
  readonly drawAt: Date;
  readonly provenance: ScheduleOccurrenceProvenance;
}

export const SCHEDULE_EXCEPTION_KINDS = ["SKIP", "MOVE", "REPLACE"] as const;

export type ScheduleExceptionKind = (typeof SCHEDULE_EXCEPTION_KINDS)[number];

export type ScheduleOccurrenceException =
  | {
      readonly kind: "SKIP";
      readonly targetOccurrenceIdentity: string;
      readonly targetLocalDate: string;
    }
  | {
      readonly kind: "MOVE" | "REPLACE";
      readonly targetOccurrenceIdentity: string;
      readonly targetLocalDate: string;
      readonly effectiveOccurrence: ScheduleOccurrence;
    };

export class InvalidScheduleOccurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidScheduleOccurrenceError";
  }
}

export function createScheduleOccurrence(
  input: ScheduleOccurrence,
): ScheduleOccurrence {
  assertNonBlank("Schedule occurrence identity", input.occurrenceIdentity);
  assertLocalDate(input.localDate);
  assertValidInstant("openAt", input.openAt);
  assertValidInstant("cutoffAt", input.cutoffAt);
  assertValidInstant("drawAt", input.drawAt);

  if (input.openAt.getTime() >= input.cutoffAt.getTime()) {
    throw new InvalidScheduleOccurrenceError(
      "Schedule occurrence open time must be before cutoff",
    );
  }
  if (input.cutoffAt.getTime() > input.drawAt.getTime()) {
    throw new InvalidScheduleOccurrenceError(
      "Schedule occurrence cutoff cannot be after draw time",
    );
  }

  return Object.freeze({
    occurrenceIdentity: input.occurrenceIdentity,
    localDate: input.localDate,
    openAt: new Date(input.openAt.getTime()),
    cutoffAt: new Date(input.cutoffAt.getTime()),
    drawAt: new Date(input.drawAt.getTime()),
    provenance: input.provenance,
  });
}

export function applyScheduleOccurrenceException(
  occurrence: ScheduleOccurrence,
  exception: ScheduleOccurrenceException | undefined,
): ScheduleOccurrence | null {
  const frozenOccurrence = createScheduleOccurrence(occurrence);
  if (!exception) {
    return frozenOccurrence;
  }

  if (
    exception.targetOccurrenceIdentity !== frozenOccurrence.occurrenceIdentity ||
    exception.targetLocalDate !== frozenOccurrence.localDate
  ) {
    throw new InvalidScheduleOccurrenceError(
      "Schedule exception target does not match the occurrence it is applied to",
    );
  }

  if (exception.kind === "SKIP") {
    return null;
  }

  return createScheduleOccurrence(exception.effectiveOccurrence);
}

function assertLocalDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InvalidScheduleOccurrenceError(
      "Schedule occurrence local date must use YYYY-MM-DD",
    );
  }
}

function assertValidInstant(label: string, value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new InvalidScheduleOccurrenceError(`${label} must be a valid instant`);
  }
}

function assertNonBlank(label: string, value: string): void {
  if (value.trim().length === 0) {
    throw new InvalidScheduleOccurrenceError(`${label} must not be blank`);
  }
}
