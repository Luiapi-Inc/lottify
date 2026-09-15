import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Release identity gate (audit finding F9): `runtime/release-sha` on production
 * was `f646103441211511ec3f89fd6046ce474d7d125a`, which is not a Git object in
 * this repository. These tests pin the fail-closed behaviour of the pipeline
 * tool that now has to stamp and verify the release identity.
 */

const CLI = resolve(__dirname, "../../infra/deploy/release-identity.mjs");
const F9_BOGUS_SHA = "f646103441211511ec3f89fd6046ce474d7d125a";
const OTHER_SHA = "0123456789abcdef0123456789abcdef01234567";

type RunResult = { status: number; stdout: string; stderr: string };

function run(args: string[]): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: typeof failure.status === "number" ? failure.status : 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

let tmpRoot: string;
let repo: string;
let runtimeDir: string;
let candidate: string;

function writeEvidence(path: string, headSha: string, checks: Array<{ name: string; conclusion: string }>) {
  writeFileSync(path, JSON.stringify({ head_sha: headSha, check_runs: checks.map((check, index) => ({ ...check, status: "completed", id: 1000 + index })) }));
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "release-identity-spec-"));
  repo = join(tmpRoot, "repo");
  runtimeDir = join(tmpRoot, "runtime");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "a.txt"), "one\n");
  git(repo, ["add", "."]);
  git(repo, ["-c", "user.email=t@example.test", "-c", "user.name=t", "commit", "-q", "-m", "first"]);
  writeFileSync(join(repo, "a.txt"), "two\n");
  git(repo, ["add", "."]);
  git(repo, ["-c", "user.email=t@example.test", "-c", "user.name=t", "commit", "-q", "-m", "second"]);
  candidate = git(repo, ["rev-parse", "HEAD"]);
  mkdirSync(runtimeDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("release identity: resolve", () => {
  it("resolves a real commit to its full 40-hex id", () => {
    const result = run(["resolve", "HEAD", "--repo", repo]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).sha).toBe(candidate);
    expect(JSON.parse(result.stdout).type).toBe("commit");
  });

  it("refuses a value that is not a Git object", () => {
    const result = run(["resolve", F9_BOGUS_SHA, "--repo", repo]);
    expect(result.status).toBe(65);
    expect(result.stderr).toContain(F9_BOGUS_SHA);
    expect(result.stderr).toMatch(/Needed a single revision|could not get object info|Not a valid object name/);
  });
});

describe("release identity: plan (fail-closed)", () => {
  it("refuses a candidate with no CI evidence instead of stamping it", () => {
    const result = run(["plan", "--repo", repo, "--candidate-sha", candidate, "--pushed-ref", "main"]);
    expect(result.status).toBe(65);
    expect(result.stdout).toContain("UNVERIFIED");
    expect(result.stderr).toContain("REFUSED");
  });

  it("refuses the production F9 value", () => {
    const evidence = join(tmpRoot, "ci.json");
    writeEvidence(evidence, F9_BOGUS_SHA, [
      { name: "verify", conclusion: "success" },
      { name: "container-smoke", conclusion: "success" },
    ]);
    const result = run([
      "plan",
      "--repo",
      repo,
      "--candidate-sha",
      F9_BOGUS_SHA,
      "--pushed-ref",
      "main",
      "--ci-evidence",
      evidence,
    ]);
    expect(result.status).toBe(65);
    expect(result.stdout).toContain("FAIL");
  });

  it("refuses CI evidence that belongs to another commit", () => {
    const evidence = join(tmpRoot, "ci-other.json");
    writeEvidence(evidence, OTHER_SHA, [
      { name: "verify", conclusion: "success" },
      { name: "container-smoke", conclusion: "success" },
    ]);
    const result = run([
      "plan",
      "--repo",
      repo,
      "--candidate-sha",
      candidate,
      "--pushed-ref",
      "main",
      "--ci-evidence",
      evidence,
    ]);
    expect(result.status).toBe(65);
    expect(result.stdout).toContain("not for the stamped candidate");
  });

  it("refuses a candidate whose required check did not conclude success", () => {
    const evidence = join(tmpRoot, "ci-red.json");
    writeEvidence(evidence, candidate, [
      { name: "verify", conclusion: "failure" },
      { name: "container-smoke", conclusion: "success" },
    ]);
    const result = run([
      "plan",
      "--repo",
      repo,
      "--candidate-sha",
      candidate,
      "--pushed-ref",
      "main",
      "--ci-evidence",
      evidence,
    ]);
    expect(result.status).toBe(65);
    expect(result.stdout).toContain("verify: failure");
  });

  it("accepts a pushed commit with green evidence for the exact SHA", () => {
    const evidence = join(tmpRoot, "ci-green.json");
    writeEvidence(evidence, candidate, [
      { name: "verify", conclusion: "success" },
      { name: "container-smoke", conclusion: "success" },
    ]);
    const result = run([
      "plan",
      "--repo",
      repo,
      "--candidate-sha",
      candidate,
      "--pushed-ref",
      "main",
      "--ci-evidence",
      evidence,
      "--release-tag",
      "v0.0.0-test",
    ]);
    expect(result.status).toBe(0);
    const record = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
    expect(record.sourceCommit).toBe(candidate);
    expect(record.status).toBe("VERIFIED");
    expect(record.releaseTag).toBe("v0.0.0-test");
  });

  it("rejects an image reference that is not an immutable digest", () => {
    const evidence = join(tmpRoot, "ci-green2.json");
    writeEvidence(evidence, candidate, [
      { name: "verify", conclusion: "success" },
      { name: "container-smoke", conclusion: "success" },
    ]);
    const result = run([
      "plan",
      "--repo",
      repo,
      "--candidate-sha",
      candidate,
      "--pushed-ref",
      "main",
      "--ci-evidence",
      evidence,
      "--candidate-image",
      "ghcr.io/luiapi-sys/lottify_v3-backend:e75a16a",
    ]);
    expect(result.status).toBe(65);
    expect(result.stdout).toContain("not an immutable @sha256 digest reference");
  });
});

