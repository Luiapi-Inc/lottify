#!/usr/bin/env node
/**
 * Release identity gate for the Lottify deploy pipeline.
 *
 * Records the identity of what is serving production as `runtime/release-sha`
 * (+ `runtime/release-identity.json`) and refuses to record an identity that is
 * not traceable back to a pushed, CI-green commit.
 *
 * Requirement source: audit finding F9 (production `runtime/release-sha` was
 * `f646103441211511ec3f89fd6046ce474d7d125a`, which is not a Git object in this
 * repository, and the serving images were tagged with short SHAs that resolve to
 * no commit at all).
 *
 * Legs, all fail-closed (a leg that cannot be proven is reported UNVERIFIED and
 * makes the command exit non-zero):
 *   1. resolvable   - `git cat-file -e <sha>^{commit}` in the pushed clone
 *   2. pushed       - <sha> is an ancestor of the pushed ref (default origin/main)
 *   3. ci-green     - required checks completed/success for that exact SHA
 *   4. image        - optional: running container image digest matches the record
 *
 * The tool never mutates a deployment target unless `stamp --apply` is passed,
 * and never runs Docker, reloads a reverse proxy, or changes traffic.
 *
 * Usage:
 *   node infra/deploy/release-identity.mjs resolve <ref> [--repo <path>]
 *   node infra/deploy/release-identity.mjs plan  --repo <path> --candidate-sha <sha40>
 *         [--candidate-image <name@sha256:...>] [--release-tag <tag>]
 *         [--ci-evidence <file>] [--pushed-ref origin/main]
 *         [--require-checks verify,container-smoke]
 *   node infra/deploy/release-identity.mjs stamp ... --runtime-dir <dir> [--apply]
 *   node infra/deploy/release-identity.mjs verify --repo <path> --runtime-dir <dir>
 *         [--ci-evidence <file>] [--expect-image-digest <sha256:...>]
 *
 * CI evidence artifact: the JSON body of
 *   gh api repos/<owner>/<repo>/commits/<sha>/check-runs
 * or a reduced summary `{ "head_sha": "<sha>", "checks": [{"name","conclusion"}] }`.
 * One artifact covers one exact SHA; evidence for another SHA is rejected.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EXIT_LEG_FAILED = 65;
export const EXIT_USAGE = 64;
export const DEFAULT_PUSHED_REF = "origin/main";
export const DEFAULT_REQUIRED_CHECKS = ["verify", "container-smoke"];
const SHA40 = /^[0-9a-f]{40}$/i;
const IMAGE_DIGEST = /@sha256:[0-9a-f]{64}$/i;

export function git(repoPath, args) {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryGit(repoPath, args) {
  try {
    return { ok: true, value: git(repoPath, args) };
  } catch (error) {
    const stderr = error && error.stderr ? String(error.stderr).trim() : String(error);
    return { ok: false, value: stderr };
  }
}

/** Leg 1: the value must name a commit object in the pushed clone. */
export function checkResolvable(repoPath, sha) {
  if (!SHA40.test(sha)) {
    return { leg: "resolvable", status: "FAIL", detail: `${sha} is not a 40-hex commit id` };
  }
  const res = tryGit(repoPath, ["cat-file", "-e", `${sha}^{commit}`]);
  return res.ok
    ? { leg: "resolvable", status: "PASS", detail: `git cat-file -t ${sha} -> commit` }
    : { leg: "resolvable", status: "FAIL", detail: `git cat-file: ${res.value}` };
}

/** Leg 2: the commit must be reachable from the pushed ref, not a dangling local object. */
export function checkPushed(repoPath, sha, pushedRef = DEFAULT_PUSHED_REF) {
  const object = tryGit(repoPath, ["cat-file", "-e", `${sha}^{commit}`]);
  if (!object.ok) {
    return { leg: "pushed", status: "FAIL", detail: `${sha} is not a commit object in ${repoPath}` };
  }
  const ref = tryGit(repoPath, ["rev-parse", "--verify", `${pushedRef}^{commit}`]);
  if (!ref.ok) {
    return { leg: "pushed", status: "FAIL", detail: `pushed ref ${pushedRef} does not resolve: ${ref.value}` };
  }
  const ancestor = tryGit(repoPath, ["merge-base", "--is-ancestor", sha, pushedRef]);
  if (!ancestor.ok) {
    return { leg: "pushed", status: "FAIL", detail: `${sha} is not an ancestor of ${pushedRef}` };
  }
  return { leg: "pushed", status: "PASS", detail: `${sha} is an ancestor of ${pushedRef} (${ref.value})` };
}

