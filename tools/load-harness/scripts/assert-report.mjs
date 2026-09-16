#!/usr/bin/env node
// Verifies that a load-harness report really is bound to the candidate under
// test. Used by the CI smoke job so a report that names the wrong revision
// fails the build instead of shipping as evidence.
//
// Usage: node tools/load-harness/scripts/assert-report.mjs <report.json> [expectedSha]
// Exit 0 = bound and complete, 1 = not bound, 2 = usage.

import { readFileSync } from "node:fs";

import { summariseVerdicts, onceOnlyEvidenceFailures } from "../lib/report.mjs";
import { targetCoverageFailures } from "../lib/coverage.mjs";

const [jsonPath, expectedSha] = process.argv.slice(2);
if (!jsonPath) {
  console.error("usage: assert-report.mjs <report.json> [expectedSha]");
  process.exit(2);
}

const report = JSON.parse(readFileSync(jsonPath, "utf8"));
const mdPath = jsonPath.replace(/\.json$/, ".md");
const markdown = readFileSync(mdPath, "utf8");

const failures = [];
const candidateSha = report?.candidate?.sha ?? null;
const harnessSha = report?.candidate?.harnessRevisionSha ?? null;

if (!candidateSha) {
  failures.push(`${jsonPath}: candidate.sha is missing`);
}
if (expectedSha && !candidateSha?.startsWith(expectedSha)) {
  failures.push(`candidate.sha is ${candidateSha}, expected ${expectedSha}`);
}
if (!markdown.includes(`Candidate under test: \`${candidateSha}\``)) {
  failures.push(`${mdPath}: markdown does not name the candidate (${candidateSha}) as the candidate under test`);
}
// Only meaningful when the harness commit differs from the candidate: inside CI
// the checkout IS the candidate, so both lines legitimately carry the same SHA.
if (harnessSha && harnessSha !== candidateSha && markdown.includes(`Candidate under test: \`${harnessSha}\``)) {
  failures.push(`${mdPath}: markdown names the harness revision (${harnessSha}) as the candidate`);
}
if (!report?.scenario?.id || !report?.profile?.name) {
  failures.push(`${jsonPath}: scenario/profile identity missing`);
}
if (!report?.environment?.candidate?.sha) {
  failures.push(`${jsonPath}: environment fingerprint is not bound to a revision`);
}
// A report must not be able to claim "no duplicate financial effect under load"
// from an assertion that examined an empty population.
failures.push(...onceOnlyEvidenceFailures(report.runs ?? []));

// Every Ticket 13 target must appear as a row (review round 3 finding C1): a
// target with no row cannot be distinguished from a target nobody considered,
// and the verdict counter then understates the unproven set.
const scenarioTargets = report?.targets ?? {};
if (Object.keys(scenarioTargets).length === 0) {
  failures.push(`${jsonPath}: the report carries no scenario targets, so target coverage cannot be verified`);
}
failures.push(...targetCoverageFailures(scenarioTargets, report.runs ?? []));

// The §6 reproduction block must be runnable as printed (review round 3 finding
// C2): boot-api.sh accepts --port/--stop only, so a printed `--base-url` fails.
// Review round 4 finding R2: the first pattern required whitespace before
// `boot-api.sh`, but the generator prints a path
// (`bash tools/load-harness/scripts/boot-api.sh …`), so the guard never matched
// the artifact it was written to protect. Match the script name at a path or a
// word boundary instead.
if (/(^|[\s/])boot-api\.sh\s+--base-url/.test(markdown)) {
  failures.push(`${mdPath}: the reproduction block boots the API with --base-url, which boot-api.sh rejects (it takes --port)`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`[assert-report] FAIL: ${failure}`);
  process.exit(1);
}

const { counter } = summariseVerdicts(report.runs ?? []);
const coverage = report?.targetCoverage ?? null;
console.log(`[assert-report] OK: report bound to candidate ${candidateSha} (harness revision ${harnessSha ?? "unknown"})`);
console.log(
  `[assert-report] verdicts: ${JSON.stringify(counter)} (${(report.runs ?? []).length} runs)` +
    (coverage ? ` · target coverage: ${coverage.driverBacked}/${coverage.totalTargets} driver-backed, ${coverage.declaredUnmeasured.length} NOT_MEASURED (${coverage.declaredUnmeasured.join(", ") || "none"})` : ""),
);
