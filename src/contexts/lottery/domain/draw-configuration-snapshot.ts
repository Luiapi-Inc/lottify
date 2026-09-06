import {
  cloneConfigurationValue,
  type PublishedBetTypeVersion,
  type PublishedLotteryProductVersion,
} from "./configuration-version";

export interface DrawBetTypeConfigurationSnapshot<TPayout> {
  readonly betTypeId: string;
  readonly betTypeCode: string;
  readonly betTypeVersionId: string;
  readonly canonicalNumberFormat: string;
  readonly validationPattern: string;
  readonly payout: TPayout;
  readonly minStakeMinor: bigint;
  readonly maxStakeMinor: bigint;
  readonly limitPolicyRef: string;
  readonly restrictionPolicyRef: string;
  readonly settlementRuleVersionRef: string;
}

export interface DrawConfigurationSnapshot<TPayout> {
  readonly productId: string;
  readonly productVersionId: string;
  readonly timezone: string;
  readonly scheduleTemplateRef: string;
  readonly resultSchemaVersionRef: string;
  readonly settlementRuleVersionRef: string;
  readonly defaultPayoutPolicyRef: string;
  readonly defaultLimitPolicyRef: string;
  readonly defaultRestrictionPolicyRef: string;
  readonly betTypes: readonly DrawBetTypeConfigurationSnapshot<TPayout>[];
}

export interface CreateDrawConfigurationSnapshotInput<TPayout> {
  readonly productVersion: PublishedLotteryProductVersion;
  readonly betTypeVersions: readonly PublishedBetTypeVersion<TPayout>[];
}

export class DrawConfigurationSnapshotMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrawConfigurationSnapshotMismatchError";
  }
}

export function createDrawConfigurationSnapshot<TPayout>(
  input: CreateDrawConfigurationSnapshotInput<TPayout>,
): DrawConfigurationSnapshot<TPayout> {
  const versionsByIdentity = new Map<string, PublishedBetTypeVersion<TPayout>>();
  for (const version of input.betTypeVersions) {
    versionsByIdentity.set(versionIdentity(version.betType.id, version.id), version);
  }

  const betTypes = input.productVersion.enabledBetTypes.map((reference) => {
    const version = versionsByIdentity.get(
      versionIdentity(reference.betTypeId, reference.betTypeVersionId),
    );
    if (!version) {
      throw new DrawConfigurationSnapshotMismatchError(
        `Enabled Bet Type ${reference.betTypeId} must resolve exact version ${reference.betTypeVersionId}`,
      );
    }

    return Object.freeze({
      betTypeId: version.betType.id,
      betTypeCode: version.betType.code,
      betTypeVersionId: version.id,
      canonicalNumberFormat: version.canonicalNumberFormat,
      validationPattern: version.validationPattern,
      payout: cloneConfigurationValue(version.defaultPayout),
      minStakeMinor: version.minStakeMinor,
      maxStakeMinor: version.maxStakeMinor,
      limitPolicyRef: version.limitPolicyRef,
      restrictionPolicyRef: version.restrictionPolicyRef,
      settlementRuleVersionRef: version.settlementRuleVersionRef,
    });
  });

  return Object.freeze({
    productId: input.productVersion.productId,
    productVersionId: input.productVersion.id,
    timezone: input.productVersion.timezone,
    scheduleTemplateRef: input.productVersion.scheduleTemplateRef,
    resultSchemaVersionRef: input.productVersion.resultSchemaVersionRef,
    settlementRuleVersionRef: input.productVersion.settlementRuleVersionRef,
    defaultPayoutPolicyRef: input.productVersion.defaultPayoutPolicyRef,
    defaultLimitPolicyRef: input.productVersion.defaultLimitPolicyRef,
    defaultRestrictionPolicyRef: input.productVersion.defaultRestrictionPolicyRef,
    betTypes: Object.freeze(betTypes),
  });
}

function versionIdentity(betTypeId: string, versionId: string): string {
  return `${betTypeId}\u0000${versionId}`;
}