describe("release identity: stamp and verify", () => {
  const greenEvidence = () => {
    const evidence = join(tmpRoot, "ci-stamp.json");
    writeEvidence(evidence, candidate, [
      { name: "verify", conclusion: "success" },
      { name: "container-smoke", conclusion: "success" },
    ]);
    return evidence;
  };

  it("does not write anything without --apply", () => {
    const result = run([
      "stamp",
      "--repo",
      repo,
      "--candidate-sha",
      candidate,
      "--pushed-ref",
      "main",
      "--ci-evidence",
      greenEvidence(),
      "--runtime-dir",
      runtimeDir,
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("DRY-RUN");
    expect(existsSync(join(runtimeDir, "release-sha"))).toBe(false);
  });

  it("writes a traceable identity and then verifies it end to end", () => {
    const stamped = run([
      "stamp",
      "--repo",
      repo,
      "--candidate-sha",
      candidate,
      "--pushed-ref",
      "main",
      "--ci-evidence",
      greenEvidence(),
      "--runtime-dir",
      runtimeDir,
      "--apply",
    ]);
    expect(stamped.status).toBe(0);
    expect(readFileSync(join(runtimeDir, "release-sha"), "utf8").trim()).toBe(candidate);

    const verified = run([
      "verify",
      "--repo",
      repo,
      "--runtime-dir",
      runtimeDir,
      "--pushed-ref",
      "main",
      "--ci-evidence",
      greenEvidence(),
    ]);
    expect(verified.status).toBe(0);
    expect(verified.stdout).toContain("release identity is traceable to a pushed, CI-green commit");
  });

  it("fails verification for the production F9 identity", () => {
    writeFileSync(join(runtimeDir, "release-sha"), `${F9_BOGUS_SHA}\n`);
    writeFileSync(
      join(runtimeDir, "release-identity.json"),
      JSON.stringify({ schemaVersion: 1, sourceCommit: F9_BOGUS_SHA, status: "VERIFIED" }),
    );
    const result = run(["verify", "--repo", repo, "--runtime-dir", runtimeDir, "--pushed-ref", "main", "--ci-evidence", greenEvidence()]);
    expect(result.status).toBe(65);
    expect(result.stdout).toContain("resolvable");
    expect(result.stdout).toContain("not a commit object");
  });

  it("fails verification when the identity record is missing", () => {
    writeFileSync(join(runtimeDir, "release-sha"), `${candidate}\n`);
    const result = run(["verify", "--repo", repo, "--runtime-dir", runtimeDir, "--pushed-ref", "main", "--ci-evidence", greenEvidence()]);
    expect(result.status).toBe(65);
    expect(result.stdout).toContain("identity-record");
  });

  it("fails verification when the running image digest differs from the record", () => {
    run([
      "stamp",
      "--repo",
      repo,
      "--candidate-sha",
      candidate,
      "--pushed-ref",
      "main",
      "--ci-evidence",
      greenEvidence(),
      "--candidate-image",
      "ghcr.io/luiapi-sys/lottify_v3-backend@sha256:" + "a".repeat(64),
      "--runtime-dir",
      runtimeDir,
      "--apply",
    ]);
    const result = run([
      "verify",
      "--repo",
      repo,
      "--runtime-dir",
      runtimeDir,
      "--pushed-ref",
      "main",
      "--ci-evidence",
      greenEvidence(),
      "--expect-image-digest",
      "ghcr.io/luiapi-sys/lottify_v3-backend@sha256:" + "b".repeat(64),
    ]);
    expect(result.status).toBe(65);
    expect(result.stdout).toContain("!=");
  });
});
