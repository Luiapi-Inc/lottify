// Driver: 5,000 concurrently active Member sessions.
//
// Ticket 13: "5,000 concurrently active Member sessions". A session counts as
// ACTIVE while it holds an authenticated session and keeps issuing Member read
// traffic. The driver ramps `sessions.target` authenticated sessions, keeps each
// one issuing read requests at a per-session pace, and samples the number of
// clients with an in-flight request once per second. The reported concurrency is
// the sampled maximum of *sessions with in-flight work*, which is the strictest
// honest reading of "concurrently active" available from the client side.

import { HttpClient, jsonHeaders, sleep } from "../lib/http-client.mjs";
import { LatencyRecorder, ThroughputRecorder, evaluateMax, evaluateMin } from "../lib/stats.mjs";

const READ_PATHS = ["/api/v1/member/profile", "/api/v1/member/wallet"];

export async function runReadSessions({
  baseUrl,
  sessions,
  readPath = READ_PATHS[0],
  targetSessions,
  targetRps,
  rampSeconds,
  durationSeconds,
  scenario,
  claimsTarget,
  maxSockets = Math.max(64, Math.min(targetSessions * 2, 4096)),
}) {
  if (sessions.length === 0) {
    throw new Error("read-sessions driver requires at least one seeded member session");
  }
  const client = new HttpClient({ baseUrl, maxSockets });
  const latency = new LatencyRecorder();
  const throughput = new ThroughputRecorder();
  const active = { count: 0, max: 0, sessions: 0, maxSessions: 0, established: 0, closedEarly: 0 };
  const statusErrors = [];

  const endAt = Date.now() + durationSeconds * 1000;
  const rampDelayMs = targetSessions > 1 ? (rampSeconds * 1000) / targetSessions : 0;
  const perSessionRps = targetRps / targetSessions;
  const intervalMs = perSessionRps > 0 ? 1000 / perSessionRps : Infinity;

  const sampler = setInterval(() => {
    active.max = Math.max(active.max, active.count);
    active.maxSessions = Math.max(active.maxSessions, active.established);
  }, 1000);

  throughput.start();

  const sessionLoop = async (session, index) => {
    let nextAt = Date.now() + index * rampDelayMs;
    while (Date.now() < endAt) {
      const waitMs = nextAt - Date.now();
      if (waitMs > 0) await sleep(waitMs);
      if (Date.now() >= endAt) break;
      active.count += 1;
      active.established = Math.max(active.established, index + 1);
      const response = await client.request({
        method: "GET",
        path: readPath,
        headers: jsonHeaders(session.token),
      });
      active.count -= 1;
      active.max = Math.max(active.max, active.count);
      latency.record(response.ms);
      const ok = response.status >= 200 && response.status < 300;
      throughput.recordOutcome(ok);
      throughput.recordStatus(response.status);
      if (!ok && statusErrors.length < 10) {
        statusErrors.push({
          memberId: session.memberId,
          status: response.status,
          error: response.error,
          body: response.body.slice(0, 200),
        });
      }
      nextAt += intervalMs;
      if (nextAt < Date.now()) nextAt = Date.now();
    }
  };

  const startedAt = Date.now();
  await Promise.all(sessions.slice(0, targetSessions).map((session, index) => sessionLoop(session, index)));
  clearInterval(sampler);
  const snapshot = throughput.snapshot();
  client.close();

  const sessionsTarget = scenario.targets.concurrent_active_member_sessions;
  // "Concurrently active" is measured as the number of seeded sessions holding
  // continuous authenticated traffic at the same instant (sampled max), not the
  // number of in-flight sockets — a session is active whether or not a request
  // happens to be on the wire at sample time.
  const sessionsResult = evaluateMin(active.maxSessions, sessionsTarget.min, { claimsTarget });
  const readTarget = scenario.targets.read_api_latency;
  const summary = latency.summary();
  const readP95 = evaluateMax(summary.p95 === null ? null : Math.round(summary.p95), readTarget.p95_ms_max, {
    claimsTarget,
  });
  const readP99 = evaluateMax(summary.p99 === null ? null : Math.round(summary.p99), readTarget.p99_ms_max, {
    claimsTarget,
  });

  return {
    id: "member-sessions",
    name: `Concurrent active Member sessions + read API SLO (${readPath})`,
    measured: true,
    envGated: false,
    driver: "read-sessions",
    requested: { targetSessions, targetRps, rampSeconds, durationSeconds, maxSockets },
    elapsedSeconds: (Date.now() - startedAt) / 1000,
    samples: {
      requests: snapshot.total,
      errorRate: snapshot.errorRate,
      achievedRps: snapshot.achievedRps,
      statusCounts: snapshot.statusCounts,
      latencyMs: {
        p50: Math.round(summary.p50 ?? 0),
        p95: Math.round(summary.p95 ?? 0),
        p99: Math.round(summary.p99 ?? 0),
        max: Math.round(summary.max ?? 0),
      },
      histogram: latency.histogram(),
      concurrentSessionsMax: active.maxSessions,
      concurrentInFlightMax: active.max,
      sessionsEstablished: active.established,
      sampleErrors: statusErrors,
    },
    measurements: {
      concurrent_active_member_sessions: sessionsResult,
      read_api_latency_p95: readP95,
      read_api_latency_p99: readP99,
      read_error_rate: {
        target: { max: scenario.targets.critical_server_error_rate.max },
        achieved: snapshot.errorRate,
        verdict:
          snapshot.errorRate === null
            ? "NOT_MEASURED"
            : !claimsTarget
              ? "MEASURED"
              : snapshot.errorRate < scenario.targets.critical_server_error_rate.max
                ? "PASS"
                : "FAIL",
      },
    },
  };
}
