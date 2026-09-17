// Scenario loading + validation for the Lottify load harness.
//
// The scenario file is the single source of the pass/fail targets. It is data,
// not code, so a reviewer can diff it against Ticket 13 without reading the
// harness. Targets are asserted against the values transcribed from the
// specification at load time: a scenario file that lowers a target is rejected
// outright instead of silently producing a green run.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const SCENARIO_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scenarios",
  "ticket13.capacity.json",
);

/**
 * Ticket 13 targets transcribed from
 * `.scratch/lottify-v1-specification/issues/13-non-functional-targets-and-release-gates.md`.
 * A scenario file may not be weaker than these.
 */
export const TICKET13_FLOOR = {
  concurrent_active_member_sessions: { min: 5000 },
  quote_requests_per_second: { min: 300 },
  confirm_requests_per_second: { min: 150 },
  payment_webhook_events_per_second: { min: 200 },
  read_api_latency: { p95_ms_max: 300, p99_ms_max: 800 },
  quote_latency: { p95_ms_max: 500, p99_ms_max: 1500 },
  confirm_latency: { p95_ms_max: 800, p99_ms_max: 2000 },
  critical_server_error_rate: { max: 0.005 },
  critical_queue_lag: { p95_ms_max: 5000, alert_threshold_ms: 30000 },
  settlement_capacity: { min_bet_lines: 100000, within_seconds: 600 },
};

export function loadScenario(scenarioPath = SCENARIO_PATH) {
  const raw = JSON.parse(readFileSync(scenarioPath, "utf8"));
  const errors = [];
  if (!raw.id || !raw.version) errors.push("scenario requires id and version");
  for (const [name, floor] of Object.entries(TICKET13_FLOOR)) {
    const actual = raw.targets?.[name];
    if (!actual) {
      errors.push(`scenario is missing target '${name}'`);
      continue;
    }
    for (const [key, expected] of Object.entries(floor)) {
      const seen = actual[key];
      const weaker =
        (key.startsWith("min") || key.startsWith("min_")) && !(seen >= expected)
          ? true
          : (key.endsWith("_max") || key === "max") && !(seen <= expected)
            ? true
            : seen === undefined;
      if (weaker) {
        errors.push(
          `target '${name}.${key}' = ${seen} is weaker than the Ticket 13 value ${expected}`,
        );
      }
    }
  }
  const targetProfile = raw.profiles?.target;
  if (!targetProfile?.claimsTarget) {
    errors.push("scenario must declare a 'target' profile with claimsTarget=true");
  }
  if (errors.length > 0) {
    throw new Error(`Invalid load scenario ${scenarioPath}:\n  - ${errors.join("\n  - ")}`);
  }
  return raw;
}

export function resolveProfile(scenario, profileName) {
  const profile = scenario.profiles[profileName];
  if (!profile) {
    throw new Error(
      `Unknown profile '${profileName}'. Known profiles: ${Object.keys(scenario.profiles).join(", ")}`,
    );
  }
  return { name: profileName, ...profile };
}
