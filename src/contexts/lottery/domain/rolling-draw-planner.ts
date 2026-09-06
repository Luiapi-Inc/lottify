import {
  applyScheduleOccurrenceException,
  createScheduleOccurrence,
  type ScheduleOccurrence,
  type ScheduleOccurrenceException,
} from "./schedule-occurrence";

export interface ExistingDrawGenerationState {
  readonly productId: string;
  readonly occurrenceIdentity: string;
  readonly hasManualOverride: boolean;
  readonly hasBusinessActivity: boolean;
}

export interface PlannedDrawCreation {
  readonly productId: string;
  readonly occurrence: ScheduleOccurrence;
}

export interface RollingDrawPlan {
  readonly create: readonly PlannedDrawCreation[];
  readonly preservedOccurrenceIdentities: readonly string[];
  readonly skippedOccurrenceIdentities: readonly string[];
}

export interface PlanRollingDrawsInput {
  readonly productId: string;
  readonly baseOccurrences: readonly ScheduleOccurrence[];
  readonly exceptions: readonly ScheduleOccurrenceException[];
  readonly existingDraws: readonly ExistingDrawGenerationState[];
}

export class InvalidRollingDrawPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRollingDrawPlanError";
  }
}

export function planRollingDraws(input: PlanRollingDrawsInput): RollingDrawPlan {
  if (input.productId.trim().length === 0) {
    throw new InvalidRollingDrawPlanError("Lottery Product id must not be blank");
  }

  const exceptionsByTarget = new Map<string, ScheduleOccurrenceException>();
  for (const exception of input.exceptions) {
    if (exceptionsByTarget.has(exception.targetOccurrenceIdentity)) {
      throw new InvalidRollingDrawPlanError(
        `Schedule occurrence ${exception.targetOccurrenceIdentity} has more than one exception`,
      );
    }
    exceptionsByTarget.set(exception.targetOccurrenceIdentity, exception);
  }

  const existingIdentities = new Set(
    input.existingDraws
      .filter((draw) => draw.productId === input.productId)
      .map((draw) => draw.occurrenceIdentity),
  );
  const plannedIdentities = new Set<string>();
  const create: PlannedDrawCreation[] = [];
  const preservedOccurrenceIdentities: string[] = [];
  const skippedOccurrenceIdentities: string[] = [];

  for (const base of input.baseOccurrences) {
    const occurrence = createScheduleOccurrence(base);

    if (existingIdentities.has(occurrence.occurrenceIdentity)) {
      preservedOccurrenceIdentities.push(occurrence.occurrenceIdentity);
      continue;
    }

    const effective = applyScheduleOccurrenceException(
      occurrence,
      exceptionsByTarget.get(occurrence.occurrenceIdentity),
    );

    if (effective === null) {
      skippedOccurrenceIdentities.push(occurrence.occurrenceIdentity);
      continue;
    }

    if (
      existingIdentities.has(effective.occurrenceIdentity) ||
      plannedIdentities.has(effective.occurrenceIdentity)
    ) {
      preservedOccurrenceIdentities.push(effective.occurrenceIdentity);
      continue;
    }

    plannedIdentities.add(effective.occurrenceIdentity);
    create.push(
      Object.freeze({
        productId: input.productId,
        occurrence: effective,
      }),
    );
  }

  return Object.freeze({
    create: Object.freeze(create),
    preservedOccurrenceIdentities: Object.freeze(preservedOccurrenceIdentities),
    skippedOccurrenceIdentities: Object.freeze(skippedOccurrenceIdentities),
  });
}
