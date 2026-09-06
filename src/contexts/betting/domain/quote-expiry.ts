export interface QuoteExpiryCandidates {
  readonly configuredTtlExpiresAt: Date;
  readonly drawCutoffAt: Date;
}

export interface QuoteExpiry {
  readonly expiresAt: Date;
}

export class InvalidQuoteExpiryInstantError extends Error {
  constructor(
    readonly field:
      | "configuredTtlExpiresAt"
      | "drawCutoffAt"
      | "expiresAt"
      | "serverNow",
  ) {
    super(`${field} must be a valid instant`);
    this.name = "InvalidQuoteExpiryInstantError";
  }
}

export function resolveQuoteExpiry(
  candidates: QuoteExpiryCandidates,
): QuoteExpiry {
  assertValidInstant("configuredTtlExpiresAt", candidates.configuredTtlExpiresAt);
  assertValidInstant("drawCutoffAt", candidates.drawCutoffAt);

  const expiresAt =
    candidates.configuredTtlExpiresAt.getTime() <= candidates.drawCutoffAt.getTime()
      ? candidates.configuredTtlExpiresAt
      : candidates.drawCutoffAt;

  return {
    expiresAt: new Date(expiresAt.getTime()),
  };
}

export function isQuoteExpired(expiry: QuoteExpiry, serverNow: Date): boolean {
  assertValidInstant("serverNow", serverNow);
  assertValidInstant("expiresAt", expiry.expiresAt);

  return serverNow.getTime() >= expiry.expiresAt.getTime();
}

function assertValidInstant(
  field:
    | "configuredTtlExpiresAt"
    | "drawCutoffAt"
    | "expiresAt"
    | "serverNow",
  value: Date,
): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new InvalidQuoteExpiryInstantError(field);
  }
}
