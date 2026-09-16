#!/usr/bin/env node
// Lottify load/performance harness — Ticket 13 / GH #91 runner.
//
// Usage:
//   node tools/load-harness/run.mjs \
//     --profile smoke|sandbox|target \
//     --base-url http://127.0.0.1:19199 \
//     --manifest .hermes/evidence/release/w5-raw-load/load-manifest.json \
//     [--out-dir .hermes/evidence/release] \
//     [--only member-sessions,quote-confirm,payment-events,settlement] \
//     [--webhook-path /api/v1/payments/webhook --webhook-signature-header x-signature --webhook-signature VALUE] \
//     [--worker-metrics-url http://127.0.0.1:3100] \
//     [--api-repo-root /path/to/repo] [--database-url postgresql://...]
//
// The harness never starts or mutates anything by itself: it drives an already
// running candidate API, reads its metrics surface, and writes a report. Seeding
// is a separate, explicitly-invoked step (seed/seed-load-fixtures.ts) so a
// reviewer can see exactly which fixture rows a run depended on.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { loadScenario, resolveProfile } from "./lib/scenario.mjs";
import { environmentFingerprint, assessProductionLikeness } from "./lib/environment.mjs";
import { fetchMetrics, resolveRequiredSignals, metricInventory } from "./lib/metrics.mjs";
import { writeReport, summariseVerdicts } from "./lib/report.mjs";
import { buildCoverageRun } from "./lib/coverage.mjs";
import { buildReproductionCommands } from "./lib/reproduction.mjs";
import { HttpClient } from "./lib/http-client.mjs";
import { runReadSessions } from "./drivers/read-sessions.mjs";
import { runQuoteConfirm } from "./drivers/quote-confirm.mjs";
import { runPaymentEvents } from "./drivers/payment-events.mjs";
import { runSettlementCapacity } from "./drivers/settlement.mjs";

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

/**
 * Settles the settlement verdicts against the independent SQL assertions. The
 * reported Bet Line count and the once-only-effect facts must come from the
 * database, not from an HTTP body the API may or may not include.
 */
function reconcileSettlementWithAssertions({ runs, assertions, scenario, profile }) {
  const run = runs.find((candidate) => candidate.id === "settlement-capacity");
  if (!run || !assertions) return;
  const checks = assertions.checks ?? {};
  const target = scenario.targets.settlement_capacity;
  const betLines = typeof checks.settlementBetLines === "number" ? checks.settlementBetLines : null;
  const elapsedSeconds = run.samples?.elapsedSeconds ?? null;
  run.samples.assertionDerivedBetLines = betLines;
  run.samples.assertionFailures = assertions.failures ?? [];
  run.notes = [...(run.notes ?? []), `independent SQL assertion output: ${assertions.measured ? JSON.stringify(checks) : assertions.error}`];
  if (checks.settlementBatchState) {
    run.samples.settlementBatchStateFromSql = checks.settlementBatchState;
  }

  const measured = run.measured && betLines !== null;
  const withinBudget = elapsedSeconds !== null && elapsedSeconds <= target.within_seconds;
  const throughputOk = measured && betLines >= target.min_bet_lines && withinBudget;
  run.measurements.settlement_capacity_bet_lines = {
    target: { min: target.min_bet_lines, within_seconds: target.within_seconds },
    achieved: betLines,
    verdict: !measured
      ? "NOT_MEASURED"
      : profile.claimsTarget
        ? throughputOk
          ? "PASS"
          : "FAIL"
        : "MEASURED",
  };
  const resumeOk =
    checks.settlementBatchCount === 1 && checks.settlementBatchState === "COMPLETED" && run.samples.sameBatchIdOnResume === true;
  run.measurements.settlement_idempotent_resume = {
    target: { required: true },
    achieved: checks.settlementBatchCount === undefined ? null : resumeOk,
    achievedMeaning: "the settlement batch resumed idempotently (true) or did not (false)",
    verdict: !run.measured
      ? "NOT_MEASURED"
      : checks.settlementBatchCount === undefined
        ? "NOT_MEASURED"
        : profile.claimsTarget
          ? resumeOk
            ? "PASS"
            : "FAIL"
          : "MEASURED",
  };
  // The once-only property is only certifiable over a NON-EMPTY population: the
  // assertion script fails when the examined scope is empty, and the counters
  // below are surfaced next to the boolean so "no duplicates" can never be read
  // off an empty check (review round 2 finding B1).
  const examinedPopulation = checks.stakeEffectExaminedPopulation ?? 0;
  const duplicateEffectsFound = checks.duplicateFinancialEffectsFound ?? null;
  const onceOnlyOk =
    examinedPopulation > 0 &&
    (checks.ordersWithDuplicateStakeEffect ?? 1) === 0 &&
    (checks.ordersMissingStakeEffect ?? 1) === 0 &&
    (checks.ordersWithDuplicateRefundEffect ?? 1) === 0 &&
    (checks.ordersPaidTwice ?? 1) === 0 &&
    (assertions.failures ?? []).length === 0;
  run.samples.duplicateFinancialEffectsFound = duplicateEffectsFound;
  run.samples.stakeEffectExaminedPopulation = examinedPopulation;
  run.notes = [
    ...(run.notes ?? []),
    `once-only financial effect: examined ${examinedPopulation} stake-committed Order(s) out of ${checks.ordersExamined ?? 0} in the load database, duplicate effects found: ${duplicateEffectsFound}`,
  ];
  run.measurements.duplicate_financial_effect_under_load = {
    target: { allowed: false },
    achieved: assertions.measured ? onceOnlyOk : null,
    // The target constrains a property ("no duplicate financial effect is
    // allowed"), so `achieved` must not be read as a quantity that was achieved:
    // true = the once-only property HOLDS (no duplicate observed).
    achievedMeaning: "the once-only financial-effect property holds — no duplicate stake/refund effect was observed (true) or one was (false)",
    duplicateEffectsFound,
    examinedPopulation,
    verdict: !assertions.measured ? "NOT_MEASURED" : profile.claimsTarget ? (onceOnlyOk ? "PASS" : "FAIL") : "MEASURED",
  };
}