/** Parse a check-runs API body or a reduced summary into {head_sha, checks}. */
export function parseCiEvidence(raw) {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  let checks = [];
  if (Array.isArray(data.check_runs)) {
    checks = data.check_runs.map((run) => ({
      name: run.name,
      conclusion: run.conclusion,
      status: run.status,
      url: run.html_url ?? null,
      runId: run.id ?? null,
    }));
    // The raw `gh api .../commits/<sha>/check-runs` body carries head_sha on
    // each check_run, not at the top level. Derive it when top-level is absent.
    if (data.head_sha == null && data.headSha == null && checks.length > 0) {
      const derived = checks.map((c) => data.check_runs.find((r) => r.id === c.runId)?.head_sha).filter(Boolean);
      data.head_sha = derived.length > 0 ? derived[0] : null;
    }
  } else if (Array.isArray(data.checks)) {
    checks = data.checks.map((check) => ({
      name: check.name,
      conclusion: check.conclusion ?? null,
      status: check.status ?? "completed",
      url: check.url ?? null,
      runId: check.runId ?? null,
    }));
  } else {
    throw new Error("CI evidence has neither check_runs nor checks");
  }
  return { headSha: data.head_sha ?? data.headSha ?? null, checks, runId: data.githubRunId ?? data.run_id ?? null };
}

/** Leg 3: every required check ran against this exact SHA and concluded success. */
export function checkCiGreen(ci, sha, requiredChecks = DEFAULT_REQUIRED_CHECKS) {
  if (!ci) {
    return { leg: "ci-green", status: "UNVERIFIED", detail: "no CI evidence artifact supplied or fetchable" };
  }
  if (ci.headSha && ci.headSha.toLowerCase() !== sha.toLowerCase()) {
    return {
      leg: "ci-green",
      status: "FAIL",
      detail: `evidence is for ${ci.headSha}, not for the stamped candidate ${sha}`,
    };
  }
  if (!ci.headSha) {
    return { leg: "ci-green", status: "FAIL", detail: "evidence carries no head_sha; it cannot bind the candidate" };
  }
  const byName = new Map(ci.checks.map((check) => [check.name, check]));
  const problems = [];
  for (const name of requiredChecks) {
    const check = byName.get(name);
    if (!check) {
      problems.push(`${name}: missing`);
      continue;
    }
    const completed = (check.status ?? "completed") === "completed";
    if (!completed || check.conclusion !== "success") {
      problems.push(`${name}: ${check.conclusion ?? check.status}`);
    }
  }
  if (problems.length > 0) {
    return { leg: "ci-green", status: "FAIL", detail: problems.join("; ") };
  }
  return {
    leg: "ci-green",
    status: "PASS",
    detail: `${requiredChecks.join("+")} success on ${sha}`,
    runId: ci.runId ?? null,
  };
}

/** Load CI evidence from a file; `-` reads stdin. Returns null when no path given. */
export function loadCiEvidence(path) {
  if (!path) return null;
  const raw = path === "-" ? readFileSync(0, "utf8") : readFileSync(path, "utf8");
  return parseCiEvidence(raw);
}

/**
 * Evaluate every identity leg for a candidate. `allowUnverifiedCi` keeps the
 * result non-blocking but the identity is then explicitly marked unverified and
 * must never be reported as a release-ready identity.
 */
export function evaluateIdentity({ repo, sha, pushedRef, ci, requiredChecks, image, allowUnverifiedCi = false }) {
  const legs = [checkResolvable(repo, sha), checkPushed(repo, sha, pushedRef), checkCiGreen(ci, sha, requiredChecks)];
  if (image) {
    legs.push(
      IMAGE_DIGEST.test(image)
        ? { leg: "image-digest", status: "PASS", detail: `${image} is an immutable OCI digest reference` }
        : { leg: "image-digest", status: "FAIL", detail: `${image} is not an immutable @sha256 digest reference` },
    );
  }
  const failed = legs.filter((leg) => leg.status === "FAIL");
  const unverified = legs.filter((leg) => leg.status === "UNVERIFIED");
  const ok = failed.length === 0 && (unverified.length === 0 || allowUnverifiedCi);
  return { ok, legs, failed, unverified };
}

