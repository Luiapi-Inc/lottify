// Guard rails for the load harness itself.
//
// These specs exist so a weakened target, a lost scenario identity or a broken
// verdict rule fails CI instead of quietly producing a green capacity claim.
// They also pin the statistics the drivers rely on.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    const tempPath = path.join(repoRoot, ".hermes", "weakened-scenario.json");
    mkdirSync(path.dirname(tempPath), { recursive: true });
    writeFileSync(tempPath, JSON.stringify(weakened));
    expect(() => loadScenario(tempPath)).toThrow(/weaker than the Ticket 13 value/);
    rmSync(tempPath);
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
