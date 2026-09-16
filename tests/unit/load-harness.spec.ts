// Guard rails for the load harness itself.
//
// These specs exist so a weakened target, a lost scenario identity or a broken
// verdict rule fails CI instead of quietly producing a green capacity claim.
// They also pin the statistics the drivers rely on.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// The harness is plain ESM (`.mjs`) on purpose: it must run from a bare `node`
// with the repository checked out. These specs import it directly.
// @ts-expect-error -- JavaScript library without type declarations
import { LatencyRecorder, ThroughputRecorder, evaluateMax, evaluateMin, verdict } from "../../tools/load-harness/lib/stats.mjs";
// @ts-expect-error -- JavaScript library without type declarations
import { loadScenario, resolveProfile, TICKET13_FLOOR } from "../../tools/load-harness/lib/scenario.mjs";

const repoRoot = path.resolve(__dirname, "..", "..");
const scenario = loadScenario() as {
  targets: Record<string, Record<string, number>>;
  requiredObservability: { families: Array<{ id: string }> };
  profiles: Record<string, { claimsTarget: boolean }>;
};
const floor = TICKET13_FLOOR as Record<string, Record<string, number>>;

describe("load harness scenario (Ticket 13 / GH #91)", () => {
  it("carries every Ticket 13 target at or above the transcribed floor", () => {
    for (const [name, expected] of Object.entries(floor)) {
      const target = scenario.targets[name];
      expect(target, `target ${name} is missing from the scenario`).toBeDefined();
      if (!target) continue;
      for (const [key, value] of Object.entries(expected)) {
        if (key.startsWith("min")) expect(target[key]).toBeGreaterThanOrEqual(value);
        else expect(target[key]).toBeLessThanOrEqual(value);
      }
    }
  });

  it("keeps the target-profile volumes at the acceptance scale", () => {
    const target = resolveProfile(scenario, "target");
    expect(target.claimsTarget).toBe(true);
    expect(target.sessions.target).toBeGreaterThanOrEqual(5000);
    expect(target.quoteConfirm.quoteRps).toBeGreaterThanOrEqual(300);
    expect(target.quoteConfirm.confirmRps).toBeGreaterThanOrEqual(150);
    expect(target.paymentEvents.targetRps).toBeGreaterThanOrEqual(200);
    expect(target.settlement.betLines).toBeGreaterThanOrEqual(100000);
    expect(target.settlement.budgetSeconds).toBeLessThanOrEqual(600);
  });

  it("never lets a non-target profile claim PASS", () => {
    for (const name of ["smoke", "sandbox"]) {
      expect(resolveProfile(scenario, name).claimsTarget).toBe(false);
    }
  });

  it("rejects a scenario that lowers a target", () => {
    const weakened = JSON.parse(JSON.stringify(scenario));
    weakened.targets.quote_requests_per_second.min = 50;
    // Written to a temp dir: a spec must not drop files into the checkout.
    const tempDir = mkdtempSync(path.join(tmpdir(), "load-scenario-"));
    const tempPath = path.join(tempDir, "weakened-scenario.json");
    mkdirSync(path.dirname(tempPath), { recursive: true });
    writeFileSync(tempPath, JSON.stringify(weakened));
    try {
      expect(() => loadScenario(tempPath)).toThrow(/weaker than the Ticket 13 value/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("declares the required observability families for the unobservable SLOs", () => {
    const ids = scenario.requiredObservability.families.map((family: { id: string }) => family.id);
    expect(ids).toEqual(expect.arrayContaining(["queueLag", "settlementThroughput", "dlqDepth"]));
  });
});

describe("load harness statistics and verdicts", () => {
  it("computes percentiles and histograms deterministically", () => {
    const recorder = new LatencyRecorder();
    for (const value of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) recorder.record(value);
    expect(recorder.count).toBe(10);
    expect(recorder.percentile(50)).toBeCloseTo(5.5, 5);
    expect(recorder.percentile(95)).toBeCloseTo(9.55, 5);
    const histogram = recorder.histogram([5, 10]);
    expect(histogram[0].count).toBe(5);
    expect(histogram[1].count).toBe(5);
  });

  it("ignores non-finite samples instead of poisoning a percentile", () => {
    const recorder = new LatencyRecorder();
    recorder.record(10);
    recorder.record(Number.NaN);
    recorder.record(-1);
    expect(recorder.count).toBe(1);
    expect(recorder.invalidCount).toBe(2);
    expect(recorder.percentile(95)).toBe(10);
  });

  it("computes achieved rate and error rate from completed work only", () => {
    const throughput = new ThroughputRecorder();
    throughput.start(0);
    throughput.recordOutcome(true);
    throughput.recordOutcome(true);
    throughput.recordOutcome(false);
    throughput.recordStatus(200);
    throughput.recordStatus(500);
    const snapshot = throughput.snapshot(2000);
    expect(snapshot.completed).toBe(2);
    expect(snapshot.failed).toBe(1);
    expect(snapshot.achievedRps).toBeCloseTo(1, 5);
    expect(snapshot.errorRate).toBeCloseTo(1 / 3, 5);
  });

  it("can only report PASS/FAIL for a profile that claims the targets", () => {
    expect(verdict({ measured: true, pass: true, claimsTarget: true })).toBe("PASS");
    expect(verdict({ measured: true, pass: false, claimsTarget: true })).toBe("FAIL");
    expect(verdict({ measured: true, pass: true, claimsTarget: false })).toBe("MEASURED");
    expect(verdict({ measured: false, pass: true, claimsTarget: true })).toBe("NOT_MEASURED");
    expect(verdict({ measured: true, pass: true, claimsTarget: true, envGated: true })).toBe("ENV_GATED");
  });

  it("evaluates min/max targets with the correct direction", () => {
    expect(evaluateMax(250, 300, { claimsTarget: true }).verdict).toBe("PASS");
    expect(evaluateMax(350, 300, { claimsTarget: true }).verdict).toBe("FAIL");
    expect(evaluateMin(320, 300, { claimsTarget: true }).verdict).toBe("PASS");
    expect(evaluateMin(120, 300, { claimsTarget: true }).verdict).toBe("FAIL");
    expect(evaluateMin(120, 300, { claimsTarget: false }).verdict).toBe("MEASURED");
  });
});

describe("load harness environment assessment", () => {
  it("declares a production-like requirement set and fails this sandbox", async () => {
    // Loaded dynamically so the spec itself stays plain TypeScript.
    const environmentModule = "../../tools/load-harness/lib/environment.mjs";
    const { assessProductionLikeness, PRODUCTION_LIKE_REQUIREMENTS } = await import(environmentModule);
    const assessment = assessProductionLikeness({
      cpu: { effectiveCores: 2 },
      memory: { effectiveBytes: 3.7 * 1024 ** 3 },
      client: { coLocated: true },
      database: { database: "lottify_dev" },
    });
    expect(PRODUCTION_LIKE_REQUIREMENTS.minEffectiveCpuCores).toBeGreaterThanOrEqual(8);
    expect(assessment.productionLike).toBe(false);
    expect(assessment.failures.join(" ")).toMatch(/cpu/);
    expect(assessment.failures.join(" ")).toMatch(/co-located/);
    expect(assessment.failures.join(" ")).toMatch(/development database/);
  });
});

describe("load harness report binding", () => {
  // Regression guard for the defect found in review round 1: the markdown half
  // of a report named the harness revision as the candidate because
  // writeReport() did not forward candidateSha/harnessRevisionSha.
  it("binds both halves of a report to the candidate SHA, not the harness revision", async () => {
    const reportModule = "../../tools/load-harness/lib/report.mjs";
    const { writeReport } = await import(reportModule);
    const candidateSha = "0d3b6cb1ce905387dd6822a29121bba70bddcf4a";
    const harnessSha = "8ddf0326fb32b0eaab37fe510a0ba53859a152de";
    const outDir = mkdtempSync(path.join(tmpdir(), "load-report-"));
    try {
      const { jsonPath, mdPath } = writeReport({
        outDir,
        scenario: { id: "ticket13.capacity", version: 1, sourceOfTruth: "GH #91", card: "ticket13", mix: {}, burst: {} },
        profile: { name: "smoke", claimsTarget: false, purpose: "plumbing" },
        fingerprint: { candidate: { sha: harnessSha, branch: "feat/load-harness-ticket13", worktreeDirty: false } },
        likeness: { productionLike: false, failures: ["cpu"] },
        runs: [],
        signals: [],
        inventory: {},
        assertions: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
        commands: [],
        candidateSha,
        harnessRevisionSha: harnessSha,
      });
      const markdown = readFileSync(mdPath, "utf8");
      const json = JSON.parse(readFileSync(jsonPath, "utf8"));
      expect(markdown).toContain(`Candidate under test: \`${candidateSha}\``);
      expect(markdown).toContain(`Harness revision that produced this report: \`${harnessSha}\``);
      expect(markdown).not.toContain(`Candidate under test: \`${harnessSha}\``);
      expect(path.basename(mdPath)).toContain(candidateSha.slice(0, 12));
      expect(json.candidate.sha).toBe(candidateSha);
      expect(json.candidate.harnessRevisionSha).toBe(harnessSha);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  // Regression guard for review round 2 finding B1: the CI binding check used to
  // accept a report whose once-only assertion examined zero Orders, so the
  // "no duplicate financial effect under load" claim could rest on nothing.
  it("rejects once-only evidence that examined an empty population", async () => {
    const reportModule = "../../tools/load-harness/lib/report.mjs";
    const { onceOnlyEvidenceFailures } = await import(reportModule);
    const measured = (examinedPopulation: number, duplicateEffectsFound: number) => ({
      id: "settlement-capacity",
      measurements: {
        duplicate_financial_effect_under_load: {
          target: { allowed: false },
          achieved: true,
          duplicateEffectsFound,
          examinedPopulation,
          verdict: "MEASURED",
        },
      },
    });

    // The reviewed defect: 0 examined rows, "no duplicates" reported anyway.
    expect(onceOnlyEvidenceFailures([measured(0, 0)]).join(" ")).toMatch(/empty population is not evidence/);
    // A real population with no duplicate is the pass case.
    expect(onceOnlyEvidenceFailures([measured(120, 0)])).toEqual([]);
    // A duplicate effect must fail regardless of population size.
    expect(onceOnlyEvidenceFailures([measured(120, 1)]).join(" ")).toMatch(/duplicate financial effects found/);
    // An unmeasured assertion proves nothing either.
    const notMeasured = measured(120, 0);
    notMeasured.measurements.duplicate_financial_effect_under_load.achieved = null as unknown as boolean;
    notMeasured.measurements.duplicate_financial_effect_under_load.verdict = "NOT_MEASURED";
    expect(onceOnlyEvidenceFailures([notMeasured]).join(" ")).toMatch(/not measured/);
    // And a report that never ran the assertion cannot claim it.
    expect(onceOnlyEvidenceFailures([]).join(" ")).toMatch(/no run carries/);
  });
});

describe("load harness once-only stake-effect rule", () => {
  // Regression guard for the defect found in review round 2 (B1): the assertion
  // filtered its population to `state === "CONFIRMED"` while the settlement
  // driver had already moved those Orders to SETTLED, so the duplicate/missing
  // counters were 0-over-zero and read as a pass.
  const stakeEffectModule = "../../tools/load-harness/lib/stake-effect.mjs";

  it("examines a settled population instead of reporting zero over zero", async () => {
    const { evaluateStakeEffectOnceOnly } = await import(stakeEffectModule);
    const orders = [
      { id: "order-a", state: "SETTLED" },
      { id: "order-b", state: "SETTLED" },
      { id: "order-c", state: "CONFIRMED" },
    ];
    const result = evaluateStakeEffectOnceOnly({
      orders,
      stakeCommits: orders.map((order) => ({ businessTransactionId: order.id })),
      manifestOrderIds: ["order-a", "order-b", "order-c"],
    });
    expect(result.failures).toEqual([]);
    expect(result.checks.stakeEffectExaminedPopulation).toBe(3);
    expect(result.checks.ordersMissingStakeEffect).toBe(0);
    expect(result.checks.ordersWithDuplicateStakeEffect).toBe(0);
    expect(result.checks.duplicateFinancialEffectsFound).toBe(0);
  });

  it("fails when the examined population is empty, whatever the state histogram says", async () => {
    const { evaluateStakeEffectOnceOnly } = await import(stakeEffectModule);
    const nothingExamined = evaluateStakeEffectOnceOnly({ orders: [], stakeCommits: [] });
    expect(nothingExamined.failures.join(" ")).toMatch(/examined 0 Bet Orders/);

    const onlyUncommitted = evaluateStakeEffectOnceOnly({
      orders: [{ id: "order-quoted", state: "QUOTED" }],
      stakeCommits: [],
    });
    expect(onlyUncommitted.checks.stakeEffectExaminedPopulation).toBe(0);
    expect(onlyUncommitted.failures.join(" ")).toMatch(/empty population/);
    // A QUOTED Order is not "missing a stake" — it simply has not been committed.
    expect(onlyUncommitted.checks.ordersMissingStakeEffect).toBe(0);
  });

  it("detects a duplicate stake effect on an Order created by the live load", async () => {
    const { evaluateStakeEffectOnceOnly } = await import(stakeEffectModule);
    const result = evaluateStakeEffectOnceOnly({
      orders: [{ id: "live-order", state: "CONFIRMED" }],
      stakeCommits: [{ businessTransactionId: "live-order" }, { businessTransactionId: "live-order" }],
    });
    expect(result.checks.ordersWithDuplicateStakeEffect).toBe(1);
    expect(result.checks.duplicateFinancialEffectsFound).toBe(1);
    expect(result.failures.join(" ")).toMatch(/more than one stake financial transaction/);
  });

  it("reports an Order in a stake-committed state with no stake effect, and duplicate refunds", async () => {
    const { evaluateStakeEffectOnceOnly } = await import(stakeEffectModule);
    const result = evaluateStakeEffectOnceOnly({
      orders: [{ id: "order-missing", state: "SETTLED" }],
      stakeCommits: [],
      refunds: [{ businessTransactionId: "order-missing:refund" }, { businessTransactionId: "order-missing:refund" }],
    });
    expect(result.checks.ordersMissingStakeEffect).toBe(1);
    expect(result.checks.ordersWithDuplicateRefundEffect).toBe(1);
    expect(result.failures.length).toBeGreaterThanOrEqual(2);
  });

  it("fails when the manifest population is not inside the examined database", async () => {
    const { evaluateStakeEffectOnceOnly } = await import(stakeEffectModule);
    const result = evaluateStakeEffectOnceOnly({
      orders: [{ id: "some-other-order", state: "CONFIRMED" }],
      stakeCommits: [{ businessTransactionId: "some-other-order" }],
      manifestOrderIds: ["seeded-order"],
    });
    expect(result.checks.manifestOrdersMissingFromScope).toBe(1);
    expect(result.failures.join(" ")).toMatch(/wrong database/);
  });
});

describe("load harness packaging", () => {
  it("ships the documented entrypoints and does not add external load tools", () => {
    const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    expect(packageJson.scripts["load:run"]).toContain("tools/load-harness/run.mjs");
    expect(packageJson.scripts["load:seed"]).toContain("tools/load-harness/seed/seed-load-fixtures.ts");
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    for (const tool of ["k6", "autocannon", "artillery", "vegeta", "wrk", "hey"]) {
      expect(Object.keys(dependencies)).not.toContain(tool);
    }
  });
});
