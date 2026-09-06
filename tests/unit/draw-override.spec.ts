import { describe, expect, it } from "vitest";

import {
  createDrawOverrideProposal,
  DrawOverrideRuleError,
  publishDrawOverride,
  resolveDrawOverrideConfiguration,
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
  readonly maxAmountMinor?: bigint;
}

function baseline(
  overrides: Partial<DrawOverrideBaseline<PayoutTerms, Restriction>> = {},
): DrawOverrideBaseline<PayoutTerms, Restriction> {
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
    ...overrides,
  };
}

function proposal(
  overrides: Partial<Parameters<typeof createDrawOverrideProposal<PayoutTerms, Restriction>>[0]> = {},
) {
  return createDrawOverrideProposal<PayoutTerms, Restriction>({
    id: "draw-override:v1",
    supersedesOverrideId: null,
    baseline: baseline(),
    effectiveAt: new Date("2026-09-16T08:00:00.000Z"),
    reason: "Adjust payout for this Draw",
    actorId: "admin:maker-1",
    changes: {
      betTypes: [
        {
          betTypeId: "bet-type:3top",
          payout: { multiplier: 450, currency: "THB" },
        },
      ],
    },
    ...overrides,
  });
}

function publish(
  created = proposal(),
  publishedAt = new Date("2026-09-16T08:10:00.000Z"),
): PublishedDrawOverride<PayoutTerms, Restriction> {
  return publishDrawOverride({
    proposal: created,
    currentBaselineRevisionRef: created.baselineRevisionRef,
    currentDrawState: created.baselineState,
    approvedPayloadDigest: created.payloadDigest,
    approvalEvidenceRef: `approval-evidence:${created.id}`,
    auditEvidenceRef: `audit-record:${created.id}`,
    publishedAt,
  });
}

