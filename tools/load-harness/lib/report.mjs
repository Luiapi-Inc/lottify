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
      });
    }
  }
  return { counter, rows };
}

export function buildMarkdownReport({ scenario, profile, fingerprint, likeness, runs, signals, inventory, assertions, startedAt, finishedAt, commands }) {
  const { counter, rows } = summariseVerdicts(runs);
  const candidate = fingerprint.candidate;
  const lines = [];
  lines.push(`# Load / performance harness report — ${scenario.id} (${profile.name} profile)`);
  lines.push("");
  lines.push(`- Candidate: \`${candidate.sha ?? "unknown"}\` (branch \`${candidate.branch ?? "?"}\`, worktree dirty: ${candidate.worktreeDirty})`);
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
  if (!profile.claimsTarget) {
    lines.push("");
    lines.push(
      `> This profile does not claim the Ticket 13 targets. Every row below is evidence about the harness and about this environment only; PASS/FAIL for capacity cannot come from a \`${profile.name}\` run.`,
    );
  }
  lines.push("");
  lines.push("## 1. Target-by-target result");
  lines.push("");
  lines.push("| Metric | Driver | Target | Achieved | Verdict |");
  lines.push("|---|---|---|---|---|");
  for (const row of rows) {
    lines.push(`| ${row.metric} | ${row.driver} | ${row.target} | ${formatValue(row.achieved)} | ${row.verdict} |`);
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

export function writeReport({ outDir, scenario, profile, fingerprint, likeness, runs, signals, inventory, assertions, startedAt, finishedAt, commands }) {
  const sha = (fingerprint.candidate.sha ?? "unknown").slice(0, 12);
  const base = path.join(outDir, `load-harness-${scenario.id}-${profile.name}-${sha}`);
  mkdirSync(outDir, { recursive: true });
  const jsonPath = `${base}.json`;
  const mdPath = `${base}.md`;
  const payload = {
    scenario: { id: scenario.id, version: scenario.version, sourceOfTruth: scenario.sourceOfTruth, card: scenario.card, mix: scenario.mix, burst: scenario.burst },
    profile: { name: profile.name, claimsTarget: profile.claimsTarget, purpose: profile.purpose },
    targets: scenario.targets,
    candidate: fingerprint.candidate,
    environment: fingerprint,
    productionLikeAssessment: likeness,
    startedAt,
    finishedAt,
    runs,
    requiredSignals: signals,
    metricInventory: inventory,
    financialAssertions: assertions ?? null,
    reproductionCommands: commands,
    phase: "draft",
  };
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  writeFileSync(
    mdPath,
    buildMarkdownReport({ scenario, profile, fingerprint, likeness, runs, signals, inventory, assertions, startedAt, finishedAt, commands }),
    "utf8",
  );
  return { jsonPath, mdPath };
}
