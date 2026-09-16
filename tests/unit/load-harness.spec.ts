// Guard rails for the load harness itself.
//
// These specs exist so a weakened target, a lost scenario identity or a broken
// verdict rule fails CI instead of quietly producing a green capacity claim.
// They also pin the statistics the drivers rely on.

import { spawnSync } from "node:child_process";
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
  id: string;
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

describe("load harness target coverage (review round 3 finding C1)", () => {
  const coverageModule = "../../tools/load-harness/lib/coverage.mjs";
  const reproductionModule = "../../tools/load-harness/lib/reproduction.mjs";

  it("reports a NOT_MEASURED row for every target no driver measured", async () => {
    const { buildCoverageRun, findUncoveredTargets, targetCoverageFailures } = await import(coverageModule);
    const scenarioTargets = scenario.targets;
    // A run set that measures everything except queue lag, exactly like the
    // reviewed artifact: 10 of 11 targets had a row and the 11th was invisible.
    const measuredKeys = Object.keys(scenarioTargets).filter((key) => key !== "critical_queue_lag");
    const runs = [
      { id: "settlement-capacity", measurements: Object.fromEntries(measuredKeys.map((key) => [key, { verdict: "MEASURED" }])) },
    ];
    expect(findUncoveredTargets(scenarioTargets, runs)).toEqual(["critical_queue_lag"]);
    // The pre-fix report would have failed this check.
    expect(targetCoverageFailures(scenarioTargets, runs).join(" ")).toMatch(/critical_queue_lag/);

    const signals = [
      { id: "queueLag", purpose: "critical Outbox/queue delivery lag p95", available: false, matchedFamilies: [], surfaces: [] },
    ];
    const coverageRun = buildCoverageRun({ targets: scenarioTargets, scenarioId: scenario.id, runs, signals, inventory: { api: { familyCount: 0, families: [] } } });
    expect(coverageRun).not.toBeNull();
    expect(coverageRun.measured).toBe(false);
    const row = coverageRun.measurements.critical_queue_lag;
    expect(row.verdict).toBe("NOT_MEASURED");
    expect(row.achieved).toBeNull();
    expect(row.target).toEqual({ p95_ms_max: 5000, alert_threshold_ms: 30000, unit: "ms (Outbox/queue delivery lag)" });
    expect(row.reason).toMatch(/queueLag/);
    expect(row.reason).toMatch(/no family matched/);
    expect(row.evidence.matchedFamilies).toEqual([]);
    // With the coverage run appended the report accounts for all 11 targets.
    expect(targetCoverageFailures(scenarioTargets, [...runs, coverageRun])).toEqual([]);
    // A complete report is not padded with an empty coverage run.
    expect(buildCoverageRun({ targets: scenarioTargets, runs: [...runs, coverageRun], signals })).toBeNull();
  });

  it("refuses to write a report whose table is missing a target, and names the coverage line", async () => {
    const reportModule = "../../tools/load-harness/lib/report.mjs";
    const { writeReport, buildMarkdownReport } = await import(reportModule);
    const base = {
      scenario: { id: "ticket13-capacity-v1", version: "1.0.0", sourceOfTruth: "GH #91", card: "t_4fd8e4a7", mix: {}, burst: {}, targets: scenario.targets },
      profile: { name: "smoke", claimsTarget: false, purpose: "plumbing" },
      fingerprint: { candidate: { sha: "0d3b6cb1ce905387dd6822a29121bba70bddcf4a", branch: "feat/load-harness-ticket13", worktreeDirty: false } },
      likeness: { productionLike: false, failures: ["cpu"] },
      signals: [],
      inventory: {},
      assertions: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      commands: [],
    };
    const outDir = mkdtempSync(path.join(tmpdir(), "load-coverage-"));
    try {
      // Missing target -> refuse to write.
      expect(() => writeReport({ ...base, outDir, runs: [{ id: "member-sessions", measurements: {} }] })).toThrow(
        /target coverage is incomplete/,
      );

      const coverageRun = {
        id: "target-coverage",
        name: "Ticket 13 targets with no measurement path in this harness",
        measured: false,
        envGated: false,
        driver: "lib/coverage.mjs",
        requested: { uncoveredTargets: ["critical_queue_lag"] },
        notes: [],
        samples: {},
        measurements: {
          critical_queue_lag: {
            target: { p95_ms_max: 5000 },
            achieved: null,
            verdict: "NOT_MEASURED",
            reason: "no driver measures `critical_queue_lag`; required family `queueLag` matched nothing",
          },
        },
      };
      const runs = [
        { id: "settlement-capacity", measurements: Object.fromEntries(Object.keys(scenario.targets).filter((key) => key !== "critical_queue_lag").map((key) => [key, { target: {}, achieved: 1, verdict: "MEASURED" }])) },
        coverageRun,
      ];
      const { jsonPath, mdPath } = writeReport({ ...base, outDir, runs });
      const markdown = readFileSync(mdPath, "utf8");
      const json = JSON.parse(readFileSync(jsonPath, "utf8"));
      expect(markdown).toMatch(/\| critical_queue_lag \| target-coverage \| \{"p95_ms_max":5000\} \| - \| NOT_MEASURED \| no driver measures/);
      expect(markdown).toMatch(/Ticket 13 target coverage: \*\*10\/11 driver-backed\*\*/);
      expect(json.targetCoverage.declaredUnmeasured).toEqual(["critical_queue_lag"]);
      expect(json.targetCoverage.driverBacked).toBe(10);
      expect(json.targetCoverage.missing).toEqual([]);
      expect(json.targetCoverage.totalTargets).toBe(11);
      // The markdown view must stay renderable as a table with the reason column.
      expect(buildMarkdownReport({ ...base, runs })).toContain("| Metric | Driver | Target | Achieved | Verdict | Note |");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("prints reproduction commands that boot-api.sh actually accepts", async () => {
    const { buildReproductionCommands, portFromBaseUrl, databaseSuffixFromUrl } = await import(reproductionModule);
    const commands = buildReproductionCommands({
      scenarioId: "ticket13-capacity-v1",
      profileName: "smoke",
      baseUrl: "http://127.0.0.1:19299",
      manifestPath: path.join(repoRoot, ".hermes/evidence/release/w5-raw-load/load-manifest-smoke.json"),
      repoRoot,
      candidateSha: "0d3b6cb1ce905387dd6822a29121bba70bddcf4a",
      databaseUrl: "postgresql://lottify:secret@127.0.0.1:5432/lottify_load_r4repro?schema=public",
    });
    expect(portFromBaseUrl("http://127.0.0.1:19299")).toBe("19299");
    expect(portFromBaseUrl("https://load.example.com")).toBe("443");
    const printed = commands.join("\n");
    expect(printed).not.toMatch(/boot-api\.sh\s+--base-url/);
    expect(printed).toContain("bash tools/load-harness/scripts/boot-api.sh --port 19299");
    // The teardown must name the real load database, not a placeholder.
    expect(databaseSuffixFromUrl("postgresql://lottify:secret@127.0.0.1:5432/lottify_load_r4repro?schema=public")).toBe("r4repro");
    expect(databaseSuffixFromUrl("postgresql://lottify:secret@127.0.0.1:5432/lottify_dev?schema=public")).toBeNull();
    expect(printed).toContain("LOAD_DB_SUFFIX=r4repro bash tools/load-harness/scripts/scratch-db.sh --drop");
    // The block must create the database it later drops, or it is not a
    // reproduction of the whole drill.
    expect(printed).toContain("bash tools/load-harness/scripts/scratch-db.sh --suffix r4repro");
    // The block references $LOAD_DATABASE_URL; it must never embed the URL itself
    // (a manifest holds real tokens; a report is attachable evidence).
    expect(printed).not.toContain("postgresql://");
    expect(printed).not.toContain("secret");
    // The printed boot-step arguments must be accepted by the real script. `--stop`
    // on an unused port is a no-op, so nothing is started or killed here.
    const scriptPath = path.join(repoRoot, "tools/load-harness/scripts/boot-api.sh");
    const stopped = spawnSync("bash", [scriptPath, "--port", "19997", "--stop"], { encoding: "utf8" });
    expect(stopped.status).toBe(0);
    expect(stopped.stdout).toMatch(/no pid file|stopped API/);
    const rejected = spawnSync("bash", [scriptPath, "--base-url", "http://127.0.0.1:19299"], { encoding: "utf8" });
    expect(rejected.status).toBe(2);
    expect(rejected.stderr).toMatch(/unknown argument: --base-url/);
  });
});

describe("load harness Member-visible partial completion (review round 4 finding R1)", () => {
  const settlementDriver = "../../tools/load-harness/drivers/settlement.mjs";

  it("does not call the contract's in-flight state a partial completion", async () => {
    const { evaluateMemberVisiblePartialCompletion } = await import(settlementDriver);
    // The payload the reviewed artifact reproduced for an in-flight batch: no
    // outcome, authoritative=false — the contract's documented non-visible state,
    // which the previous regex-based check misread as a Ticket 13 violation.
    const inFlight = [
      { status: 200, batchState: "POSTING", outcome: null, authoritative: false, bodyParsed: true, orderId: "o1" },
      { status: 200, batchState: "COMMITTING", outcome: null, authoritative: false, bodyParsed: true, orderId: "o2" },
    ];
    const result = evaluateMemberVisiblePartialCompletion(inFlight);
    expect(result.violationCount).toBe(0);
    expect(result.inFlightObservations).toBe(2);
    expect(result.exercised).toBe(true);
  });

  it("flags a read that presents a result as final before the batch COMPLETED", async () => {
    const { evaluateMemberVisiblePartialCompletion } = await import(settlementDriver);
    const exposesOutcome = evaluateMemberVisiblePartialCompletion([
      { status: 200, batchState: "POSTING", outcome: "WIN", authoritative: false, bodyParsed: true, orderId: "o1" },
      { status: 200, batchState: "POSTING", outcome: null, authoritative: false, bodyParsed: true, orderId: "o2" },
    ]);
    expect(exposesOutcome.violationCount).toBe(1);
    expect(exposesOutcome.violations[0].reason).toMatch(/exposes a settlement outcome/);

    const claimsAuthority = evaluateMemberVisiblePartialCompletion([
      { status: 200, batchState: "POSTING", outcome: null, authoritative: true, bodyParsed: true, orderId: "o1" },
    ]);
    expect(claimsAuthority.violationCount).toBe(1);
    expect(claimsAuthority.violations[0].reason).toMatch(/claims authority/);
  });

  it("counts a COMPLETED authoritative read as the property holding, and a fully COMPLETED poll as unexercised", async () => {
    const { evaluateMemberVisiblePartialCompletion } = await import(settlementDriver);
    const mixed = evaluateMemberVisiblePartialCompletion([
      { status: 200, batchState: "POSTING", outcome: null, authoritative: false, bodyParsed: true },
      { status: 200, batchState: "COMPLETED", outcome: "WIN", authoritative: true, bodyParsed: true },
    ]);
    expect(mixed.violationCount).toBe(0);
    expect(mixed.authoritativeObservations).toBe(1);
    expect(mixed.exercised).toBe(true);

    const completedOnly = evaluateMemberVisiblePartialCompletion([
      { status: 200, batchState: "COMPLETED", outcome: "LOSE", authoritative: true, bodyParsed: true },
    ]);
    expect(completedOnly.exercised).toBe(false);
  });

  it("ignores non-200 reads and unreadable bodies instead of counting them as evidence", async () => {
    const { evaluateMemberVisiblePartialCompletion } = await import(settlementDriver);
    const result = evaluateMemberVisiblePartialCompletion([
      { status: 404, batchState: null, outcome: null, authoritative: null, bodyParsed: true },
      { status: 200, batchState: null, outcome: null, authoritative: null, bodyParsed: false },
    ]);
    expect(result.violationCount).toBe(0);
    expect(result.exercised).toBe(false);
    expect(result.unreadableObservations).toBe(1);
  });

  it("polls only aligned (orderId, memberToken) pairs and flags an unaligned manifest", async () => {
    const { resolvePartialCompletionSamples } = await import(settlementDriver);
    const aligned = resolvePartialCompletionSamples({
      partialCompletionSamples: [{ orderId: "o1", memberToken: "t1" }],
      memberOrderIds: ["o9"],
      memberTokens: ["t9"],
    });
    expect(aligned.fellBack).toBe(false);
    expect(aligned.samples).toEqual([{ orderId: "o1", memberToken: "t1" }]);

    // An older manifest: `memberTokens[i]` and `memberOrderIds[i]` come from two
    // different slices, so the pairing is unverified and must be flagged.
    const legacy = resolvePartialCompletionSamples({ memberOrderIds: ["o1", "o2"], memberTokens: ["t1"] });
    expect(legacy.fellBack).toBe(true);
    expect(legacy.samples).toHaveLength(2);

    expect(resolvePartialCompletionSamples({})).toEqual({ samples: [], fellBack: false });
  });
});

describe("load harness report binding guards (review round 4 findings R2 + artifact clobber)", () => {
  const reportModule = "../../tools/load-harness/lib/report.mjs";
  const reproductionModule = "../../tools/load-harness/lib/reproduction.mjs";
  const assertScript = path.join(repoRoot, "tools/load-harness/scripts/assert-report.mjs");
  const candidateSha = "0d3b6cb1ce905387dd6822a29121bba70bddcf4a";
  const candidateSha12 = candidateSha.slice(0, 12);
  const targetKeys = Object.keys(scenario.targets);
  const coverageRun = {
    id: "target-coverage",
    measurements: {
      critical_queue_lag: {
        target: { p95_ms_max: 5000 },
        achieved: null,
        verdict: "NOT_MEASURED",
        reason: "no driver measures `critical_queue_lag`; required family `queueLag` matched nothing",
      },
    },
  };

  /** A run set that accounts for every target and carries non-empty once-only evidence. */
  function soundRuns() {
    const settled = Object.fromEntries(
      targetKeys.filter((key) => key !== "critical_queue_lag").map((key) => [key, { target: {}, achieved: 1, verdict: "MEASURED" }]),
    );
    return [
      {
        id: "settlement-capacity",
        measurements: {
          ...settled,
          duplicate_financial_effect_under_load: {
            target: { allowed: false },
            achieved: true,
            verdict: "MEASURED",
            duplicateEffectsFound: 0,
            examinedPopulation: 249,
          },
        },
      },
      coverageRun,
    ];
  }

  /** The same run set as a replay that never reached its load database. */
  function unsoundRuns() {
    const nothing = Object.fromEntries(
      targetKeys
        .filter((key) => key !== "critical_queue_lag" && key !== "settlement_capacity")
        .map((key) => [key, { target: {}, achieved: null, verdict: "NOT_MEASURED" }]),
    );
    return [
      {
        id: "settlement-capacity",
        measurements: {
          ...nothing,
          settlement_capacity_bet_lines: { target: {}, achieved: null, verdict: "NOT_MEASURED" },
          duplicate_financial_effect_under_load: {
            target: { allowed: false },
            achieved: null,
            verdict: "NOT_MEASURED",
            duplicateEffectsFound: null,
            examinedPopulation: 0,
          },
        },
      },
      coverageRun,
    ];
  }

  async function fixtureBase() {
    const { buildReproductionCommands } = await import(reproductionModule);
    return {
      scenario: { id: "ticket13-capacity-v1", version: "1.0.0", sourceOfTruth: "GH #91", card: "t_4fd8e4a7", mix: {}, burst: {}, targets: scenario.targets },
      profile: { name: "smoke", claimsTarget: false, purpose: "plumbing" },
      fingerprint: { candidate: { sha: candidateSha, branch: "feat/load-harness-ticket13", worktreeDirty: false } },
      likeness: { productionLike: false, failures: ["cpu"] },
      signals: [],
      inventory: {},
      assertions: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      commands: buildReproductionCommands({
        scenarioId: "ticket13-capacity-v1",
        profileName: "smoke",
        baseUrl: "http://127.0.0.1:19199",
        manifestPath: path.join(repoRoot, ".hermes/evidence/release/w5-raw-load/load-manifest-smoke.json"),
        repoRoot,
        candidateSha,
        databaseUrl: "postgresql://lottify:***@127.0.0.1:5432/lottify_load_r5fix?schema=public",
      }),
      candidateSha,
      harnessRevisionSha: candidateSha,
    };
  }

  it("fails the binding check when the printed §6 boots the API with --base-url (R2)", async () => {
    const { writeReport } = await import(reportModule);
    const outDir = mkdtempSync(path.join(tmpdir(), "load-assert-"));
    try {
      const { jsonPath, mdPath } = writeReport({ ...(await fixtureBase()), outDir, runs: soundRuns() });
      const ok = spawnSync(process.execPath, [assertScript, jsonPath, candidateSha12], { encoding: "utf8" });
      expect(ok.status).toBe(0);
      expect(ok.stdout).toMatch(/OK: report bound to candidate/);

      // The generator prints the script as a path, so the guard must trip on that
      // form too: this is exactly the mutation review round 4 found it ignoring.
      const mutated = readFileSync(mdPath, "utf8").replace(
        /bash tools\/load-harness\/scripts\/boot-api\.sh --port (\d+)/,
        "bash tools/load-harness/scripts/boot-api.sh --base-url http://127.0.0.1:$1",
      );
      expect(mutated).toContain("scripts/boot-api.sh --base-url");
      writeFileSync(mdPath, mutated, "utf8");
      const bad = spawnSync(process.execPath, [assertScript, jsonPath, candidateSha12], { encoding: "utf8" });
      expect(bad.status).toBe(1);
      expect(bad.stderr).toMatch(/boots the API with --base-url/);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite a sound artifact with a replay that has no once-only evidence", async () => {
    const { writeReport } = await import(reportModule);
    const outDir = mkdtempSync(path.join(tmpdir(), "load-clobber-"));
    try {
      const { jsonPath, mdPath } = writeReport({ ...(await fixtureBase()), outDir, runs: soundRuns() });
      const deliveredJson = readFileSync(jsonPath, "utf8");
      const deliveredMd = readFileSync(mdPath, "utf8");
      // The reviewed failure mode: a re-run that fell back to the dev database
      // wrote an all-NOT_MEASURED report over the delivered artifact.
      const unsoundBase = await fixtureBase();
      expect(() => writeReport({ ...unsoundBase, outDir, runs: unsoundRuns() })).toThrow(/binding checks/);
      expect(readFileSync(jsonPath, "utf8")).toBe(deliveredJson);
      expect(readFileSync(mdPath, "utf8")).toBe(deliveredMd);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("prints the unproven target count next to the driver-backed count", async () => {
    const { writeReport } = await import(reportModule);
    const outDir = mkdtempSync(path.join(tmpdir(), "load-unproven-"));
    try {
      const { mdPath, jsonPath } = writeReport({ ...(await fixtureBase()), outDir, runs: soundRuns() });
      expect(readFileSync(mdPath, "utf8")).toMatch(/Ticket 13 target coverage: \*\*10\/11 driver-backed\*\* rows · \*\*1\/11 still unproven\*\*/);
      expect(JSON.parse(readFileSync(jsonPath, "utf8")).targetCoverage.unproven).toEqual(["critical_queue_lag"]);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
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
