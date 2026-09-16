// Target coverage for the Ticket 13 report.
//
// Review round 3 finding C1: the report's target-by-target table (and
// `runs[].measurements`) covered 10 of the 11 Ticket 13 targets. `critical_queue_lag`
// had no row at all — it appeared only as `queueLag | NO` in the required-signal
// section — so the headline "MEASURED 16 · NOT_MEASURED 1" understated the unproven
// set as 1 when two targets (payment webhook ingress + queue lag) had no achieved
// value. A target that is missing from the table is indistinguishable from a target
// nobody thought about, which is exactly what a capacity report must never allow.
//
// The rule enforced here: EVERY key of `scenario.targets` gets exactly one row in
// the report. A target no driver can measure is emitted as an explicit
// NOT_MEASURED measurement carrying its reason and the observability evidence
// behind that reason — never omitted and never approximated.

/**
 * Which required-observability signal backs a target that no driver measures.
 * Used to write a reason that points at real evidence (the metric-family probe)
 * instead of a hand-written sentence.
 */
export const TARGET_SIGNAL_BACKING = {
  critical_queue_lag: "queueLag",
};

/** Everything in a target spec except the verbatim Ticket 13 quote. */
function targetSpec(target) {
  const { verbatim: _verbatim, ...spec } = target ?? {};
  return spec;
}

/**
 * A target is covered when some run reports a measurement whose name is the target
 * key itself or the target key plus a suffix (`read_api_latency` is covered by
 * `read_api_latency_p95` / `_p99`, `settlement_capacity` by
 * `settlement_capacity_bet_lines`).
 */
export function metricCoversTarget(metric, targetKey) {
  return metric === targetKey || metric.startsWith(`${targetKey}_`);
}

export function measuredMetricNames(runs) {
  const names = [];
  for (const run of runs ?? []) names.push(...Object.keys(run?.measurements ?? {}));
  return names;
}

/** Target keys with no measurement row anywhere in `runs`. */
export function findUncoveredTargets(targets, runs) {
  const metrics = measuredMetricNames(runs);
  return Object.keys(targets ?? {}).filter(
    (key) => !metrics.some((metric) => metricCoversTarget(metric, key)),
  );
}

function reasonFor(targetKey, signal) {
  if (!signal) {
    return `no driver in this harness measures \`${targetKey}\`; it is reported as NOT_MEASURED rather than omitted`;
  }
  const matches = (signal.matchedFamilies ?? []).join(", ") || "no family matched";
  if (!signal.available) {
    return (
      `no driver measures \`${targetKey}\`; the required metric family \`${signal.id}\` ` +
      `(${signal.purpose}) matched no family on any observed metrics surface (${matches}) — ` +
      "see the metric-family inventory in §4, which is the evidence of absence"
    );
  }
  return (
    `no driver measures \`${targetKey}\`; the required metric family \`${signal.id}\` is present ` +
    `(${matches}) but this harness has no evaluation path that turns those samples into the ` +
    "target's p95, so no achieved value can be claimed"
  );
}

/**
 * Builds the synthetic run that carries one NOT_MEASURED row per target with no
 * measurement path. Returns null when every target already has a row, so a
 * complete report is not padded with an empty run.
 */
export function buildCoverageRun({ targets, scenarioId = null, runs, signals = [], inventory = null }) {
  const uncovered = findUncoveredTargets(targets, runs);
  if (uncovered.length === 0) return null;
  const measurements = {};
  const notes = [];
  for (const key of uncovered) {
    const signalId = TARGET_SIGNAL_BACKING[key] ?? null;
    const signal = signals.find((candidate) => candidate.id === signalId) ?? null;
    const reason = reasonFor(key, signal);
    measurements[key] = {
      target: targetSpec(targets[key]),
      achieved: null,
      verdict: "NOT_MEASURED",
      reason,
      evidence: signal
        ? {
            requiredSignal: signal.id,
            purpose: signal.purpose,
            available: signal.available,
            matchedFamilies: signal.matchedFamilies ?? [],
            surfaces: signal.surfaces ?? [],
          }
        : { metricInventory: inventory },
    };
    notes.push(`${key}: ${reason}`);
  }
  return {
    id: "target-coverage",
    name: "Ticket 13 targets with no measurement path in this harness",
    measured: false,
    envGated: false,
    driver: "lib/coverage.mjs",
    requested: { scenario: scenarioId, uncoveredTargets: uncovered },
    notes,
    samples: {
      uncoveredTargets: uncovered,
      requiredSignals: signals.map((signal) => ({
        id: signal.id,
        available: signal.available,
        matchedFamilies: signal.matchedFamilies ?? [],
      })),
    },
    measurements,
  };
}

