// Persisted Draw Override change sets (Issue 45 regression evidence).
//
// Overrides are stored as JSON, so instants (`drawAt`, `cutoffAt`) are read back
// as strings. Before this was handled, resolving a persisted Override that moved
// the cutoff threw `value.getTime is not a function`, which silently broke every
// downstream reader of the effective Draw configuration — including the Betting
// Quote resolver and the Bet Order cutoff revalidation at Confirm.

import { describe, expect, it } from "vitest";

import {
  createDrawOverrideProposal,
  publishDrawOverride,
  resolveDrawOverrideConfiguration,
  revivePersistedDrawOverrideChanges,
  type DrawOverrideBaseline,
  type PublishedDrawOverride,
} from "../../src/contexts/lottery/domain/draw-override";

interface PayoutTerms {
  readonly multiplier: number;
  readonly currency: "THB";
}

interface Restriction {
  readonly kind: "BLOCKED" | "MAX_AMOUNT";
  readonly number: string;
}

function baseline(): DrawOverrideBaseline<PayoutTerms, Restriction> {
  return {
    drawId: "draw:thai:2026-09-16",
    revisionRef: "draw-revision:7",
    state: "OPEN",
    drawAt: new Date("2026-09-16T09:00:00.000Z"),
    cutoffAt: new Date("2026-09-16T08:45:00.000Z"),
    resultSourceRef: "result-source:government:v1",
    betTypes: [
      {
        betTypeId: "bet-type:3top",
        payout: { multiplier: 500, currency: "THB" },
        minStakeMinor: 100n,
        maxStakeMinor: 10_000n,
        numberRestrictions: [],
        bettingEnabled: true,
      },
    ],
  };
}

/**
 * Round-trips a published Override exactly as the database does: the JSON
 * columns (`changes`, `diff`, `impact`) come back JSON-parsed, while the
 * `timestamp` columns stay real instants.
 */
function asPersisted(
  override: PublishedDrawOverride<PayoutTerms, Restriction>,
): PublishedDrawOverride<PayoutTerms, Restriction> {
  return {
    ...override,
    changes: JSON.parse(JSON.stringify(override.changes)) as PublishedDrawOverride<
      PayoutTerms,
      Restriction
    >["changes"],
    diff: JSON.parse(JSON.stringify(override.diff)) as PublishedDrawOverride<
      PayoutTerms,
      Restriction
    >["diff"],
    impact: JSON.parse(JSON.stringify(override.impact)) as PublishedDrawOverride<
      PayoutTerms,
      Restriction
    >["impact"],
  };
}

describe("persisted Draw Override change sets", () => {
  it("revives drawAt/cutoffAt instants and leaves the rest of the change set intact", () => {
    const revived = revivePersistedDrawOverrideChanges<PayoutTerms, Restriction>({
      cutoffAt: "2026-09-16T08:30:00.000Z",
      drawAt: "2026-09-16T08:50:00.000Z",
      resultSourceRef: "result-source:government:v2",
      betTypes: [{ betTypeId: "bet-type:3top", payout: { multiplier: 450 } }],
    });

    expect(revived.cutoffAt).toBeInstanceOf(Date);
    expect(revived.cutoffAt?.toISOString()).toBe("2026-09-16T08:30:00.000Z");
    expect(revived.drawAt?.toISOString()).toBe("2026-09-16T08:50:00.000Z");
    expect(revived.resultSourceRef).toBe("result-source:government:v2");
    expect(revived.betTypes).toHaveLength(1);
    expect(revivePersistedDrawOverrideChanges(undefined)).toEqual({});
    expect(revivePersistedDrawOverrideChanges(null)).toEqual({});
  });

  it("rejects a persisted instant that is not a valid instant instead of guessing", () => {
    expect(() =>
      revivePersistedDrawOverrideChanges({ cutoffAt: "not-an-instant" }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
  });

  it("resolves an effective cutoff from a JSON round-tripped Override (previously threw)", () => {
    const proposal = createDrawOverrideProposal<PayoutTerms, Restriction>({
      id: "draw-override:v1",
      supersedesOverrideId: null,
      baseline: baseline(),
      effectiveAt: new Date("2026-09-16T08:00:00.000Z"),
      reason: "Move the cutoff earlier for this Draw",
      actorId: "admin:maker-1",
      changes: { cutoffAt: new Date("2026-09-16T08:30:00.000Z") },
    });
    const persisted = asPersisted(
      publishDrawOverride<PayoutTerms, Restriction>({
        proposal,
        currentBaselineRevisionRef: proposal.baselineRevisionRef,
        currentDrawState: proposal.baselineState,
        approvedPayloadDigest: proposal.payloadDigest,
        approvalEvidenceRef: "approval-evidence:v1",
        auditEvidenceRef: "audit-record:v1",
        publishedAt: new Date("2026-09-16T08:05:00.000Z"),
      }),
    );

    // The raw persisted value is a string, which is what broke resolution.
    expect(typeof (persisted.changes as { cutoffAt: unknown }).cutoffAt).toBe("string");

    const revived = {
      ...persisted,
      changes: revivePersistedDrawOverrideChanges<PayoutTerms, Restriction>(
        persisted.changes,
      ),
    };
    const resolved = resolveDrawOverrideConfiguration(
      baseline(),
      [revived],
      new Date("2026-09-16T08:35:00.000Z"),
    );

    expect(resolved.appliedOverrideIds).toEqual(["draw-override:v1"]);
    expect(resolved.cutoffAt.toISOString()).toBe("2026-09-16T08:30:00.000Z");
    // The Draw time is untouched, and resolution is authoritative on the cutoff.
    expect(resolved.drawAt.toISOString()).toBe("2026-09-16T09:00:00.000Z");
  });
});
