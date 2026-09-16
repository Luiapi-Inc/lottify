// Durable report writer for the load harness.
//
// A report is only useful if it is bound to (a) the immutable candidate, (b) the
// environment it was measured on, (c) the scenario identity, and (d) the raw
// samples behind every number. All four are written, and every Ticket 13 target
// gets a row with its achieved value plus an explicit verdict. Missing evidence
// is written as NOT_MEASURED / ENV_GATED — never omitted and never approximated.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { round } from "./stats.mjs";
import { coverageSummary, assertTargetCoverage } from "./coverage.mjs";

export const VERDICT_PRIORITY = {
  FAIL: 0,
  PASS: 1,
  MEASURED: 2,
  ENV_GATED: 3,
  NOT_MEASURED: 4,
};

function formatValue(value) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") return String(round(value, 2));
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function summariseVerdicts(runs) {
  const counter = { PASS: 0, FAIL: 0, MEASURED: 0, NOT_MEASURED: 0, ENV_GATED: 0 };
  const rows = [];
  for (const run of runs) {
    for (const [metric, result] of Object.entries(run.measurements ?? {})) {
      counter[result.verdict] = (counter[result.verdict] ?? 0) + 1;
      rows.push({
        metric,
        driver: run.id,
        target: JSON.stringify(result.target),
        achieved: result.achieved,
        verdict: result.verdict,
        reason: result.reason ?? null,
        // `achieved` is a boolean for the property-style targets (once-only
        // financial effect, idempotent resume), where "true" means the target's
        // required property HOLDS and "false" means it is violated. Without this
        // label, `duplicate_financial_effect_under_load | target {"allowed":false}
        // | achieved true` reads as if the run had achieved something it must not.
        achievedMeaning: result.achievedMeaning ?? null,
      });
    }
  }
  return { counter, rows };
}

/**
 * The once-only financial-effect claim ("no duplicate financial effect under
 * load") is only evidence over a NON-EMPTY population. A report whose assertion
 * examined zero Orders must never be accepted as proof, so the CI binding check
 * rejects it as well (review round 2 finding B1: `state === "CONFIRMED"`
 * filtering over an already-SETTLED population produced counters that were
 * 0-over-zero and read as a pass).
 *
 * Returns a list of failure strings; an empty list means the report carries
 * real once-only evidence.
 */
export function onceOnlyEvidenceFailures(runs) {
  const failures = [];
  const carrying = (runs ?? []).filter((run) => run?.measurements?.duplicate_financial_effect_under_load);
  if (carrying.length === 0) {
    failures.push("no run carries the duplicate_financial_effect_under_load measurement");
    return failures;
  }
  for (const run of carrying) {
    const measurement = run.measurements.duplicate_financial_effect_under_load;
    if (measurement.achieved === null || measurement.verdict === "NOT_MEASURED") {
      failures.push(`run ${run.id}: the once-only financial-effect assertion is not measured, so it proves nothing`);
      continue;
    }
    const examined = measurement.examinedPopulation;
    if (typeof examined !== "number" || examined <= 0) {
      failures.push(
        `run ${run.id}: the once-only financial-effect assertion examined ${examined ?? "no"} stake-committed Order(s) — an empty population is not evidence`,
      );
    }
    if (measurement.duplicateEffectsFound !== 0) {
      const found = measurement.duplicateEffectsFound;
      failures.push(
        `run ${run.id}: duplicate financial effects found (${found === undefined || found === null ? "not reported by this report" : found})`,
      );
    }
  }
  return failures;
}