const args = parseArgs(process.argv.slice(2));
const profileName = args.profile ?? "smoke";
const baseUrl = args["base-url"] ?? "http://127.0.0.1:19199";
const repoRoot = args["api-repo-root"] ?? process.cwd();
const scenario = loadScenario(args.scenario);
const profile = resolveProfile(scenario, profileName);
const outDir = args["out-dir"] ?? path.join(repoRoot, ".hermes", "evidence", "release");
const only = args.only ? String(args.only).split(",").map((value) => value.trim()) : null;
const shouldRun = (id) => only === null || only.includes(id);

const manifestPath = args.manifest ?? null;
let manifest = null;
if (manifestPath) {
  if (!existsSync(manifestPath)) {
    console.error(`manifest not found: ${manifestPath}`);
    process.exit(2);
  }
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
}

const startedAt = new Date().toISOString();
const loadDatabaseUrl = args["database-url"] ?? process.env.LOAD_DATABASE_URL ?? process.env.DATABASE_URL ?? null;
const fingerprint = environmentFingerprint({
  repoRoot,
  databaseUrl: loadDatabaseUrl ?? manifest?.databaseUrl ?? null,
  redisUrl: manifest?.redisUrl ?? null,
  apiBaseUrl: baseUrl,
});
const likeness = assessProductionLikeness(fingerprint);

