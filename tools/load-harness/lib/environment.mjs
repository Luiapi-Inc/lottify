// Environment fingerprint: what the run was actually measured on.
//
// A performance number without its environment is unusable, and a sandbox
// number presented as capacity evidence is worse than no number. Every report
// embeds this fingerprint, plus an explicit `productionLike` verdict derived
// from the declared requirements in
// docs/implementation/load-harness-scenario-and-environment.md.

import { execFileSync } from "node:child_process";
import { cpus, totalmem, freemem, hostname, platform, release, arch, loadavg } from "node:os";
import { existsSync, readFileSync } from "node:fs";

function tryExec(command, args, cwd) {
  try {
    return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function readCgroupLimit(file) {
  try {
    const value = readFileSync(file, "utf8").trim();
    if (value === "max" || value.length === 0) return null;
    return Number(value);
  } catch {
    return null;
  }
}

export function cgroupCpuLimit() {
  return readCgroupLimit("/sys/fs/cgroup/cpu.max");
}

export function cgroupMemoryLimitBytes() {
  return readCgroupLimit("/sys/fs/cgroup/memory.max");
}

export function gitCandidate(repoRoot) {
  const sha = tryExec("git", ["rev-parse", "HEAD"], repoRoot);
  const branch = tryExec("git", ["rev-parse", "--abbrev-ref", "HEAD"], repoRoot);
  // Untracked files are excluded on purpose: a run always produces evidence
  // output under .hermes/evidence/, and counting that as "dirty" would mark
  // every honest run — including a fresh CI checkout — as a modified tree. What
  // matters for a report is whether the *tracked* tree differed from the commit.
  const dirty = tryExec("git", ["status", "--porcelain", "--untracked-files=no"], repoRoot);
  const untracked = tryExec("git", ["status", "--porcelain", "--untracked-files=all"], repoRoot);
  const describe = tryExec("git", ["describe", "--tags", "--always"], repoRoot);
  const untrackedFiles = untracked === null ? null : untracked.split("\n").filter((line) => line.startsWith("??")).length;
  return {
    sha,
    shortSha: sha ? sha.slice(0, 12) : null,
    branch,
    describe,
    worktreeDirty: dirty === null ? null : dirty.trim().length > 0,
    trackedChanges: dirty === null ? null : dirty.split("\n").filter((line) => line.trim().length > 0).length,
    untrackedFiles,
    repoRoot,
  };
}

export function environmentFingerprint({ repoRoot = process.cwd(), databaseUrl = null, redisUrl = null, apiBaseUrl = null } = {}) {
  const cpuList = cpus();
  const cpuMax = cgroupCpuLimit();
  const memoryMax = cgroupMemoryLimitBytes();
  const databaseHost = (() => {
    if (!databaseUrl) return null;
    try {
      const url = new URL(databaseUrl);
      return { host: url.hostname, port: url.port, database: url.pathname.replace(/^\//, ""), user: url.username };
    } catch {
      return { host: "unparseable" };
    }
  })();
  const redisHost = (() => {
    if (!redisUrl) return null;
    try {
      const url = new URL(redisUrl);
      return { host: url.hostname, port: url.port, database: url.pathname.replace(/^\//, "") };
    } catch {
      return { host: "unparseable" };
    }
  })();
  const apiHost = (() => {
    if (!apiBaseUrl) return null;
    try {
      return new URL(apiBaseUrl).hostname;
    } catch {
      return null;
    }
  })();

  return {
    capturedAt: new Date().toISOString(),
    hostname: hostname(),
    platform: platform(),
    release: release(),
    arch: arch(),
    nodeVersion: process.version,
    cpu: {
      hostVisibleCores: cpuList.length,
      model: cpuList[0]?.model ?? null,
      cgroupCpuMax: cpuMax,
      effectiveCores: cpuMax ? Math.max(cpuMax / 100_000, 1) : cpuList.length,
    },
    memory: {
      hostTotalBytes: totalmem(),
      hostFreeBytes: freemem(),
      cgroupMemoryMaxBytes: memoryMax,
      effectiveBytes: memoryMax ?? totalmem(),
    },
    loadavg: loadavg(),
    database: databaseHost,
    redis: redisHost,
    apiBaseUrl,
    client: {
      coLocated: apiHost !== null && ["127.0.0.1", "localhost", "::1"].includes(apiHost),
      clientHost: hostname(),
      apiHost,
    },
    candidate: gitCandidate(repoRoot),
  };
}

/**
 * The declared requirements for a production-like run. Kept in code so the
 * verdict is mechanical rather than an opinion, and mirrored in the docs.
 * PRELIMINARY: the target environment spec must be signed off by the Lead
 * before a `target`-profile run can be accepted as capacity evidence.
 */
export const PRODUCTION_LIKE_REQUIREMENTS = {
  minEffectiveCpuCores: 8,
  minEffectiveMemoryBytes: 16 * 1024 ** 3,
  maxClientServerCoLocation: false,
  databaseMustBeDedicated: true,
  requireDeclaredEnvironmentSpecApproval: true,
};

export function assessProductionLikeness(fingerprint) {
  const failures = [];
  const req = PRODUCTION_LIKE_REQUIREMENTS;
  if (fingerprint.cpu.effectiveCores < req.minEffectiveCpuCores) {
    failures.push(
      `cpu: ${fingerprint.cpu.effectiveCores} core(s) available, ${req.minEffectiveCpuCores} required`,
    );
  }
  if (fingerprint.memory.effectiveBytes < req.minEffectiveMemoryBytes) {
    failures.push(
      `memory: ${(fingerprint.memory.effectiveBytes / 1024 ** 3).toFixed(1)} GiB available, ${(
        req.minEffectiveMemoryBytes / 1024 ** 3
      ).toFixed(0)} GiB required`,
    );
  }
  const coLocated = fingerprint.client?.coLocated === true;
  if (req.maxClientServerCoLocation === false && coLocated) {
    failures.push("client and API are co-located on the same host (driver cost is inside the measurement)");
  }
  if (fingerprint.database?.database && /dev|test|sandbox/i.test(fingerprint.database.database)) {
    failures.push(
      `database '${fingerprint.database.database}' is a shared development database, not a dedicated load database`,
    );
  }
  return {
    productionLike: failures.length === 0,
    requirements: req,
    failures,
  };
}

export function envFileExists(repoRoot) {
  return existsSync(`${repoRoot}/.env`);
}