describe("Draw Override", () => {
  it("creates an immutable versioned proposal with an exact allowed-field diff", () => {
    const mutablePayout = { multiplier: 450, currency: "THB" as const };
    const created = proposal({
      id: "draw-override:v2",
      supersedesOverrideId: "draw-override:v1",
      changes: {
        drawAt: new Date("2026-09-16T09:15:00.000Z"),
        cutoffAt: new Date("2026-09-16T08:50:00.000Z"),
        resultSourceRef: "result-source:government:v2",
        betTypes: [
          {
            betTypeId: "bet-type:3top",
            payout: mutablePayout,
            minStakeMinor: 200n,
            maxStakeMinor: 8_000n,
            bettingEnabled: false,
            numberRestrictions: [{ kind: "BLOCKED", number: "123" }],
            restrictionSeverity: "NORMAL",
          },
        ],
      },
    });

    mutablePayout.multiplier = 999;

    expect(created.supersedesOverrideId).toBe("draw-override:v1");
    expect(created.changes.betTypes?.[0]?.payout).toEqual({
      multiplier: 450,
      currency: "THB",
    });
    expect(created.diff.map((entry) => entry.field)).toEqual([
      "DRAW_AT",
      "CUTOFF_AT",
      "RESULT_SOURCE",
      "BET_TYPE_PAYOUT",
      "BET_TYPE_MIN_STAKE",
      "BET_TYPE_MAX_STAKE",
      "BET_TYPE_NUMBER_RESTRICTIONS",
      "BET_TYPE_BETTING_ENABLED",
    ]);
    expect(created.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.changes)).toBe(true);
    expect(Object.isFrozen(created.diff)).toBe(true);
  });

  it("rejects unsupported runtime fields instead of silently mutating the Draw", () => {
    expect(() =>
      proposal({
        changes: {
          payoutPolicyRef: "unsupported",
        } as never,
      }),
    ).toThrow("unsupported field payoutPolicyRef");
  });

  it("rejects a no-op proposal", () => {
    expect(() =>
      proposal({
        changes: {
          resultSourceRef: "result-source:government:v1",
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "NO_CHANGES" }));
  });

  it("rejects Bet Type changes outside the Draw baseline", () => {
    expect(() =>
      proposal({
        changes: {
          betTypes: [
            {
              betTypeId: "bet-type:unknown",
              payout: { multiplier: 1, currency: "THB" },
            },
          ],
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "UNKNOWN_BET_TYPE" }));
  });

  it("validates the effective per-Line min/max stake after applying the override", () => {
    expect(() =>
      proposal({
        changes: {
          betTypes: [
            {
              betTypeId: "bet-type:3top",
              minStakeMinor: 20_000n,
            },
          ],
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_STAKE_LIMIT" }));
  });

  it("preserves accepted Quotes and confirmed Bets for an ordinary OPEN Draw override", () => {
    const created = proposal();

    expect(created.impact).toEqual({
      futureDecisionScope: "FUTURE_DECISIONS_ONLY",
      existingQuoteImpact: "PRESERVE_ACCEPTED_QUOTES",
      confirmedBetImpact: "UNCHANGED",
    });
  });

  it("allows immediate unconfirmed-Quote invalidation only for a hard/emergency restriction", () => {
    const created = proposal({
      changes: {
        betTypes: [
          {
            betTypeId: "bet-type:3top",
            numberRestrictions: [{ kind: "BLOCKED", number: "123" }],
            restrictionSeverity: "HARD_EMERGENCY",
          },
        ],
        invalidateExistingQuotes: true,
      },
    });

    expect(created.impact.existingQuoteImpact).toBe(
      "INVALIDATE_UNCONFIRMED_QUOTES",
    );

    expect(() =>
      proposal({
        changes: {
          betTypes: [
            {
              betTypeId: "bet-type:3top",
              numberRestrictions: [
                { kind: "MAX_AMOUNT", number: "123", maxAmountMinor: 500n },
              ],
              restrictionSeverity: "NORMAL",
            },
          ],
          invalidateExistingQuotes: true,
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "QUOTE_INVALIDATION_NOT_ALLOWED" }),
    );

    expect(() =>
      proposal({
        baseline: baseline({
          betTypes: [
            {
              betTypeId: "bet-type:3top",
              payout: { multiplier: 500, currency: "THB" },
              minStakeMinor: 100n,
              maxStakeMinor: 10_000n,
              numberRestrictions: [{ kind: "BLOCKED", number: "123" }],
              bettingEnabled: true,
            },
          ],
        }),
        changes: {
          resultSourceRef: "result-source:government:v2",
          betTypes: [
            {
              betTypeId: "bet-type:3top",
              numberRestrictions: [{ kind: "BLOCKED", number: "123" }],
              restrictionSeverity: "HARD_EMERGENCY",
            },
          ],
          invalidateExistingQuotes: true,
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "QUOTE_INVALIDATION_NOT_ALLOWED" }),
    );
  });

  it("requires the exceptional reopen workflow before extending cutoff on a CLOSED Draw", () => {
    expect(() =>
      proposal({
        baseline: baseline({ state: "CLOSED" }),
        changes: {
          cutoffAt: new Date("2026-09-16T08:55:00.000Z"),
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "DRAW_REOPEN_REQUIRED" }));
  });

  it("rejects overrides against terminal Draw history", () => {
    for (const state of ["SETTLED", "CANCELLED"] as const) {
      expect(() =>
        proposal({ baseline: baseline({ state }) }),
      ).toThrowError(expect.objectContaining({ code: "TERMINAL_DRAW" }));
    }
  });

  it("publishes only when approval matches the exact payload and current Draw baseline", () => {
    const created = proposal();
    const publishedAt = new Date("2026-09-16T08:10:00.000Z");
    const published = publishDrawOverride({
      proposal: created,
      currentBaselineRevisionRef: "draw-revision:7",
      currentDrawState: "OPEN",
      approvedPayloadDigest: created.payloadDigest,
      approvalEvidenceRef: "approval-evidence:42",
      auditEvidenceRef: "audit-record:99",
      publishedAt,
    });

    publishedAt.setUTCFullYear(2030);

    expect(published.approvalEvidenceRef).toBe("approval-evidence:42");
    expect(published.auditEvidenceRef).toBe("audit-record:99");
    expect(published.publishedAt.toISOString()).toBe("2026-09-16T08:10:00.000Z");
    expect(Object.isFrozen(published)).toBe(true);

    expect(() =>
      publishDrawOverride({
        proposal: created,
        currentBaselineRevisionRef: "draw-revision:8",
        currentDrawState: "OPEN",
        approvedPayloadDigest: created.payloadDigest,
        approvalEvidenceRef: "approval-evidence:42",
        auditEvidenceRef: "audit-record:99",
        publishedAt: new Date("2026-09-16T08:10:00.000Z"),
      }),
    ).toThrowError(expect.objectContaining({ code: "STALE_BASELINE" }));

    expect(() =>
      publishDrawOverride({
        proposal: created,
        currentBaselineRevisionRef: "draw-revision:7",
        currentDrawState: "OPEN",
        approvedPayloadDigest: "wrong-digest",
        approvalEvidenceRef: "approval-evidence:42",
        auditEvidenceRef: "audit-record:99",
        publishedAt: new Date("2026-09-16T08:10:00.000Z"),
      }),
    ).toThrowError(
      expect.objectContaining({ code: "APPROVAL_PAYLOAD_MISMATCH" }),
    );
  });

  it("replays a complete version chain deterministically without rewriting the Draw snapshot", () => {
    const original = baseline();
    const payoutOverride = publish(
      proposal({
        id: "draw-override:v1",
        supersedesOverrideId: null,
        changes: {
          betTypes: [
            {
              betTypeId: "bet-type:3top",
              payout: { multiplier: 450, currency: "THB" },
            },
          ],
        },
      }),
      new Date("2026-09-16T08:05:00.000Z"),
    );
    const futureRestrictionOverride = publish(
      proposal({
        id: "draw-override:v2",
        supersedesOverrideId: "draw-override:v1",
        effectiveAt: new Date("2026-09-16T08:30:00.000Z"),
        changes: {
          betTypes: [
            {
              betTypeId: "bet-type:3top",
              numberRestrictions: [{ kind: "BLOCKED", number: "123" }],
              restrictionSeverity: "NORMAL",
              bettingEnabled: false,
            },
          ],
        },
      }),
      new Date("2026-09-16T08:15:00.000Z"),
    );

    const beforeFutureEffective = resolveDrawOverrideConfiguration(
      original,
      [futureRestrictionOverride, payoutOverride],
      new Date("2026-09-16T08:20:00.000Z"),
    );
    const afterFutureEffective = resolveDrawOverrideConfiguration(
      original,
      [futureRestrictionOverride, payoutOverride],
      new Date("2026-09-16T08:35:00.000Z"),
    );

    expect(beforeFutureEffective.appliedOverrideIds).toEqual(["draw-override:v1"]);
    expect(beforeFutureEffective.betTypes[0]).toMatchObject({
      payout: { multiplier: 450, currency: "THB" },
      bettingEnabled: true,
      numberRestrictions: [],
    });
    expect(afterFutureEffective.appliedOverrideIds).toEqual([
      "draw-override:v1",
      "draw-override:v2",
    ]);
    expect(afterFutureEffective.betTypes[0]).toMatchObject({
      payout: { multiplier: 450, currency: "THB" },
      bettingEnabled: false,
      numberRestrictions: [{ kind: "BLOCKED", number: "123" }],
    });
    expect(original.betTypes[0]).toMatchObject({
      payout: { multiplier: 500, currency: "THB" },
      bettingEnabled: true,
      numberRestrictions: [],
    });
  });

  it("rejects branched or incomplete override history instead of guessing precedence", () => {
    const root = publish(proposal({ id: "draw-override:v1" }));
    const childA = publish(
      proposal({
        id: "draw-override:v2a",
        supersedesOverrideId: root.id,
        changes: { resultSourceRef: "result-source:a" },
      }),
    );
    const childB = publish(
      proposal({
        id: "draw-override:v2b",
        supersedesOverrideId: root.id,
        changes: { resultSourceRef: "result-source:b" },
      }),
    );

    expect(() =>
      resolveDrawOverrideConfiguration(
        baseline(),
        [root, childA, childB],
        new Date("2026-09-16T08:40:00.000Z"),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_OVERRIDE_HISTORY" }),
    );

    expect(() =>
      resolveDrawOverrideConfiguration(
        baseline(),
        [childA],
        new Date("2026-09-16T08:40:00.000Z"),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_OVERRIDE_HISTORY" }),
    );
  });

  it("binds approval to material Draw state as well as revision identity", () => {
    const created = proposal({ baseline: baseline({ state: "SCHEDULED" }) });

    expect(() =>
      publishDrawOverride({
        proposal: created,
        currentBaselineRevisionRef: "draw-revision:7",
        currentDrawState: "OPEN",
        approvedPayloadDigest: created.payloadDigest,
        approvalEvidenceRef: "approval-evidence:42",
        auditEvidenceRef: "audit-record:99",
        publishedAt: new Date("2026-09-16T08:10:00.000Z"),
      }),
    ).toThrowError(expect.objectContaining({ code: "STALE_BASELINE" }));
  });

  it("requires explicit restriction severity when Draw restrictions change", () => {
    expect(() =>
      proposal({
        changes: {
          betTypes: [
            {
              betTypeId: "bet-type:3top",
              numberRestrictions: [{ kind: "BLOCKED", number: "123" }],
            },
          ],
        },
      }),
    ).toThrow(DrawOverrideRuleError);
  });
});
