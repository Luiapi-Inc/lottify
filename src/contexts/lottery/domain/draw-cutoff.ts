export interface DrawCutoff {
  readonly cutoffAt: Date;
}

export class InvalidDrawCutoffInstantError extends Error {
  constructor(readonly field: "cutoffAt" | "serverNow") {
    super(`${field} must be a valid instant`);
    this.name = "InvalidDrawCutoffInstantError";
  }
}

export class DrawCutoffReachedError extends Error {
  constructor() {
    super("Draw cutoff has been reached");
    this.name = "DrawCutoffReachedError";
  }
}

export function createDrawCutoff(cutoffAt: Date): DrawCutoff {
  assertValidInstant("cutoffAt", cutoffAt);

  return {
    cutoffAt: new Date(cutoffAt.getTime()),
  };
}

export function isBeforeDrawCutoff(
  cutoff: DrawCutoff,
  serverNow: Date,
): boolean {
  assertValidInstant("cutoffAt", cutoff.cutoffAt);
  assertValidInstant("serverNow", serverNow);

  return serverNow.getTime() < cutoff.cutoffAt.getTime();
}

export function assertBeforeDrawCutoff(
  cutoff: DrawCutoff,
  serverNow: Date,
): void {
  if (!isBeforeDrawCutoff(cutoff, serverNow)) {
    throw new DrawCutoffReachedError();
  }
}

function assertValidInstant(
  field: "cutoffAt" | "serverNow",
  value: Date,
): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new InvalidDrawCutoffInstantError(field);
  }
}
