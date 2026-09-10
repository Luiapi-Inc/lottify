import { createHash } from "node:crypto";

import { cloneConfigurationValue } from "./configuration-version";
import type { DrawState } from "./draw-lifecycle";

export const DRAW_OVERRIDE_RESTRICTION_SEVERITIES = [
  "NORMAL",
  "HARD_EMERGENCY",
] as const;

export type DrawOverrideRestrictionSeverity =
  (typeof DRAW_OVERRIDE_RESTRICTION_SEVERITIES)[number];

export type DrawOverrideRuleErrorCode =
  | "INVALID_INPUT"
  | "NO_CHANGES"
  | "UNKNOWN_BET_TYPE"
  | "INVALID_STAKE_LIMIT"
  | "QUOTE_INVALIDATION_NOT_ALLOWED"
  | "DRAW_REOPEN_REQUIRED"
  | "TERMINAL_DRAW"
  | "INVALID_OVERRIDE_HISTORY"
  | "STALE_BASELINE"
  | "APPROVAL_PAYLOAD_MISMATCH";

export class DrawOverrideRuleError extends Error {
  constructor(
    readonly code: DrawOverrideRuleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DrawOverrideRuleError";
  }
}

export interface DrawBetTypeOverrideBaseline<TPayout, TRestriction> {
  readonly betTypeId: string;
  readonly payout: TPayout;
  readonly minStakeMinor: bigint;
  readonly maxStakeMinor: bigint;
  readonly numberRestrictions: readonly TRestriction[];
  readonly bettingEnabled: boolean;
}

export interface DrawOverrideBaseline<TPayout, TRestriction> {
  readonly drawId: string;
  readonly revisionRef: string;
  readonly state: DrawState;
  readonly drawAt: Date;
  readonly cutoffAt: Date;
  readonly resultSourceRef: string;
  readonly betTypes: readonly DrawBetTypeOverrideBaseline<TPayout, TRestriction>[];
}

export interface DrawBetTypeOverrideChange<TPayout, TRestriction> {
  readonly betTypeId: string;
  readonly payout?: TPayout;
  readonly minStakeMinor?: bigint;
  readonly maxStakeMinor?: bigint;
  readonly numberRestrictions?: readonly TRestriction[];
  readonly restrictionSeverity?: DrawOverrideRestrictionSeverity;
  readonly bettingEnabled?: boolean;
}

export interface DrawOverrideChanges<TPayout, TRestriction> {
  readonly drawAt?: Date;
  readonly cutoffAt?: Date;
  readonly resultSourceRef?: string;
  readonly betTypes?: readonly DrawBetTypeOverrideChange<TPayout, TRestriction>[];
  readonly invalidateExistingQuotes?: boolean;
}

/**
 * Revives a persisted Draw Override change set. Overrides are stored as JSON, so
 * every instant (`drawAt`, `cutoffAt`) comes back as a string; a reader of a
 * persisted Override must restore them before the resolution rules run, or a
 * cutoff/draw-time change silently breaks the effective Draw configuration.
 */
export function revivePersistedDrawOverrideChanges<TPayout, TRestriction>(
  persisted: unknown,
): DrawOverrideChanges<TPayout, TRestriction> {
  if (persisted === null || persisted === undefined) {
    return {};
  }
  const changes = persisted as DrawOverrideChanges<unknown, unknown>;
  return {
    ...(changes as DrawOverrideChanges<TPayout, TRestriction>),
    ...(changes.drawAt === undefined
      ? {}
      : { drawAt: revivePersistedInstant("Draw Override drawAt", changes.drawAt) }),
    ...(changes.cutoffAt === undefined
      ? {}
      : { cutoffAt: revivePersistedInstant("Draw Override cutoffAt", changes.cutoffAt) }),
  };
}

function revivePersistedInstant(label: string, value: unknown): Date {
  if (value instanceof Date) return cloneDate(value);
  if (typeof value === "string" || typeof value === "number") {
    const instant = new Date(value);
    if (Number.isFinite(instant.getTime())) return instant;
  }
  throw new DrawOverrideRuleError("INVALID_INPUT", `${label} must be a valid instant`);
}