// The report must be bound to the candidate whose *API build* was exercised, not
// to the harness commit that produced the report. They are normally the same tree
// (the harness only adds tools/docs), but on a harness branch they differ, and a
// reviewer needs both.
const harnessRevisionSha = fingerprint.candidate.sha;
const candidateSha = (() => {
  if (typeof args["candidate-sha"] === "string") return args["candidate-sha"];
  try {
    return execFileSync("git", ["rev-parse", "origin/main"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return harnessRevisionSha;
  }
})();

if (profile.claimsTarget && !likeness.productionLike) {
  console.error(
    [
      `REFUSING to run the '${profile.name}' profile: this environment is not production-like, so a target-profile run here could only produce a misleading PASS/FAIL.`,
      ...likeness.failures.map((failure) => `  - ${failure}`),
      "Use --profile sandbox for a MEASURED (non-capacity) run, or run on the approved production-like environment.",
    ].join("\n"),
  );
  process.exit(3);
}

const probeClient = new HttpClient({ baseUrl, maxSockets: 4 });
const metricSurfaces = [];
metricSurfaces.push(await fetchMetrics(probeClient, { path: "/metrics", label: "api" }));
if (args["worker-metrics-url"]) {
  const workerClient = new HttpClient({ baseUrl: args["worker-metrics-url"], maxSockets: 4 });
  metricSurfaces.push(await fetchMetrics(workerClient, { path: "/metrics", label: "worker" }));
  workerClient.close();
}

const runs = [];
const sessions = manifest?.sessions ?? [];
const drawIds = manifest?.drawIds ?? [];

if (shouldRun("member-sessions")) {
  console.log(`[harness] member-sessions: ${profile.sessions.target} sessions, ramp ${profile.sessions.rampSeconds}s, read ${profile.read.targetRps} rps for ${profile.read.durationSeconds}s`);
  runs.push(
    await runReadSessions({
      baseUrl,
      sessions,
      targetSessions: profile.sessions.target,
      targetRps: profile.read.targetRps,
      rampSeconds: profile.sessions.rampSeconds,
      durationSeconds: profile.read.durationSeconds,
      scenario,
      claimsTarget: profile.claimsTarget,
    }),
  );
}

if (shouldRun("quote-confirm")) {
  const burst = profile.burst?.enabled
    ? {
        active: false,
        peakMultiplier: profile.burst.peakMultiplier,
        activateAt: Date.now() + Math.max(profile.quoteConfirm.durationSeconds - profile.burst.durationSeconds, 0) * 1000,
        description: `pre-cutoff burst: steady ${profile.quoteConfirm.quoteRps} quote rps, then x${profile.burst.peakMultiplier} multiplier for the last ${profile.burst.durationSeconds}s`,
      }
    : null;
  console.log(`[harness] quote-confirm: ${profile.quoteConfirm.quoteRps} quote rps / ${profile.quoteConfirm.confirmRps} confirm rps for ${profile.quoteConfirm.durationSeconds}s`);
  runs.push(
    await runQuoteConfirm({
      baseUrl,
      sessions,
      drawIds,
      betTypeCode: manifest?.betTypeCode ?? null,
      stakeMinor: scenario.mix.stakeMinor,
      canonicalNumber: scenario.mix.canonicalNumber,
      quoteRps: profile.quoteConfirm.quoteRps,
      confirmRps: profile.quoteConfirm.confirmRps,
      durationSeconds: profile.quoteConfirm.durationSeconds,
      scenario,
      claimsTarget: profile.claimsTarget,
      burst,
      replaySampleSize: Number(args["replay-sample"] ?? (profile.claimsTarget ? 500 : 25)),
      replayConcurrency: Number(args["replay-concurrency"] ?? 4),
    }),
  );
}

if (shouldRun("payment-events")) {
  console.log(`[harness] payment-events: target ${profile.paymentEvents.targetRps} events/s for ${profile.paymentEvents.durationSeconds}s`);
  runs.push(
    await runPaymentEvents({
      baseUrl,
      targetRps: profile.paymentEvents.targetRps,
      durationSeconds: profile.paymentEvents.durationSeconds,
      scenario,
      claimsTarget: profile.claimsTarget,
      webhookPath: args["webhook-path"] ?? null,
      signatureHeader: args["webhook-signature-header"] ?? null,
      signatureValue: args["webhook-signature"] ?? null,
      openApiPath: args["openapi"] ?? path.join(repoRoot, "apps/api/openapi/openapi.json"),
    }),
  );
}

if (shouldRun("settlement") && manifest?.settlement?.drawId) {
  console.log(`[harness] settlement: draw ${manifest.settlement.drawId}, ${manifest.settlement.betLines} bet lines, budget ${profile.settlement.budgetSeconds}s`);
  runs.push(
    await runSettlementCapacity({
      baseUrl,
      adminToken: manifest.settlement.adminToken,
      drawId: manifest.settlement.drawId,
      betLines: manifest.settlement.betLines,
      budgetSeconds: profile.settlement.budgetSeconds,
      resultSchemaVersionRef: manifest.settlement.resultSchemaVersionRef ?? "result-v1",
      winningBetTypeCode: manifest.settlement.betTypeCode,
      winningCanonicalNumber: scenario.mix.canonicalNumber,
      scenario,
      claimsTarget: profile.claimsTarget,
      memberTokens: manifest.settlement.memberTokens ?? [],
      memberOrderIds: manifest.settlement.memberOrderIds ?? [],
    }),
  );
}

// Post-run metrics: some signals (lag, DLQ depth) only move while traffic flows.
metricSurfaces.push(await fetchMetrics(probeClient, { path: "/metrics", label: "api-post" }));
probeClient.close();

const signals = resolveRequiredSignals(scenario.requiredObservability, metricSurfaces);
const inventory = metricInventory(metricSurfaces);

let assertions = null;
const assertScript = path.join(repoRoot, "tools/load-harness/seed/assert-financial-effects.ts");
if (manifest?.settlement?.drawId && existsSync(assertScript)) {
  try {
    const output = execFileSync(
      path.join(repoRoot, "node_modules/.bin/tsx"),
      [assertScript, "--manifest", manifestPath],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          ...(loadDatabaseUrl ? { DATABASE_URL: loadDatabaseUrl } : {}),
          TMPDIR: process.env.TMPDIR ?? "/tmp",
        },
      },
    );
    const jsonLine = output.trim().split("\n").filter((line) => line.startsWith("{")).pop();
    assertions = jsonLine ? JSON.parse(jsonLine) : { measured: false, error: "assertion script produced no JSON", raw: output.slice(-2000) };
  } catch (error) {
    assertions = { measured: false, error: String(error.message ?? error), stdout: String(error.stdout ?? "").slice(-2000) };
  }
}

