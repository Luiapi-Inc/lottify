import { cloneConfigurationValue } from "./configuration-version";

export interface LocalBusinessTime {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export interface ScheduleExpectedTimes {
  readonly open: LocalBusinessTime;
  readonly cutoff: LocalBusinessTime;
  readonly draw: LocalBusinessTime;
}

export interface StructuredScheduleRecurrence {
  readonly [field: string]: unknown;
}

export interface PublishedScheduleTemplate<
  TRecurrence extends StructuredScheduleRecurrence = StructuredScheduleRecurrence,
> {
  readonly id: string;
  readonly timezone: string;
  readonly recurrence: Readonly<TRecurrence>;
  readonly expectedTimes: Readonly<ScheduleExpectedTimes>;
  readonly rollingGenerationHorizonDays: number;
}

export interface CreatePublishedScheduleTemplateInput<
  TRecurrence extends StructuredScheduleRecurrence = StructuredScheduleRecurrence,
> {
  readonly id: string;
  readonly timezone: string;
  readonly recurrence: TRecurrence;
  readonly expectedTimes: ScheduleExpectedTimes;
  readonly rollingGenerationHorizonDays: number;
}

export class InvalidScheduleTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidScheduleTemplateError";
  }
}

export function createPublishedScheduleTemplate<
  TRecurrence extends StructuredScheduleRecurrence,
>(
  input: CreatePublishedScheduleTemplateInput<TRecurrence>,
): PublishedScheduleTemplate<TRecurrence> {
  assertNonBlank("Schedule Template id", input.id);
  assertValidTimeZone(input.timezone);
  assertStructuredRecurrence(input.recurrence);
  assertLocalTime("open", input.expectedTimes.open);
  assertLocalTime("cutoff", input.expectedTimes.cutoff);
  assertLocalTime("draw", input.expectedTimes.draw);

  if (
    !Number.isInteger(input.rollingGenerationHorizonDays) ||
    input.rollingGenerationHorizonDays <= 0
  ) {
    throw new InvalidScheduleTemplateError(
      "Rolling generation horizon must be a positive whole number of days",
    );
  }

  return Object.freeze({
    id: input.id,
    timezone: input.timezone,
    recurrence: cloneConfigurationValue(input.recurrence),
    expectedTimes: Object.freeze({
      open: freezeLocalTime(input.expectedTimes.open),
      cutoff: freezeLocalTime(input.expectedTimes.cutoff),
      draw: freezeLocalTime(input.expectedTimes.draw),
    }),
    rollingGenerationHorizonDays: input.rollingGenerationHorizonDays,
  });
}

function assertStructuredRecurrence(value: unknown): asserts value is StructuredScheduleRecurrence {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value instanceof Date
  ) {
    throw new InvalidScheduleTemplateError(
      "Schedule recurrence must be structured business data, not a raw recurrence string",
    );
  }
}

function assertLocalTime(label: string, time: LocalBusinessTime): void {
  if (
    !Number.isInteger(time.hour) ||
    time.hour < 0 ||
    time.hour > 23 ||
    !Number.isInteger(time.minute) ||
    time.minute < 0 ||
    time.minute > 59 ||
    !Number.isInteger(time.second) ||
    time.second < 0 ||
    time.second > 59
  ) {
    throw new InvalidScheduleTemplateError(
      `${label} time must be a valid local business time`,
    );
  }
}

function freezeLocalTime(time: LocalBusinessTime): LocalBusinessTime {
  return Object.freeze({ ...time });
}

function assertNonBlank(label: string, value: string): void {
  if (value.trim().length === 0) {
    throw new InvalidScheduleTemplateError(`${label} must not be blank`);
  }
}

function assertValidTimeZone(value: string): void {
  assertNonBlank("Schedule Template timezone", value);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
  } catch {
    throw new InvalidScheduleTemplateError(
      "Schedule Template timezone must be a valid IANA timezone",
    );
  }
}