export type DrawOverrideDiffField =
  | "DRAW_AT"
  | "CUTOFF_AT"
  | "RESULT_SOURCE"
  | "BET_TYPE_PAYOUT"
  | "BET_TYPE_MIN_STAKE"
  | "BET_TYPE_MAX_STAKE"
  | "BET_TYPE_NUMBER_RESTRICTIONS"
  | "BET_TYPE_BETTING_ENABLED";

export interface DrawOverrideDiffEntry {
  readonly field: DrawOverrideDiffField;
  readonly betTypeId?: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface DrawOverrideImpact {
  readonly futureDecisionScope: "FUTURE_DECISIONS_ONLY";
  readonly existingQuoteImpact:
    | "PRESERVE_ACCEPTED_QUOTES"
    | "INVALIDATE_UNCONFIRMED_QUOTES";
  readonly confirmedBetImpact: "UNCHANGED";
}

export interface DrawOverrideProposal<TPayout, TRestriction> {
  readonly id: string;
  readonly drawId: string;
  readonly supersedesOverrideId: string | null;
  readonly baselineRevisionRef: string;
  readonly baselineState: DrawState;
  readonly effectiveAt: Date;
  readonly reason: string;
  readonly actorId: string;
  readonly changes: DrawOverrideChanges<TPayout, TRestriction>;
  readonly diff: readonly DrawOverrideDiffEntry[];
  readonly impact: DrawOverrideImpact;
  readonly payloadDigest: string;
}

export interface CreateDrawOverrideProposalInput<TPayout, TRestriction> {
  readonly id: string;
  readonly supersedesOverrideId: string | null;
  readonly baseline: DrawOverrideBaseline<TPayout, TRestriction>;
  readonly effectiveAt: Date;
  readonly reason: string;
  readonly actorId: string;
  readonly changes: DrawOverrideChanges<TPayout, TRestriction>;
}

export interface PublishDrawOverrideInput<TPayout, TRestriction> {
  readonly proposal: DrawOverrideProposal<TPayout, TRestriction>;
  readonly currentBaselineRevisionRef: string;
  readonly currentDrawState: DrawState;
  readonly approvedPayloadDigest: string;
  readonly approvalEvidenceRef: string;
  readonly auditEvidenceRef: string;
  readonly publishedAt: Date;
}

export interface PublishedDrawOverride<TPayout, TRestriction>
  extends DrawOverrideProposal<TPayout, TRestriction> {
  readonly approvalEvidenceRef: string;
  readonly auditEvidenceRef: string;
  readonly publishedAt: Date;
}

export interface ResolvedDrawOverrideConfiguration<TPayout, TRestriction> {
  readonly drawAt: Date;
  readonly cutoffAt: Date;
  readonly resultSourceRef: string;
  readonly betTypes: readonly DrawBetTypeOverrideBaseline<TPayout, TRestriction>[];
  readonly appliedOverrideIds: readonly string[];
}

const DRAW_CHANGE_KEYS = new Set([
  "drawAt",
  "cutoffAt",
  "resultSourceRef",
  "betTypes",
  "invalidateExistingQuotes",
]);

const BET_TYPE_CHANGE_KEYS = new Set([
  "betTypeId",
  "payout",
  "minStakeMinor",
  "maxStakeMinor",
  "numberRestrictions",
  "restrictionSeverity",
  "bettingEnabled",
]);

export function createDrawOverrideProposal<TPayout, TRestriction>(
  input: CreateDrawOverrideProposalInput<TPayout, TRestriction>,
): DrawOverrideProposal<TPayout, TRestriction> {
  assertNonBlank("Draw Override id", input.id);
  assertNonBlank("Draw id", input.baseline.drawId);
  assertNonBlank("Draw baseline revision ref", input.baseline.revisionRef);
  assertNonBlank("Draw Override reason", input.reason);
  assertNonBlank("Draw Override actor id", input.actorId);
  assertValidInstant("Draw Override effectiveAt", input.effectiveAt);
  assertValidInstant("Draw drawAt", input.baseline.drawAt);
  assertValidInstant("Draw cutoffAt", input.baseline.cutoffAt);
  assertNonBlank("Draw result source ref", input.baseline.resultSourceRef);

  if (input.supersedesOverrideId !== null) {
    assertNonBlank("superseded Draw Override id", input.supersedesOverrideId);
  }

  if (input.baseline.state === "SETTLED" || input.baseline.state === "CANCELLED") {
    throw new DrawOverrideRuleError(
      "TERMINAL_DRAW",
      `Draw Override cannot modify terminal Draw state ${input.baseline.state}`,
    );
  }

  assertAllowedKeys("Draw Override changes", input.changes, DRAW_CHANGE_KEYS);

  const normalizedChanges = normalizeChanges(input.baseline, input.changes);
  const effectiveDrawAt = normalizedChanges.drawAt ?? cloneDate(input.baseline.drawAt);
  const effectiveCutoffAt =
    normalizedChanges.cutoffAt ?? cloneDate(input.baseline.cutoffAt);

  if (effectiveCutoffAt.getTime() > effectiveDrawAt.getTime()) {
    throw new DrawOverrideRuleError(
      "INVALID_INPUT",
      "Draw Override cutoff cannot be after draw time",
    );
  }

  if (
    input.baseline.state === "CLOSED" &&
    normalizedChanges.cutoffAt !== undefined &&
    normalizedChanges.cutoffAt.getTime() > input.baseline.cutoffAt.getTime()
  ) {
    throw new DrawOverrideRuleError(
      "DRAW_REOPEN_REQUIRED",
      "Extending cutoff on a CLOSED Draw requires the exceptional Draw reopen workflow",
    );
  }

  const diff = buildDiff(input.baseline, normalizedChanges);
  if (diff.length === 0) {
    throw new DrawOverrideRuleError(
      "NO_CHANGES",
      "Draw Override must change at least one allowed field",
    );
  }

  const invalidatesExistingQuotes =
    normalizedChanges.invalidateExistingQuotes === true;
  if (
    invalidatesExistingQuotes &&
    !hasHardEmergencyRestrictionDiff(normalizedChanges.betTypes ?? [], diff)
  ) {
    throw new DrawOverrideRuleError(
      "QUOTE_INVALIDATION_NOT_ALLOWED",
      "Existing Quotes may be invalidated only by a hard/emergency number restriction change",
    );
  }

  const impact: DrawOverrideImpact = Object.freeze({
    futureDecisionScope: "FUTURE_DECISIONS_ONLY",
    existingQuoteImpact: invalidatesExistingQuotes
      ? "INVALIDATE_UNCONFIRMED_QUOTES"
      : "PRESERVE_ACCEPTED_QUOTES",
    confirmedBetImpact: "UNCHANGED",
  });

  const digestPayload = {
    id: input.id,
    drawId: input.baseline.drawId,
    supersedesOverrideId: input.supersedesOverrideId,
    baselineRevisionRef: input.baseline.revisionRef,
    baselineState: input.baseline.state,
    effectiveAt: input.effectiveAt,
    reason: input.reason,
    actorId: input.actorId,
    changes: normalizedChanges,
    impact,
  };

  return Object.freeze({
    id: input.id,
    drawId: input.baseline.drawId,
    supersedesOverrideId: input.supersedesOverrideId,
    baselineRevisionRef: input.baseline.revisionRef,
    baselineState: input.baseline.state,
    effectiveAt: cloneDate(input.effectiveAt),
    reason: input.reason,
    actorId: input.actorId,
    changes: normalizedChanges,
    diff: Object.freeze(diff),
    impact,
    payloadDigest: hashPayload(digestPayload),
  });
}

export function publishDrawOverride<TPayout, TRestriction>(
  input: PublishDrawOverrideInput<TPayout, TRestriction>,
): PublishedDrawOverride<TPayout, TRestriction> {
  assertNonBlank("current Draw baseline revision ref", input.currentBaselineRevisionRef);
  assertNonBlank("approved Draw Override payload digest", input.approvedPayloadDigest);
  assertNonBlank("Draw Override approval evidence ref", input.approvalEvidenceRef);
  assertNonBlank("Draw Override audit evidence ref", input.auditEvidenceRef);
  assertValidInstant("Draw Override publishedAt", input.publishedAt);

  if (
    input.currentBaselineRevisionRef !== input.proposal.baselineRevisionRef ||
    input.currentDrawState !== input.proposal.baselineState
  ) {
    throw new DrawOverrideRuleError(
      "STALE_BASELINE",
      "Draw Override approval is stale because the governed Draw state changed materially",
    );
  }

  if (input.approvedPayloadDigest !== input.proposal.payloadDigest) {
    throw new DrawOverrideRuleError(
      "APPROVAL_PAYLOAD_MISMATCH",
      "Draw Override approval does not match the exact proposed payload",
    );
  }

  return Object.freeze({
    ...input.proposal,
    approvalEvidenceRef: input.approvalEvidenceRef,
    auditEvidenceRef: input.auditEvidenceRef,
    publishedAt: cloneDate(input.publishedAt),
  });
}

export function resolveDrawOverrideConfiguration<TPayout, TRestriction>(
  baseline: DrawOverrideBaseline<TPayout, TRestriction>,
  overrideHistory: readonly PublishedDrawOverride<TPayout, TRestriction>[],
  asOf: Date,
): ResolvedDrawOverrideConfiguration<TPayout, TRestriction> {
  assertValidInstant("Draw Override resolution asOf", asOf);

  const orderedHistory = orderOverrideHistory(baseline.drawId, overrideHistory);
  let drawAt = cloneDate(baseline.drawAt);
  let cutoffAt = cloneDate(baseline.cutoffAt);
  let resultSourceRef = baseline.resultSourceRef;
  const betTypes = new Map(
    baseline.betTypes.map((betType) => [
      betType.betTypeId,
      cloneBetTypeBaseline(betType),
    ] as const),
  );
  const appliedOverrideIds: string[] = [];

  for (const override of orderedHistory) {
    if (
      override.publishedAt.getTime() > asOf.getTime() ||
      override.effectiveAt.getTime() > asOf.getTime()
    ) {
      continue;
    }

    if (override.changes.drawAt !== undefined) {
      drawAt = cloneDate(override.changes.drawAt);
    }
    if (override.changes.cutoffAt !== undefined) {
      cutoffAt = cloneDate(override.changes.cutoffAt);
    }
    if (override.changes.resultSourceRef !== undefined) {
      resultSourceRef = override.changes.resultSourceRef;
    }

    for (const change of override.changes.betTypes ?? []) {
      const current = betTypes.get(change.betTypeId);
      if (!current) {
        throw new DrawOverrideRuleError(
          "INVALID_OVERRIDE_HISTORY",
          `Published Draw Override ${override.id} references unknown Bet Type ${change.betTypeId}`,
        );
      }
      betTypes.set(
        change.betTypeId,
        Object.freeze({
          betTypeId: current.betTypeId,
          payout:
            change.payout === undefined
              ? current.payout
              : cloneConfigurationValue(change.payout),
          minStakeMinor: change.minStakeMinor ?? current.minStakeMinor,
          maxStakeMinor: change.maxStakeMinor ?? current.maxStakeMinor,
          numberRestrictions:
            change.numberRestrictions === undefined
              ? current.numberRestrictions
              : Object.freeze(
                  change.numberRestrictions.map((restriction) =>
                    cloneConfigurationValue(restriction),
                  ),
                ),
          bettingEnabled: change.bettingEnabled ?? current.bettingEnabled,
        }),
      );
    }

    appliedOverrideIds.push(override.id);
  }

  if (cutoffAt.getTime() > drawAt.getTime()) {
    throw new DrawOverrideRuleError(
      "INVALID_OVERRIDE_HISTORY",
      "Resolved Draw Override history produces cutoff after draw time",
    );
  }

  return Object.freeze({
    drawAt,
    cutoffAt,
    resultSourceRef,
    betTypes: Object.freeze([...betTypes.values()]),
    appliedOverrideIds: Object.freeze(appliedOverrideIds),
  });
}

function orderOverrideHistory<TPayout, TRestriction>(
  drawId: string,
  history: readonly PublishedDrawOverride<TPayout, TRestriction>[],
): readonly PublishedDrawOverride<TPayout, TRestriction>[] {
  if (history.length === 0) {
    return [];
  }

  const byId = new Map<string, PublishedDrawOverride<TPayout, TRestriction>>();
  const childByParent = new Map<string, PublishedDrawOverride<TPayout, TRestriction>>();
  const roots: PublishedDrawOverride<TPayout, TRestriction>[] = [];

  for (const override of history) {
    if (override.drawId !== drawId) {
      throw new DrawOverrideRuleError(
        "INVALID_OVERRIDE_HISTORY",
        `Published Draw Override ${override.id} belongs to a different Draw`,
      );
    }
    if (byId.has(override.id)) {
      throw new DrawOverrideRuleError(
        "INVALID_OVERRIDE_HISTORY",
        `Published Draw Override history contains duplicate id ${override.id}`,
      );
    }
    byId.set(override.id, override);
  }

  for (const override of history) {
    if (override.supersedesOverrideId === null) {
      roots.push(override);
      continue;
    }
    if (!byId.has(override.supersedesOverrideId)) {
      throw new DrawOverrideRuleError(
        "INVALID_OVERRIDE_HISTORY",
        `Published Draw Override ${override.id} has missing predecessor ${override.supersedesOverrideId}`,
      );
    }
    if (childByParent.has(override.supersedesOverrideId)) {
      throw new DrawOverrideRuleError(
        "INVALID_OVERRIDE_HISTORY",
        `Published Draw Override history branches after ${override.supersedesOverrideId}`,
      );
    }
    childByParent.set(override.supersedesOverrideId, override);
  }

  if (roots.length !== 1) {
    throw new DrawOverrideRuleError(
      "INVALID_OVERRIDE_HISTORY",
      "Published Draw Override history must contain exactly one root version",
    );
  }

  const ordered: PublishedDrawOverride<TPayout, TRestriction>[] = [];
  const visited = new Set<string>();
  let current: PublishedDrawOverride<TPayout, TRestriction> | undefined = roots[0];
  while (current !== undefined) {
    if (visited.has(current.id)) {
      throw new DrawOverrideRuleError(
        "INVALID_OVERRIDE_HISTORY",
        "Published Draw Override history contains a cycle",
      );
    }
    visited.add(current.id);
    ordered.push(current);
    current = childByParent.get(current.id);
  }

  if (ordered.length !== history.length) {
    throw new DrawOverrideRuleError(
      "INVALID_OVERRIDE_HISTORY",
      "Published Draw Override history is disconnected",
    );
  }

  return ordered;
}

function cloneBetTypeBaseline<TPayout, TRestriction>(
  value: DrawBetTypeOverrideBaseline<TPayout, TRestriction>,
): DrawBetTypeOverrideBaseline<TPayout, TRestriction> {
  return Object.freeze({
    betTypeId: value.betTypeId,
    payout: cloneConfigurationValue(value.payout),
    minStakeMinor: value.minStakeMinor,
    maxStakeMinor: value.maxStakeMinor,
    numberRestrictions: Object.freeze(
      value.numberRestrictions.map((restriction) =>
        cloneConfigurationValue(restriction),
      ),
    ),
    bettingEnabled: value.bettingEnabled,
  });
}

function normalizeChanges<TPayout, TRestriction>(
  baseline: DrawOverrideBaseline<TPayout, TRestriction>,
  changes: DrawOverrideChanges<TPayout, TRestriction>,
): DrawOverrideChanges<TPayout, TRestriction> {
  const betTypesById = new Map(
    baseline.betTypes.map((betType) => [betType.betTypeId, betType] as const),
  );
  if (betTypesById.size !== baseline.betTypes.length) {
    throw new DrawOverrideRuleError(
      "INVALID_INPUT",
      "Draw Override baseline contains duplicate Bet Type identities",
    );
  }
  const seenBetTypeIds = new Set<string>();

  const betTypes = changes.betTypes?.map((change) => {
    assertAllowedKeys("Draw Bet Type Override change", change, BET_TYPE_CHANGE_KEYS);
    assertNonBlank("Draw Override Bet Type id", change.betTypeId);

    if (seenBetTypeIds.has(change.betTypeId)) {
      throw new DrawOverrideRuleError(
        "INVALID_INPUT",
        `Draw Override cannot change Bet Type ${change.betTypeId} more than once`,
      );
    }
    seenBetTypeIds.add(change.betTypeId);

    const current = betTypesById.get(change.betTypeId);
    if (!current) {
      throw new DrawOverrideRuleError(
        "UNKNOWN_BET_TYPE",
        `Draw Override Bet Type ${change.betTypeId} is not part of the Draw baseline`,
      );
    }

    if (
      change.numberRestrictions !== undefined &&
      change.restrictionSeverity === undefined
    ) {
      throw new DrawOverrideRuleError(
        "INVALID_INPUT",
        `Draw Override number restrictions for ${change.betTypeId} require an explicit restriction severity`,
      );
    }
    if (
      change.numberRestrictions === undefined &&
      change.restrictionSeverity !== undefined
    ) {
      throw new DrawOverrideRuleError(
        "INVALID_INPUT",
        `Draw Override restriction severity for ${change.betTypeId} requires a number restriction change`,
      );
    }
    if (
      change.restrictionSeverity !== undefined &&
      !DRAW_OVERRIDE_RESTRICTION_SEVERITIES.includes(change.restrictionSeverity)
    ) {
      throw new DrawOverrideRuleError(
        "INVALID_INPUT",
        `Draw Override restriction severity for ${change.betTypeId} is invalid`,
      );
    }
    if (
      change.bettingEnabled !== undefined &&
      typeof change.bettingEnabled !== "boolean"
    ) {
      throw new DrawOverrideRuleError(
        "INVALID_INPUT",
        `Draw Override bettingEnabled for ${change.betTypeId} must be boolean`,
      );
    }

    const effectiveMin = change.minStakeMinor ?? current.minStakeMinor;
    const effectiveMax = change.maxStakeMinor ?? current.maxStakeMinor;
    if (effectiveMin > effectiveMax) {
      throw new DrawOverrideRuleError(
        "INVALID_STAKE_LIMIT",
        `Draw Override minimum stake cannot exceed maximum stake for Bet Type ${change.betTypeId}`,
      );
    }

    return Object.freeze({
      betTypeId: change.betTypeId,
      ...(change.payout === undefined
        ? {}
        : { payout: cloneConfigurationValue(change.payout) }),
      ...(change.minStakeMinor === undefined
        ? {}
        : { minStakeMinor: change.minStakeMinor }),
      ...(change.maxStakeMinor === undefined
        ? {}
        : { maxStakeMinor: change.maxStakeMinor }),
      ...(change.numberRestrictions === undefined
        ? {}
        : {
            numberRestrictions: Object.freeze(
              change.numberRestrictions.map((restriction) =>
                cloneConfigurationValue(restriction),
              ),
            ),
            restrictionSeverity: change.restrictionSeverity,
          }),
      ...(change.bettingEnabled === undefined
        ? {}
        : { bettingEnabled: change.bettingEnabled }),
    });
  });

  if (changes.drawAt !== undefined) {
    assertValidInstant("Draw Override drawAt", changes.drawAt);
  }
  if (changes.cutoffAt !== undefined) {
    assertValidInstant("Draw Override cutoffAt", changes.cutoffAt);
  }
  if (changes.resultSourceRef !== undefined) {
    assertNonBlank("Draw Override result source ref", changes.resultSourceRef);
  }
  if (
    changes.invalidateExistingQuotes !== undefined &&
    typeof changes.invalidateExistingQuotes !== "boolean"
  ) {
    throw new DrawOverrideRuleError(
      "INVALID_INPUT",
      "Draw Override invalidateExistingQuotes must be boolean",
    );
  }

  return Object.freeze({
    ...(changes.drawAt === undefined ? {} : { drawAt: cloneDate(changes.drawAt) }),
    ...(changes.cutoffAt === undefined
      ? {}
      : { cutoffAt: cloneDate(changes.cutoffAt) }),
    ...(changes.resultSourceRef === undefined
      ? {}
      : { resultSourceRef: changes.resultSourceRef }),
    ...(betTypes === undefined ? {} : { betTypes: Object.freeze(betTypes) }),
    ...(changes.invalidateExistingQuotes === undefined
      ? {}
      : { invalidateExistingQuotes: changes.invalidateExistingQuotes }),
  });
}

function buildDiff<TPayout, TRestriction>(
  baseline: DrawOverrideBaseline<TPayout, TRestriction>,
  changes: DrawOverrideChanges<TPayout, TRestriction>,
): DrawOverrideDiffEntry[] {
  const diff: DrawOverrideDiffEntry[] = [];

  addDiff(diff, "DRAW_AT", baseline.drawAt, changes.drawAt);
  addDiff(diff, "CUTOFF_AT", baseline.cutoffAt, changes.cutoffAt);
  addDiff(diff, "RESULT_SOURCE", baseline.resultSourceRef, changes.resultSourceRef);

  const betTypesById = new Map(
    baseline.betTypes.map((betType) => [betType.betTypeId, betType] as const),
  );

  for (const change of changes.betTypes ?? []) {
    const current = betTypesById.get(change.betTypeId);
    if (!current) {
      continue;
    }
    addDiff(diff, "BET_TYPE_PAYOUT", current.payout, change.payout, change.betTypeId);
    addDiff(
      diff,
      "BET_TYPE_MIN_STAKE",
      current.minStakeMinor,
      change.minStakeMinor,
      change.betTypeId,
    );
    addDiff(
      diff,
      "BET_TYPE_MAX_STAKE",
      current.maxStakeMinor,
      change.maxStakeMinor,
      change.betTypeId,
    );
    addDiff(
      diff,
      "BET_TYPE_NUMBER_RESTRICTIONS",
      current.numberRestrictions,
      change.numberRestrictions,
      change.betTypeId,
    );
    addDiff(
      diff,
      "BET_TYPE_BETTING_ENABLED",
      current.bettingEnabled,
      change.bettingEnabled,
      change.betTypeId,
    );
  }

  return diff;
}

function addDiff(
  diff: DrawOverrideDiffEntry[],
  field: DrawOverrideDiffField,
  before: unknown,
  after: unknown,
  betTypeId?: string,
): void {
  if (after === undefined || valuesEqual(before, after)) {
    return;
  }

  diff.push(
    Object.freeze({
      field,
      ...(betTypeId === undefined ? {} : { betTypeId }),
      before: cloneConfigurationValue(before),
      after: cloneConfigurationValue(after),
    }),
  );
}

function hasHardEmergencyRestrictionDiff<TPayout, TRestriction>(
  changes: readonly DrawBetTypeOverrideChange<TPayout, TRestriction>[],
  diff: readonly DrawOverrideDiffEntry[],
): boolean {
  return changes.some(
    (change) =>
      change.numberRestrictions !== undefined &&
      change.restrictionSeverity === "HARD_EMERGENCY" &&
      diff.some(
        (entry) =>
          entry.field === "BET_TYPE_NUMBER_RESTRICTIONS" &&
          entry.betTypeId === change.betTypeId,
      ),
  );
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return canonicalize(left) === canonicalize(right);
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalize(payload)).digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === undefined) {
    return '{"$undefined":true}';
  }
  if (value instanceof Date) {
    return `{"$date":${JSON.stringify(value.toISOString())}}`;
  }
  if (typeof value === "bigint") {
    return `{"$bigint":${JSON.stringify(value.toString())}}`;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertAllowedKeys(
  label: string,
  value: object,
  allowed: ReadonlySet<string>,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new DrawOverrideRuleError(
        "INVALID_INPUT",
        `${label} contains unsupported field ${key}`,
      );
    }
  }
}

function assertNonBlank(label: string, value: string): void {
  if (value.trim().length === 0) {
    throw new DrawOverrideRuleError("INVALID_INPUT", `${label} must not be blank`);
  }
}

function assertValidInstant(label: string, value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new DrawOverrideRuleError(
      "INVALID_INPUT",
      `${label} must be a valid instant`,
    );
  }
}

function cloneDate(value: Date): Date {
  return new Date(value.getTime());
}
