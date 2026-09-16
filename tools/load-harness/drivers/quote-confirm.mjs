// Driver: Quote -> Order -> Confirm funnel at the Ticket 13 rates.
//
// Ticket 13: "at least 300 Quote requests/second, at least 150 Confirm
// requests/second" and Quote p95 <= 500 ms / p99 <= 1.5 s, Confirm p95 <= 800 ms
// / p99 <= 2 s, critical server error rate < 0.5 %.
//
// The funnel is driven as the Member actually performs it: create Quote
// (server-authoritative resolution, Idempotency-Key required), create Order from
// the Quote, then issue the explicit Confirm command with the Order's version.
// The Quote:Confirm ratio is derived from the two target rates (300:150 -> every
// 2nd cycle confirms), so the mix cannot silently drift away from the target.
//
// Money-safety issue under load is measured by the seed/assert step, not here:
// this driver counts accepted commands and rejections, it does not assert
// financial invariants from HTTP responses.

import { HttpClient, jsonHeaders, sleep } from "../lib/http-client.mjs";
import { LatencyRecorder, ThroughputRecorder, evaluateMax, evaluateMin } from "../lib/stats.mjs";
import { randomUUID } from "node:crypto";

export async function runQuoteConfirm({
  baseUrl,
  sessions,
  drawIds,
  betTypeCode,
  canonicalNumber = "42",
  stakeMinor = "1000",
  quoteRps,
  confirmRps,
  durationSeconds,
  scenario,
  claimsTarget,
  burst = null,
  maxSockets = 512,
  replaySampleSize = 0,
  replayConcurrency = 4,
}) {
  if (sessions.length === 0) throw new Error("quote-confirm driver requires seeded member sessions");
  if (drawIds.length === 0) throw new Error("quote-confirm driver requires at least one open Draw id");

  const client = new HttpClient({ baseUrl, maxSockets });
  const quoteLatency = new LatencyRecorder();
  const confirmLatency = new LatencyRecorder();
  const quoteThroughput = new ThroughputRecorder();
  const confirmThroughput = new ThroughputRecorder();
  const rejections = [];
  const replayTargets = [];
  const replaySample = Number(replaySampleSize ?? 0);

  const confirmEveryNthCycle = Math.max(1, Math.round(quoteRps / Math.max(confirmRps, 1)));
  const workers = Math.max(1, Math.min(sessions.length, quoteRps));
  const perWorkerRps = quoteRps / workers;
  const baseIntervalMs = perWorkerRps > 0 ? 1000 / perWorkerRps : Infinity;

  const endAt = Date.now() + durationSeconds * 1000;
  let cycle = 0;

  quoteThroughput.start();
  confirmThroughput.start();

  const recordRejection = (stage, status, body, extra = {}) => {
    if (rejections.length < 25) {
      rejections.push({ stage, status, body: body.slice(0, 300), ...extra });
    }
  };

  const worker = async (workerIndex) => {
    let nextAt = Date.now();
    while (Date.now() < endAt) {
      const waitMs = nextAt - Date.now();
      if (waitMs > 0) await sleep(waitMs);
      if (Date.now() >= endAt) break;

      const peak = burst?.active ? burst.peakMultiplier : 1;
      const cycleIndex = cycle++;
      const session = sessions[cycleIndex % sessions.length];
      const drawId = drawIds[cycleIndex % drawIds.length];
      const headers = jsonHeaders(session.token, { "idempotency-key": randomUUID() });

      // --- Quote -----------------------------------------------------------
      const quoteResponse = await client.request({
        method: "POST",
        path: `/api/v1/member/draws/${encodeURIComponent(drawId)}/quotes`,
        headers,
        body: JSON.stringify({
          currency: "THB",
          lines: [{ betTypeCode, canonicalNumber, stakeMinor }],
        }),
      });
      quoteLatency.record(quoteResponse.ms);
      let quoteOk = quoteResponse.status >= 200 && quoteResponse.status < 300;
      quoteThroughput.recordOutcome(quoteOk);
      quoteThroughput.recordStatus(quoteResponse.status);
      let orderId = null;
      if (!quoteOk) recordRejection("quote", quoteResponse.status, quoteResponse.body, { drawId });

      // --- Order from Quote -------------------------------------------------
      if (quoteOk) {
        const quoteId = safeJson(quoteResponse.body)?.id ?? null;
        if (!quoteId) {
          quoteOk = false;
          recordRejection("quote", quoteResponse.status, "quote response carried no id");
        } else {
          const orderResponse = await client.request({
            method: "POST",
            path: `/api/v1/member/quotes/${encodeURIComponent(quoteId)}/orders`,
            headers: jsonHeaders(session.token, { "idempotency-key": randomUUID() }),
            body: JSON.stringify({ version: 1 }),
          });
          const orderBody = safeJson(orderResponse.body);
          const orderOk = orderResponse.status >= 200 && orderResponse.status < 300;
          if (orderOk && typeof orderBody?.id === "string") {
            orderId = orderBody.id;
          } else {
            recordRejection("order", orderResponse.status, orderResponse.body);
          }
        }
      }

      // --- Confirm (every Nth cycle, per the target rate ratio) -------------
      if (orderId && cycleIndex % confirmEveryNthCycle === 0) {
        const confirmKey = randomUUID();
        const confirmResponse = await client.request({
          method: "POST",
          path: `/api/v1/member/orders/${encodeURIComponent(orderId)}/confirm`,
          headers: jsonHeaders(session.token, { "idempotency-key": confirmKey }),
          body: JSON.stringify({ version: 1 }),
        });
        confirmLatency.record(confirmResponse.ms);
        const confirmOk = confirmResponse.status >= 200 && confirmResponse.status < 300;
        confirmThroughput.recordOutcome(confirmOk);
        confirmThroughput.recordStatus(confirmResponse.status);
        if (!confirmOk) {
          recordRejection("confirm", confirmResponse.status, confirmResponse.body);
        } else if (replayTargets.length < replaySample) {
          replayTargets.push({ orderId, memberToken: session.token, idempotencyKey: confirmKey, version: 1 });
        }
      }

      if (workerIndex === 0 && burst?.activateAt && Date.now() >= burst.activateAt && !burst.active) {
        burst.active = true;
      }
      nextAt += baseIntervalMs / peak;
      if (nextAt < Date.now()) nextAt = Date.now();
    }
  };

  const startedAt = Date.now();
  await Promise.all(Array.from({ length: workers }, (_, index) => worker(index)));

  // --- Duplicate-effect probe: replay one succeeded Confirm concurrently ---
  // Ticket 13: "no critical business or financial effect may duplicate under
  // load". The replayed request carries the SAME Idempotency-Key, so a correct
  // implementation returns the same Order and posts exactly one stake effect.
  // The financial outcome is asserted independently by
  // seed/assert-financial-effects.ts, not from these HTTP responses.
  const replayObservations = [];
  if (replayTargets.length > 0) {
    for (const target of replayTargets) {
      const responses = await Promise.all(
        Array.from({ length: replayConcurrency }, () =>
          client.request({
            method: "POST",
            path: `/api/v1/member/orders/${encodeURIComponent(target.orderId)}/confirm`,
            headers: jsonHeaders(target.memberToken, { "idempotency-key": target.idempotencyKey }),
            body: JSON.stringify({ version: target.version }),
          }),
        ),
      );
      replayObservations.push({
        orderId: target.orderId,
        statuses: responses.map((response) => response.status),
        distinctOrderIds: [...new Set(responses.map((response) => safeJson(response.body)?.id ?? null))],
      });
    }
  }

  const quoteSnapshot = quoteThroughput.snapshot();
  const confirmSnapshot = confirmThroughput.snapshot();
  const quoteSummary = quoteLatency.summary();
  const confirmSummary = confirmLatency.summary();
  client.close();

  const targets = scenario.targets;
  return {
    id: "quote-confirm",
    name: "Quote / Confirm funnel throughput + latency",
    measured: true,
    envGated: false,
    driver: "quote-confirm",
    requested: { quoteRps, confirmRps, workers, confirmEveryNthCycle, durationSeconds, burst: burst?.description ?? null },
    elapsedSeconds: (Date.now() - startedAt) / 1000,
    notes: [
      "critical_server_error_rate is computed from the Quote/Confirm critical path driven by this run (quote + confirm failures over quote + confirm requests) only. The read path's errors are a separate surface and are reported by the member-sessions driver as read_error_rate; the repo exposes no single combined critical-path error counter, so the two must be read together.",
    ],
    samples: {
      quotes: {
        requests: quoteSnapshot.total,
        achievedRps: quoteSnapshot.achievedRps,
        errorRate: quoteSnapshot.errorRate,
        statusCounts: quoteSnapshot.statusCounts,
        latencyMs: {
          p50: Math.round(quoteSummary.p50 ?? 0),
          p95: Math.round(quoteSummary.p95 ?? 0),
          p99: Math.round(quoteSummary.p99 ?? 0),
          max: Math.round(quoteSummary.max ?? 0),
        },
        histogram: quoteLatency.histogram(),
      },
      confirms: {
        requests: confirmSnapshot.total,
        achievedRps: confirmSnapshot.achievedRps,
        errorRate: confirmSnapshot.errorRate,
        statusCounts: confirmSnapshot.statusCounts,
        latencyMs: {
          p50: Math.round(confirmSummary.p50 ?? 0),
          p95: Math.round(confirmSummary.p95 ?? 0),
          p99: Math.round(confirmSummary.p99 ?? 0),
          max: Math.round(confirmSummary.max ?? 0),
        },
        histogram: confirmLatency.histogram(),
      },
      sampleRejections: rejections,
      duplicateEffectReplay: {
        sampledOrders: replayObservations.length,
        concurrentReplaysPerOrder: replayConcurrency,
        observations: replayObservations.slice(0, 100),
        allReplaysReturnedSameOrder: replayObservations.every(
          (observation) => observation.distinctOrderIds.length === 1,
        ),
      },
    },
    measurements: {
      quote_requests_per_second: evaluateMin(quoteSnapshot.achievedRps, targets.quote_requests_per_second.min, {
        claimsTarget,
      }),
      confirm_requests_per_second: evaluateMin(
        confirmSnapshot.achievedRps,
        targets.confirm_requests_per_second.min,
        { claimsTarget },
      ),
      quote_latency_p95: evaluateMax(
        quoteSummary.p95 === null ? null : Math.round(quoteSummary.p95),
        targets.quote_latency.p95_ms_max,
        { claimsTarget },
      ),
      quote_latency_p99: evaluateMax(
        quoteSummary.p99 === null ? null : Math.round(quoteSummary.p99),
        targets.quote_latency.p99_ms_max,
        { claimsTarget },
      ),
      confirm_latency_p95: evaluateMax(
        confirmSummary.p95 === null ? null : Math.round(confirmSummary.p95),
        targets.confirm_latency.p95_ms_max,
        { claimsTarget },
      ),
      confirm_latency_p99: evaluateMax(
        confirmSummary.p99 === null ? null : Math.round(confirmSummary.p99),
        targets.confirm_latency.p99_ms_max,
        { claimsTarget },
      ),
      critical_server_error_rate: {
        target: { max: targets.critical_server_error_rate.max },
        achieved: combineErrorRates(quoteSnapshot, confirmSnapshot),
        // §1 must carry the scope itself: without it a reader of the table (or of
        // the release gate that consumes this row) would take the number as
        // covering every critical surface, while it covers the Quote/Confirm
        // critical path only (review round 4 note).
        reason:
          "scope: Quote/Confirm critical path only (quote + confirm failures over quote + confirm requests); " +
          "read-path errors are reported separately as read_error_rate by the member-sessions driver",
        verdict: errorVerdict(combineErrorRates(quoteSnapshot, confirmSnapshot), targets, claimsTarget),
      },
    },
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function combineErrorRates(a, b) {
  const total = a.total + b.total;
  if (total === 0) return null;
  return (a.failed + b.failed) / total;
}

function errorVerdict(errorRate, targets, claimsTarget) {
  if (errorRate === null) return "NOT_MEASURED";
  if (!claimsTarget) return "MEASURED";
  return errorRate < targets.critical_server_error_rate.max ? "PASS" : "FAIL";
}