export function buildRecord({ sha, repo, image, releaseTag, evaluation, stampedAt }) {
  const ciLeg = evaluation.legs.find((leg) => leg.leg === "ci-green");
  return {
    schemaVersion: 1,
    sourceCommit: sha,
    sourceRepo: repo,
    releaseTag: releaseTag ?? null,
    backendImage: image ?? null,
    ci: { status: ciLeg.status, detail: ciLeg.detail, runId: ciLeg.runId ?? null },
    legs: evaluation.legs,
    status: evaluation.ok ? (evaluation.unverified.length === 0 ? "VERIFIED" : "UNVERIFIED-CI") : "REJECTED",
    stampedAt,
  };
}

export function readRuntimeIdentity(runtimeDir) {
  const shaPath = join(runtimeDir, "release-sha");
  if (!existsSync(shaPath)) {
    return { sha: null, reason: `${shaPath} does not exist` };
  }
  const sha = readFileSync(shaPath, "utf8").trim();
  const recordPath = join(runtimeDir, "release-identity.json");
  let record = null;
  let recordReason = null;
  if (existsSync(recordPath)) {
    try {
      record = JSON.parse(readFileSync(recordPath, "utf8"));
    } catch (error) {
      recordReason = `${recordPath} is not valid JSON: ${error.message}`;
    }
  } else {
    recordReason = `${recordPath} does not exist`;
  }
  return { sha, record, recordReason };
}