const finishedAt = new Date().toISOString();

// The settlement verdict depends on the independent SQL assertions rather than
// on the HTTP response, because the batch response does not expose a Bet Line
// count. Reconcile the two here so the report carries one number per target.
reconcileSettlementWithAssertions({ runs, assertions, scenario, profile });

// Coverage runs last: it needs the final measurement set (including the
// assertion-derived settlement rows) to know which Ticket 13 targets still have
// no row, and it is what makes `critical_queue_lag` an explicit NOT_MEASURED row
// instead of an invisible gap (review round 3 finding C1).
const coverageRun = buildCoverageRun({
  targets: scenario.targets,
  scenarioId: scenario.id,
  runs,
  signals,
  inventory,
});
if (coverageRun) {
  runs.push(coverageRun);
  console.log(
    `[harness] target coverage: ${coverageRun.requested.uncoveredTargets.length} target(s) with no measurement path reported as NOT_MEASURED: ${coverageRun.requested.uncoveredTargets.join(", ")}`,
  );
}

const commands = buildReproductionCommands({
  scenarioId: scenario.id,
  profileName: profile.name,
  baseUrl,
  manifestPath,
  repoRoot,
  candidateSha,
  // Lets the printed teardown name the real load-database suffix instead of a
  // placeholder, so §6 is runnable verbatim.
  databaseUrl: loadDatabaseUrl,
});

const { jsonPath, mdPath } = (() => {
  try {
    return writeReport({
      outDir,
      scenario,
      profile,
      fingerprint,
      likeness,
      runs,
      signals,
      inventory,
      assertions,
      startedAt,
      finishedAt,
      commands,
      candidateSha,
      harnessRevisionSha,
    });
  } catch (error) {
    // writeReport refuses an incomplete target table (round-3 C1). Fail loudly
    // rather than emitting a report whose §1 is missing a Ticket 13 target.
    console.error(`[harness] refusing to write the report: ${error.message}`);
    process.exit(4);
  }
})();

const { counter, rows } = summariseVerdicts(runs);
console.log("");
console.log(`[harness] profile=${profile.name} claimsTarget=${profile.claimsTarget} productionLike=${likeness.productionLike}`);
console.log(`[harness] verdicts: ${JSON.stringify(counter)}`);
for (const row of rows) {
  console.log(`  - ${row.metric}: achieved=${row.achieved === null ? "n/a" : Math.round(row.achieved * 100) / 100} target=${row.target} => ${row.verdict}`);
}
console.log(`[harness] report: ${mdPath}`);
console.log(`[harness] raw:    ${jsonPath}`);

mkdirSync(path.dirname(jsonPath), { recursive: true });
process.exit(profile.claimsTarget && (counter.FAIL ?? 0) > 0 ? 1 : 0);