export function buildMarkdownReport({ scenario, profile, fingerprint, likeness, runs, signals, inventory, assertions, startedAt, finishedAt, commands, candidateSha = null, harnessRevisionSha = null }) {
  const { counter, rows } = summariseVerdicts(runs);
  const candidate = fingerprint.candidate;
  const lines = [];
  lines.push(`# Load / performance harness report — ${scenario.id} (${profile.name} profile)`);
  lines.push("");
  lines.push(`- Candidate under test: \`${candidateSha ?? candidate.sha ?? "unknown"}\``);
  lines.push(
    `- Harness revision that produced this report: \`${harnessRevisionSha ?? candidate.sha ?? "unknown"}\` (branch \`${candidate.branch ?? "?"}\`, tracked tree modified: ${candidate.worktreeDirty}, untracked files: ${candidate.untrackedFiles ?? "?"})`,
  );
  lines.push(`- Scenario: \`${scenario.id}\` v${scenario.version}, source \`${scenario.sourceOfTruth}\`, card ${scenario.card}`);
  lines.push(`- Profile: \`${profile.name}\` (claimsTarget=${profile.claimsTarget}) — ${profile.purpose}`);
  lines.push(`- Started: ${startedAt} · Finished: ${finishedAt}`);
  lines.push(`- Production-like environment: **${likeness.productionLike ? "YES" : "NO"}**`);
  if (!likeness.productionLike) {
    lines.push(`  - ${likeness.failures.join("\n  - ")}`);
  }
  lines.push(
    `- Verdicts: PASS ${counter.PASS ?? 0} · FAIL ${counter.FAIL ?? 0} · MEASURED ${counter.MEASURED ?? 0} · NOT_MEASURED ${counter.NOT_MEASURED ?? 0} · ENV_GATED ${counter.ENV_GATED ?? 0}`,
  );
  // Every key of scenario.targets must appear as a row. A target with no
  // measurement path is a declared NOT_MEASURED row, never an absent one, so the
  // headline counter can never understate the unproven set (review round 3 C1).
  const coverage = coverageSummary(scenario.targets, runs);
  lines.push(
    `- Ticket 13 target coverage: **${coverage.driverBacked}/${coverage.totalTargets} driver-backed** rows` +
      ` · **${coverage.unproven.length}/${coverage.totalTargets} still unproven** (no achieved value: ${coverage.unproven.join(", ") || "none"})` +
      ` · ${coverage.declaredUnmeasured.length} of ${coverage.totalTargets} declared NOT_MEASURED with a reason` +
      ` (${coverage.declaredUnmeasured.join(", ") || "none"}) · ${rows.length} rows in §1`,
  );
  lines.push(
    "  - `driver-backed` counts rows a driver produced, and a driver can produce a NOT_MEASURED row " +
      "(the payment-events driver does, because the candidate exposes no authenticated ingress), so the " +
      "unproven count — not the driver-backed count — is the number of Ticket 13 targets with no achieved value.",
  );
  // `missing` is only ever non-empty if the pre-write coverage guard was bypassed.
  if (coverage.missing.length > 0) {
    lines.push(`- \u26a0 targets with no row at all: ${coverage.missing.join(", ")}`);
  }
  if (!profile.claimsTarget) {
    lines.push("");
    lines.push(
      `> This profile does not claim the Ticket 13 targets. Every row below is evidence about the harness and about this environment only; PASS/FAIL for capacity cannot come from a \`${profile.name}\` run.`,
    );
  }
  lines.push("");
  lines.push("## 1. Target-by-target result");
  lines.push("");
  lines.push("| Metric | Driver | Target | Achieved | Verdict | Note |");
  lines.push("|---|---|---|---|---|---|");
  for (const row of rows) {
    lines.push(
      `| ${row.metric} | ${row.driver} | ${row.target} | ${formatValue(row.achieved)} | ${row.verdict} | ${row.reason ?? "-"} |`,
    );
  }
  lines.push("");
  lines.push(
    "`achieved` is a value for capacity/latency targets and a boolean for property targets " +
      "(`settlement_idempotent_resume`, `settlement_no_member_visible_partial_completion`, " +
      "`duplicate_financial_effect_under_load`), where `true` means the required property HOLDS " +
      "and `false` means it is violated — e.g. `duplicate_financial_effect_under_load` has " +
      "`target {\"allowed\":false}`, so `achieved true` means \"no duplicate was observed\", not \"a duplicate was achieved\".",
  );
  if (coverage.declaredUnmeasured.length > 0) {
    lines.push("");
    lines.push(
      `Targets with no measurement path (${coverage.declaredUnmeasured.length}/${coverage.totalTargets}), reported as NOT_MEASURED rather than omitted: ` +
        coverage.declaredUnmeasured.map((key) => `\`${key}\``).join(", ") +
        ". Their reasons are in the Note column above; the metric-family inventory in §4 is the evidence of absence.",
    );
  }
  lines.push("");
  lines.push("## 2. Environment fingerprint");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(fingerprint, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## 3. Per-driver detail");
  for (const run of runs) {
    lines.push("");
    lines.push(`### ${run.id} — ${run.name}`);
    lines.push("");
    lines.push(`- driver: \`${run.driver}\`, measured: ${run.measured}, envGated: ${run.envGated}`);
    lines.push(`- requested: \`${JSON.stringify(run.requested)}\``);
    for (const note of run.notes ?? []) lines.push(`- note: ${note}`);
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(run.samples ?? {}, null, 2).slice(0, 12000));
    lines.push("```");
  }
  lines.push("");
  lines.push("## 4. Required observability signals");
  lines.push("");
  lines.push("| Signal | Purpose | Available | Matched families |");
  lines.push("|---|---|---|---|");
  for (const signal of signals) {
    lines.push(
      `| ${signal.id} | ${signal.purpose} | ${signal.available ? "yes" : "NO"} | ${signal.matchedFamilies.join(", ") || "-"} |`,
    );
  }
  lines.push("");
  lines.push("Observed metric-family inventory (evidence of absence for the NO rows):");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(inventory, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## 5. Financial-effect assertions (independent SQL)");
  lines.push("");
  if (!assertions) {
    lines.push("Not run for this profile/manifest (no settlement dataset).");
  } else {
    lines.push(`- assertions measured: ${assertions.measured}`);
    for (const [name, value] of Object.entries(assertions.checks ?? {})) {
      lines.push(`- ${name}: \`${JSON.stringify(value)}\``);
    }
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(assertions.samples ?? {}, null, 2).slice(0, 12000));
    lines.push("```");
  }
  lines.push("");
  lines.push("## 6. Reproduction");
  lines.push("");
  lines.push("```bash");
  for (const command of commands) lines.push(command);
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

/**
 * Extra soundness checks evaluated BEFORE the report is written to disk, using
 * the same rules the CI binding step applies (`scripts/assert-report.mjs`).
 *
 * Why before, and not only after: the report path is deterministic
 * (`load-harness-<scenario>-<profile>-<candidate>.{md,json}`), so a re-run of the
 * same profile + candidate overwrites the artifact. Review round 4 showed that a
 * re-run which failed to reach its load database (its `LOAD_DATABASE_URL` was not
 * exported, so it fell back to the shared dev URL) still wrote a report over the
 * previously delivered one. Its content was all-NOT_MEASURED, so the CI check
 * would have rejected it — but by then the delivered artifact was gone from disk.
 * Refusing to write an unsound report keeps the last sound artifact in place.
 *
 * The checks:
 *  - both halves must name the candidate under test (or the artifact is not
 *    bound to the thing it claims to measure);
 *  - a report that carries assertion-derived settlement evidence must also carry
 *    non-empty once-only financial-effect evidence. A run set with no settlement
 *    evidence at all (`--only member-sessions`, say) is a partial drill and is
 *    not blocked here.
 */
export function reportWriteBlockers({ markdown, candidateSha, runs }) {
  const failures = [];
  if (candidateSha && markdown && !markdown.includes(`Candidate under test: \`${candidateSha}\``)) {
    failures.push(`the markdown report does not name ${candidateSha} as the candidate under test`);
  }
  const carriesSettlementEvidence = (runs ?? []).some(
    (run) => run?.measurements?.settlement_capacity_bet_lines !== undefined,
  );
  if (carriesSettlementEvidence) {
    failures.push(...onceOnlyEvidenceFailures(runs));
  }
  return failures;
}

export function writeReport({ outDir, scenario, profile, fingerprint, likeness, runs, signals, inventory, assertions, startedAt, finishedAt, commands, candidateSha = null, harnessRevisionSha = null }) {
  // Refuse to write a report that does not account for every Ticket 13 target:
  // a missing row is the round-3 C1 defect (the headline counter then understates
  // the unproven set). run.mjs appends the coverage run before this point.
  assertTargetCoverage(scenario.targets, runs);
  const coverage = coverageSummary(scenario.targets, runs);
  const sha = (candidateSha ?? fingerprint.candidate.sha ?? "unknown").slice(0, 12);
  const base = path.join(outDir, `load-harness-${scenario.id}-${profile.name}-${sha}`);
  mkdirSync(outDir, { recursive: true });
  const jsonPath = `${base}.json`;
  const mdPath = `${base}.md`;
  // Build and validate both halves BEFORE touching the filesystem: nothing is
  // written when the report would be rejected (review round 4 clobber note).
  const markdown = buildMarkdownReport({ scenario, profile, fingerprint, likeness, runs, signals, inventory, assertions, startedAt, finishedAt, commands, candidateSha, harnessRevisionSha });
  const blockers = reportWriteBlockers({ markdown, candidateSha: candidateSha ?? fingerprint.candidate.sha ?? null, runs });
  if (blockers.length > 0) {
    throw new Error(`the report would not satisfy the binding checks, so it was not written:\n  - ${blockers.join("\n  - ")}`);
  }
  const payload = {
    scenario: { id: scenario.id, version: scenario.version, sourceOfTruth: scenario.sourceOfTruth, card: scenario.card, mix: scenario.mix, burst: scenario.burst },
    profile: { name: profile.name, claimsTarget: profile.claimsTarget, purpose: profile.purpose },
    targets: scenario.targets,
    candidate: { sha: candidateSha ?? fingerprint.candidate.sha, harnessRevisionSha: harnessRevisionSha ?? fingerprint.candidate.sha, branch: fingerprint.candidate.branch, worktreeDirty: fingerprint.candidate.worktreeDirty },
    environment: fingerprint,
    productionLikeAssessment: likeness,
    startedAt,
    finishedAt,
    runs,
    requiredSignals: signals,
    metricInventory: inventory,
    targetCoverage: coverage,
    financialAssertions: assertions ?? null,
    reproductionCommands: commands,
    phase: "draft",
  };
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  writeFileSync(mdPath, markdown, "utf8");
  return { jsonPath, mdPath };
}
