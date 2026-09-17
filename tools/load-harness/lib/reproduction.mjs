// Reproduction commands printed into every report (§6).
//
// Review round 3 finding C2: run.mjs emitted `boot-api.sh --base-url <url>`, but
// boot-api.sh accepts only `--port` / `--stop` (`unknown argument: --base-url`,
// exit 2). The report's own "reproduce this" block therefore failed at step 2, so
// the artifact was not reproducible as printed. The commands are now built from
// the base URL the run actually drove, and are exercised by a unit test that
// executes the printed boot step.

import path from "node:path";
import process from "node:process";

/**
 * The suffix of the dedicated load database, when the harness can see it. Every
 * database the harness creates is named `lottify_load_<suffix>`, so the printed
 * teardown command can carry the real suffix instead of a `<card-id>`
 * placeholder — a reproduction block a reviewer cannot run verbatim is not a
 * reproduction block.
 */
export function databaseSuffixFromUrl(databaseUrl) {
  if (!databaseUrl) return null;
  try {
    const url = new URL(String(databaseUrl));
    const database = url.pathname.replace(/^\//, "");
    const match = /^lottify_load_(.+)$/.exec(database);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * The port boot-api.sh must listen on for `baseUrl` to be reachable. boot-api.sh
 * takes a port, never a URL, so the port is derived from the URL the harness
 * drove. Returns null only when the URL cannot be parsed at all.
 */
export function portFromBaseUrl(baseUrl) {
  try {
    const url = new URL(String(baseUrl));
    if (url.port) return url.port;
    return url.protocol === "https:" ? "443" : "80";
  } catch {
    return null;
  }
}

/**
 * Builds the ordered, copy-pasteable reproduction block. Every command is
 * runnable as printed: boot-api.sh gets `--port <portFromBaseUrl(baseUrl)>`, and
 * the verification/teardown steps use the harness's own scripts.
 */
export function buildReproductionCommands({
  scenarioId,
  profileName,
  baseUrl,
  manifestPath = null,
  repoRoot = process.cwd(),
  candidateSha = null,
  databaseUrl = null,
}) {
  const relativeManifest = manifestPath ? path.relative(repoRoot, manifestPath) : "…";
  const port = portFromBaseUrl(baseUrl);
  const suffix = databaseSuffixFromUrl(databaseUrl);
  const bootCommand =
    port === null
      ? `bash tools/load-harness/scripts/boot-api.sh   # pass --port <the port in ${baseUrl}>`
      : `bash tools/load-harness/scripts/boot-api.sh --port ${port}`;
  const reportGlob = `.hermes/evidence/release/load-harness-${scenarioId}-${profileName}-*.json`;
  const expectedSha = candidateSha ? String(candidateSha).slice(0, 12) : null;
  const dropCommand = suffix
    ? `LOAD_DB_SUFFIX=${suffix} bash tools/load-harness/scripts/scratch-db.sh --drop`
    : "LOAD_DB_SUFFIX=<the suffix you created in step 1> bash tools/load-harness/scripts/scratch-db.sh --drop";

  return [
    "# 0. create the dedicated load database (prints LOAD_DATABASE_URL; export it before step 1)",
    suffix
      ? `bash tools/load-harness/scripts/scratch-db.sh --suffix ${suffix}`
      : "bash tools/load-harness/scripts/scratch-db.sh --suffix <your-card-id>",
    "# 1. fixtures in that database (test-scoped seeding; never against production)",
    `pnpm load:seed --profile ${profileName} --manifest ${relativeManifest} --database-url "$LOAD_DATABASE_URL"`,
    `# 2. boot the candidate API on the port this report drove (${baseUrl}); boot-api.sh takes --port, not --base-url`,
    bootCommand,
    "# 3. run the scenario (same profile, base URL and manifest as this report)",
    `node tools/load-harness/run.mjs --profile ${profileName} --base-url ${baseUrl} --manifest ${relativeManifest}`,
    "# 4. verify the artifact names the candidate under test",
    `node tools/load-harness/scripts/assert-report.mjs "$(ls -t ${reportGlob} | head -1)"${expectedSha ? ` ${expectedSha}` : ""}`,
    "# 5. stop the API, remove the fixture rows and drop the load database",
    port === null
      ? "bash tools/load-harness/scripts/boot-api.sh --stop"
      : `bash tools/load-harness/scripts/boot-api.sh --port ${port} --stop`,
    `pnpm load:seed -- --manifest ${relativeManifest} --database-url "$LOAD_DATABASE_URL" --cleanup`,
    dropCommand,
  ];
}
