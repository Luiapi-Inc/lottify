// Latency / throughput statistics for the Lottify load harness.
//
// Deliberately dependency-free: the harness must run from a plain `node` with
// the repository checked out, on any host, so a reviewer can re-run it without
// installing a load-testing toolchain.

export class LatencyRecorder {
  #samples = [];
  #strings = [];

  /** Records one observation in milliseconds. Non-finite values are recorded as invalid. */
  record(ms) {
    if (Number.isFinite(ms) && ms >= 0) {
      this.#samples.push(ms);
    } else {
      this.#strings.push(String(ms));
    }
  }

  get count() {
    return this.#samples.length;
  }

  get invalidCount() {
    return this.#strings.length;
  }

  percentile(p) {
    if (this.#samples.length === 0) return null;
    const sorted = [...this.#samples].sort((a, b) => a - b);
    const rank = (p / 100) * (sorted.length - 1);
    const low = Math.floor(rank);
    const high = Math.ceil(rank);
    if (low === high) return sorted[low];
    return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
  }

  summary() {
    return {
      count: this.count,
      p50: this.percentile(50),
      p95: this.percentile(95),
      p99: this.percentile(99),
      max: this.#samples.length ? Math.max(...this.#samples) : null,
      min: this.#samples.length ? Math.min(...this.#samples) : null,
      mean: this.#samples.length
        ? this.#samples.reduce((a, b) => a + b, 0) / this.#samples.length
        : null,
    };
  }

  histogram(edges = [10, 25, 50, 100, 200, 300, 500, 800, 1000, 1500, 2000, 5000, Infinity]) {
    const buckets = edges.map((edge) => ({ leMs: edge, count: 0 }));
    for (const sample of this.#samples) {
      const index = edges.findIndex((edge) => sample <= edge);
      buckets[index === -1 ? buckets.length - 1 : index].count += 1;
    }
    return buckets;
  }
}

export class ThroughputRecorder {
  #startedAt = null;
  #completed = 0;
  #failed = 0;
  #statusCounts = new Map();

  start(at = Date.now()) {
    if (this.#startedAt === null) this.#startedAt = at;
  }

  recordStatus(status) {
    this.#statusCounts.set(status, (this.#statusCounts.get(status) ?? 0) + 1);
  }

  recordOutcome(ok) {
    if (ok) this.#completed += 1;
    else this.#failed += 1;
  }

  snapshot(now = Date.now()) {
    const windowSeconds =
      this.#startedAt === null ? 0 : Math.max((now - this.#startedAt) / 1000, 0);
    return {
      windowSeconds,
      completed: this.#completed,
      failed: this.#failed,
      total: this.#completed + this.#failed,
      achievedRps: windowSeconds > 0 ? this.#completed / windowSeconds : null,
      errorRate:
        this.#completed + this.#failed > 0
          ? this.#failed / (this.#completed + this.#failed)
          : null,
      statusCounts: Object.fromEntries(
        [...this.#statusCounts.entries()].sort((a, b) => a[0] - b[0]),
      ),
    };
  }
}

export function round(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Evaluates one measurement against one target and returns a verdict that can
 * never overstate the evidence:
 *   PASS         - measured, target met, and the profile is allowed to claim targets
 *   FAIL         - measured, target missed, and the profile is allowed to claim targets
 *   MEASURED     - measured, but the profile is NOT target-scale: informational only
 *   NOT_MEASURED - no observation exists (missing capability/telemetry/endpoint)
 *   ENV_GATED    - the measurement cannot exist in this environment (e.g. required telemetry absent)
 */
export function verdict({ measured, pass, claimsTarget, envGated = false }) {
  if (envGated) return "ENV_GATED";
  if (measured === false || measured === null || measured === undefined) return "NOT_MEASURED";
  if (!claimsTarget) return "MEASURED";
  return pass ? "PASS" : "FAIL";
}

export function evaluateMax(achieved, max, { claimsTarget, measured = true, envGated = false }) {
  const pass = achieved !== null && achieved !== undefined && achieved <= max;
  return {
    target: { max },
    achieved,
    verdict: verdict({ measured, pass, claimsTarget, envGated }),
  };
}

export function evaluateMin(achieved, min, { claimsTarget, measured = true, envGated = false }) {
  const pass = achieved !== null && achieved !== undefined && achieved >= min;
  return {
    target: { min },
    achieved,
    verdict: verdict({ measured, pass, claimsTarget, envGated }),
  };
}