/** Write release-sha + release-identity.json atomically (same-dir temp + rename). */
export function writeRuntimeIdentity(runtimeDir, sha, record) {
  for (const [name, body] of [
    ["release-sha", `${sha}\n`],
    ["release-identity.json", `${JSON.stringify(record, null, 2)}\n`],
  ]) {
    const target = join(runtimeDir, name);
    const tmp = `${target}.tmp-${process.pid}`;
    writeFileSync(tmp, body, { mode: 0o644 });
    renameSync(tmp, target);
  }
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "-h" || token === "--help") return { help: true };
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) args[key] = true;
      else {
        args[key] = value;
        i += 1;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

function usage() {
  console.log(
    [
      "release-identity.mjs <resolve|plan|stamp|verify> [options]",
      "",
      "  resolve <ref> [--repo <path>]",
      "  plan  --repo <path> --candidate-sha <sha40> [--candidate-image <name@sha256:...>]",
      "        [--release-tag <tag>] [--ci-evidence <file|->] [--pushed-ref origin/main]",
      "        [--require-checks verify,container-smoke] [--allow-unverified-ci]",
      "  stamp  <same as plan> --runtime-dir <dir> [--apply]",
      "  verify --repo <path> --runtime-dir <dir> [--ci-evidence <file|->]",
      "        [--expect-image-digest <sha256:...>] [--require-checks ...]",
    ].join("\n"),
  );
}

function printLegs(legs) {
  for (const leg of legs) {
    console.log(`${leg.status.padEnd(11)} ${leg.leg.padEnd(14)} ${leg.detail}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(EXIT_USAGE);
}

export function main(argv, { now = () => new Date().toISOString() } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    usage();
    return 0;
  }
  const command = args._[0];
  const repo = resolve(String(args.repo ?? process.cwd()));
  const pushedRef = String(args["pushed-ref"] ?? DEFAULT_PUSHED_REF);
  const requiredChecks = String(args["require-checks"] ?? DEFAULT_REQUIRED_CHECKS.join(","))
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const allowUnverifiedCi = Boolean(args["allow-unverified-ci"]);

  if (!command) fail("missing command");
  if (!existsSync(join(repo, ".git"))) fail(`--repo ${repo} is not a Git worktree`);

  if (command === "resolve") {
    const ref = args._[1];
    if (!ref) fail("resolve requires a ref");
    const res = tryGit(repo, ["rev-parse", "--verify", `${ref}^{commit}`]);
    if (!res.ok) {
      console.error(`FAIL resolvable    ${ref}: ${res.value}`);
      return EXIT_LEG_FAILED;
    }
    const sha = git(repo, ["rev-parse", `${ref}^{commit}`]);
    const type = git(repo, ["cat-file", "-t", sha]);
    console.log(JSON.stringify({ ref, sha, type }, null, 2));
    return 0;
  }

  if (command === "plan" || command === "stamp") {
    const sha = String(args["candidate-sha"] ?? "").trim();
    if (!sha) fail(`${command} requires --candidate-sha`);
    const image = args["candidate-image"] ? String(args["candidate-image"]) : null;
    const evaluation = evaluateIdentity({
      repo,
      sha,
      pushedRef,
      ci: loadCiEvidence(args["ci-evidence"] ? String(args["ci-evidence"]) : null),
      requiredChecks,
      image,
      allowUnverifiedCi,
    });
    printLegs(evaluation.legs);
    const record = buildRecord({
      sha,
      repo,
      image,
      releaseTag: args["release-tag"] ? String(args["release-tag"]) : null,
      evaluation,
      stampedAt: now(),
    });
    console.log(JSON.stringify(record, null, 2));

    if (!evaluation.ok) {
      console.error(`REFUSED: release identity for ${sha} is not traceable (${evaluation.failed.length} failed, ${evaluation.unverified.length} unverified leg(s))`);
      return EXIT_LEG_FAILED;
    }
    if (command === "plan") return 0;

    const runtimeDir = args["runtime-dir"] ? String(args["runtime-dir"]) : null;
    if (!runtimeDir) fail("stamp requires --runtime-dir");
    if (!existsSync(runtimeDir)) fail(`--runtime-dir ${runtimeDir} does not exist`);
    if (args.apply !== true) {
      console.log(`DRY-RUN: would write ${join(runtimeDir, "release-sha")} = ${sha}`);
      console.log(`DRY-RUN: would write ${join(runtimeDir, "release-identity.json")}`);
      return 0;
    }
    writeRuntimeIdentity(runtimeDir, sha, record);
    console.log(`WROTE ${join(runtimeDir, "release-sha")} = ${sha}`);
    console.log(`WROTE ${join(runtimeDir, "release-identity.json")} (status ${record.status})`);
    return 0;
  }

  if (command === "verify") {
    const runtimeDir = args["runtime-dir"] ? String(args["runtime-dir"]) : null;
    if (!runtimeDir) fail("verify requires --runtime-dir");
    const identity = readRuntimeIdentity(runtimeDir);
    if (!identity.sha) {
      console.error(`FAIL runtime-identity ${identity.reason}`);
      return EXIT_LEG_FAILED;
    }
    const legs = [checkResolvable(repo, identity.sha), checkPushed(repo, identity.sha, pushedRef)];
    let ci = null;
    const evidencePath = args["ci-evidence"] ? String(args["ci-evidence"]) : null;
    if (evidencePath) {
      ci = loadCiEvidence(evidencePath);
    } else if (identity.record?.sourceCommit?.toLowerCase() === identity.sha.toLowerCase() && identity.record?.ci?.raw) {
      ci = parseCiEvidence(identity.record.ci.raw);
    }
    legs.push(checkCiGreen(ci, identity.sha, requiredChecks));
    if (identity.recordReason) {
      legs.push({ leg: "identity-record", status: "FAIL", detail: identity.recordReason });
    } else {
      legs.push({ leg: "identity-record", status: "PASS", detail: `${join(runtimeDir, "release-identity.json")} present` });
      const expected = args["expect-image-digest"] ? String(args["expect-image-digest"]) : null;
      if (expected && identity.record?.backendImage !== expected) {
        legs.push({
          leg: "image-digest",
          status: "FAIL",
          detail: `recorded ${identity.record?.backendImage ?? "none"} != running ${expected}`,
        });
      } else if (expected) {
        legs.push({ leg: "image-digest", status: "PASS", detail: `recorded image matches running ${expected}` });
      }
    }
    console.log(`release-sha = ${identity.sha}`);
    printLegs(legs);
    const bad = legs.filter((leg) => leg.status !== "PASS");
    if (bad.length > 0) {
      console.error(`untraceable release identity: ${bad.map((leg) => `${leg.leg}=${leg.status}`).join(", ")}`);
      return EXIT_LEG_FAILED;
    }
    console.log("release identity is traceable to a pushed, CI-green commit");
    return 0;
  }

  fail(`unknown command: ${command}`);
}

export function selfTestFixtures() {
  const dir = mkdtempSync(join(tmpdir(), "release-identity-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