/**
 * Coverage failures for a report: target keys with no row. Empty list = the
 * report accounts for every Ticket 13 target. Used both as a pre-write guard and
 * by the CI binding check, so a dropped row fails the build instead of shipping.
 */
export function targetCoverageFailures(targets, runs) {
  return findUncoveredTargets(targets, runs).map(
    (key) => `target \`${key}\` has no row in the report (neither a driver measurement nor a NOT_MEASURED coverage row)`,
  );
}

export function assertTargetCoverage(targets, runs) {
  const failures = targetCoverageFailures(targets, runs);
  if (failures.length > 0) {
    throw new Error(`target coverage is incomplete:\n  - ${failures.join("\n  - ")}`);
  }
}

/**
 * Targets with no achieved value anywhere in the report — the set that is still
 * unproven, whichever run produced the row. A target can be "driver-backed" and
 * still have no achieved value (the payment-events driver emits its row as
 * NOT_MEASURED because the candidate exposes no authenticated ingress), so
 * "10/11 driver-backed" and "2 of 11 unproven" are both true at once and the
 * header must print both numbers; otherwise the headline reads as if only the
 * non-driver-backed target were unproven (review round 4 note).
 */
export function unprovenTargets(targets, runs) {
  const keys = Object.keys(targets ?? {});
  const proven = new Set();
  for (const run of runs ?? []) {
    for (const [metric, result] of Object.entries(run?.measurements ?? {})) {
      const achieved = result?.achieved;
      if (result?.verdict === "NOT_MEASURED" || achieved === null || achieved === undefined) continue;
      for (const key of keys) {
        if (metricCoversTarget(metric, key)) proven.add(key);
      }
    }
  }
  return keys.filter((key) => !proven.has(key));
}

/** Headline coverage numbers for the report header and the JSON payload. */
export function coverageSummary(targets, runs) {
  const keys = Object.keys(targets ?? {});
  const coverageRun = (runs ?? []).find((run) => run?.id === "target-coverage");
  // "Driver-backed" must mean a real driver measured the target: counting the
  // synthetic coverage row as coverage would report 11/11 for a report where one
  // target has no measurement path at all, which is exactly the understatement
  // review round 3 finding C1 was about.
  const driverMetrics = measuredMetricNames((runs ?? []).filter((run) => run?.id !== "target-coverage"));
  const perTarget = {};
  const driverBacked = [];
  const declaredUnmeasured = [];
  const missing = [];
  for (const key of keys) {
    const driverMetric = driverMetrics.find((metric) => metricCoversTarget(metric, key)) ?? null;
    const synthetic = coverageRun?.measurements?.[key];
    if (driverMetric) {
      driverBacked.push(key);
      perTarget[key] = { source: "driver", metric: driverMetric };
    } else if (synthetic) {
      declaredUnmeasured.push(key);
      perTarget[key] = { source: "harness-declared", verdict: synthetic.verdict, reason: synthetic.reason ?? null };
    } else {
      missing.push(key);
      perTarget[key] = { source: "MISSING" };
    }
  }
  const unproven = unprovenTargets(targets, runs);
  return {
    totalTargets: keys.length,
    driverBacked: driverBacked.length,
    driverBackedTargets: driverBacked,
    unproven,
    declaredUnmeasured,
    missing,
    perTarget,
  };
}
