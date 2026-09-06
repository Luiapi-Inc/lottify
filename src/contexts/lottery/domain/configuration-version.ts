export interface BetTypeIdentity {
  readonly id: string;
  readonly code: string;
}

export interface PublishedBetTypeVersion<TPayout> {
  readonly id: string;
  readonly betType: BetTypeIdentity;
  readonly canonicalNumberFormat: string;
  readonly validationPattern: string;
  readonly defaultPayout: TPayout;
  readonly minStakeMinor: bigint;
  readonly maxStakeMinor: bigint;
  readonly limitPolicyRef: string;
  readonly restrictionPolicyRef: string;
  readonly settlementRuleVersionRef: string;
}

export interface CreatePublishedBetTypeVersionInput<TPayout> {
  readonly id: string;
  readonly betType: BetTypeIdentity;
  readonly canonicalNumberFormat: string;
  readonly validationPattern: string;
  readonly defaultPayout: TPayout;
  readonly minStakeMinor: bigint;
  readonly maxStakeMinor: bigint;
  readonly limitPolicyRef: string;
  readonly restrictionPolicyRef: string;
  readonly settlementRuleVersionRef: string;
}

export interface EnabledBetTypeVersionRef {
  readonly betTypeId: string;
  readonly betTypeVersionId: string;
}

export interface PublishedLotteryProductVersion {
  readonly id: string;
  readonly productId: string;
  readonly timezone: string;
  readonly enabledBetTypes: readonly EnabledBetTypeVersionRef[];
  readonly scheduleTemplateRef: string;
  readonly resultSchemaVersionRef: string;
  readonly settlementRuleVersionRef: string;
  readonly defaultPayoutPolicyRef: string;
  readonly defaultLimitPolicyRef: string;
  readonly defaultRestrictionPolicyRef: string;
  readonly effectiveFrom: Date;
  readonly effectiveUntil: Date | null;
}

export interface CreatePublishedLotteryProductVersionInput {
  readonly id: string;
  readonly productId: string;
  readonly timezone: string;
  readonly enabledBetTypes: readonly EnabledBetTypeVersionRef[];
  readonly scheduleTemplateRef: string;
  readonly resultSchemaVersionRef: string;
  readonly settlementRuleVersionRef: string;
  readonly defaultPayoutPolicyRef: string;
  readonly defaultLimitPolicyRef: string;
  readonly defaultRestrictionPolicyRef: string;
  readonly effectiveFrom: Date;
  readonly effectiveUntil: Date | null;
}

export class InvalidPublishedConfigurationVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPublishedConfigurationVersionError";
  }
}

export function createPublishedBetTypeVersion<TPayout>(
  input: CreatePublishedBetTypeVersionInput<TPayout>,
): PublishedBetTypeVersion<TPayout> {
  assertNonBlank("Bet Type version id", input.id);
  assertNonBlank("Bet Type id", input.betType.id);
  assertNonBlank("Bet Type code", input.betType.code);
  assertNonBlank("canonical number format", input.canonicalNumberFormat);
  assertNonBlank("validation pattern", input.validationPattern);
  assertNonBlank("limit policy ref", input.limitPolicyRef);
  assertNonBlank("restriction policy ref", input.restrictionPolicyRef);
  assertNonBlank("settlement rule version ref", input.settlementRuleVersionRef);

  if (input.minStakeMinor > input.maxStakeMinor) {
    throw new InvalidPublishedConfigurationVersionError(
      "Bet Type minimum stake cannot exceed maximum stake",
    );
  }

  return Object.freeze({
    id: input.id,
    betType: Object.freeze({ ...input.betType }),
    canonicalNumberFormat: input.canonicalNumberFormat,
    validationPattern: input.validationPattern,
    defaultPayout: cloneConfigurationValue(input.defaultPayout),
    minStakeMinor: input.minStakeMinor,
    maxStakeMinor: input.maxStakeMinor,
    limitPolicyRef: input.limitPolicyRef,
    restrictionPolicyRef: input.restrictionPolicyRef,
    settlementRuleVersionRef: input.settlementRuleVersionRef,
  });
}

export function createPublishedLotteryProductVersion(
  input: CreatePublishedLotteryProductVersionInput,
): PublishedLotteryProductVersion {
  assertNonBlank("Lottery Product version id", input.id);
  assertNonBlank("Lottery Product id", input.productId);
  assertNonBlank("Product timezone", input.timezone);
  assertNonBlank("Schedule Template ref", input.scheduleTemplateRef);
  assertNonBlank("Result Schema version ref", input.resultSchemaVersionRef);
  assertNonBlank("Settlement Rule version ref", input.settlementRuleVersionRef);
  assertNonBlank("default payout policy ref", input.defaultPayoutPolicyRef);
  assertNonBlank("default limit policy ref", input.defaultLimitPolicyRef);
  assertNonBlank("default restriction policy ref", input.defaultRestrictionPolicyRef);
  assertValidInstant("effectiveFrom", input.effectiveFrom);

  if (input.effectiveUntil !== null) {
    assertValidInstant("effectiveUntil", input.effectiveUntil);
    if (input.effectiveUntil.getTime() <= input.effectiveFrom.getTime()) {
      throw new InvalidPublishedConfigurationVersionError(
        "Lottery Product version effective period must end after it starts",
      );
    }
  }

  const enabledBetTypes = input.enabledBetTypes.map((reference) => {
    assertNonBlank("enabled Bet Type id", reference.betTypeId);
    assertNonBlank("enabled Bet Type version id", reference.betTypeVersionId);
    return Object.freeze({ ...reference });
  });
  const seenBetTypeIds = new Set<string>();
  for (const reference of enabledBetTypes) {
    if (seenBetTypeIds.has(reference.betTypeId)) {
      throw new InvalidPublishedConfigurationVersionError(
        `Lottery Product version cannot enable Bet Type ${reference.betTypeId} more than once`,
      );
    }
    seenBetTypeIds.add(reference.betTypeId);
  }

  return Object.freeze({
    id: input.id,
    productId: input.productId,
    timezone: input.timezone,
    enabledBetTypes: Object.freeze(enabledBetTypes),
    scheduleTemplateRef: input.scheduleTemplateRef,
    resultSchemaVersionRef: input.resultSchemaVersionRef,
    settlementRuleVersionRef: input.settlementRuleVersionRef,
    defaultPayoutPolicyRef: input.defaultPayoutPolicyRef,
    defaultLimitPolicyRef: input.defaultLimitPolicyRef,
    defaultRestrictionPolicyRef: input.defaultRestrictionPolicyRef,
    effectiveFrom: new Date(input.effectiveFrom.getTime()),
    effectiveUntil:
      input.effectiveUntil === null
        ? null
        : new Date(input.effectiveUntil.getTime()),
  });
}

export function cloneConfigurationValue<T>(value: T): T {
  return freezeConfigurationValue(structuredClone(value));
}

function freezeConfigurationValue<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  for (const nested of Object.values(value)) {
    freezeConfigurationValue(nested);
  }

  return Object.freeze(value);
}

function assertNonBlank(label: string, value: string): void {
  if (value.trim().length === 0) {
    throw new InvalidPublishedConfigurationVersionError(
      `${label} must not be blank`,
    );
  }
}

function assertValidInstant(label: string, value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new InvalidPublishedConfigurationVersionError(
      `${label} must be a valid instant`,
    );
  }
}
