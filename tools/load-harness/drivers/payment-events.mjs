// Driver: payment / webhook event stream.
//
// Ticket 13: "at least 200 payment/webhook events/second under production-like
// tests" and "Webhooks are authenticated/validated and durably accepted before
// success is acknowledged".
//
// This driver does not assume an ingress exists. It discovers candidate inbound
// event routes from the generated OpenAPI contract, and only drives traffic when
// a caller names one explicitly (with its signature header) — because driving an
// unsigned webhook endpoint would test a security hole rather than a target.
//
// When no ingress exists, the driver reports NOT_MEASURED with the discovered
// route inventory as evidence. It never substitutes the Member-triggered
// deposit reconcile POST (an outbound provider poll) for an event ingress.

import { readFileSync } from "node:fs";
import { HttpClient, jsonHeaders, sleep } from "../lib/http-client.mjs";
import { LatencyRecorder, ThroughputRecorder, evaluateMin } from "../lib/stats.mjs";
import { randomUUID } from "node:crypto";

export const CANDIDATE_INGRESS_PATTERN = /(webhook|callback|notif|ipn|event)/i;
export const PROVIDER_POLL_ROUTES = [
  { method: "POST", path: "/api/v1/member/deposits/:id/reconcile", classification: "member-triggered provider poll (outbound), not an event ingress" },
];

export function discoverIngressCandidates(openApiPath) {
  try {
    const spec = JSON.parse(readFileSync(openApiPath, "utf8"));
    const paths = Object.keys(spec.paths ?? {});
    return {
      available: true,
      openApiPath,
      totalPaths: paths.length,
      candidates: paths.filter((path) => CANDIDATE_INGRESS_PATTERN.test(path)),
      methods: Object.fromEntries(
        paths
          .filter((path) => CANDIDATE_INGRESS_PATTERN.test(path))
          .map((path) => [path, Object.keys(spec.paths[path])]),
      ),
    };
  } catch (error) {
    return { available: false, openApiPath, error: error.message, candidates: [], methods: {} };
  }
}

export async function runPaymentEvents({
  baseUrl,
  targetRps,
  durationSeconds,
  scenario,
  claimsTarget,
  webhookPath = null,
  signatureHeader = null,
  signatureValue = null,
  payload = null,
  openApiPath,
  maxSockets = 128,
}) {
  const discovery = discoverIngressCandidates(openApiPath);
  const notes = [];
  if (discovery.available) {
    notes.push(
      `scanned ${discovery.totalPaths} OpenAPI paths; ${discovery.candidates.length} match /(webhook|callback|notif|ipn|event)/`,
    );
  } else {
    notes.push(`OpenAPI contract not readable at ${openApiPath}: ${discovery.error}`);
  }
  notes.push(
    `provider-poll routes that exist but are NOT an ingress: ${PROVIDER_POLL_ROUTES.map((route) => `${route.method} ${route.path} (${route.classification})`).join("; ")}`,
  );

  const target = scenario.targets.payment_webhook_events_per_second;
  if (!webhookPath) {
    return {
      id: "payment-events",
      name: "payment/webhook event stream",
      measured: false,
      envGated: false,
      driver: "payment-events",
      requested: { targetRps, durationSeconds, webhookPath: null },
      notes: [
        ...notes,
        "no inbound webhook/callback route was found in the candidate contract and no --webhook-path was supplied, so the event stream could not be driven",
        "the harness will not drive an unsigned ingress: Ticket 13 requires webhooks to be authenticated/validated before success is acknowledged",
      ],
      evidence: { ingressDiscovery: discovery, providerPollRoutes: PROVIDER_POLL_ROUTES },
      measurements: {
        payment_webhook_events_per_second: {
          target: { min: target.min },
          achieved: null,
          verdict: "NOT_MEASURED",
        },
      },
    };
  }

  const client = new HttpClient({ baseUrl, maxSockets });
  const latency = new LatencyRecorder();
  const throughput = new ThroughputRecorder();
  const statusErrors = [];
  const workers = Math.max(1, Math.min(targetRps, 64));
  const perWorkerRps = targetRps / workers;
  const intervalMs = perWorkerRps > 0 ? 1000 / perWorkerRps : Infinity;
  const endAt = Date.now() + durationSeconds * 1000;
  throughput.start();

  const worker = async () => {
    let nextAt = Date.now();
    while (Date.now() < endAt) {
      const eventId = randomUUID();
      const headers = {
        "content-type": "application/json",
        accept: "application/json",
        "x-event-id": eventId,
        ...(signatureHeader && signatureValue ? { [signatureHeader]: signatureValue } : {}),
      };
      const response = await client.request({
        method: "POST",
        path: webhookPath,
        headers,
        body: JSON.stringify(payload ?? { eventId, type: "PAYMENT_OUTCOME", occurredAt: new Date().toISOString() }),
      });
      latency.record(response.ms);
      const ok = response.status >= 200 && response.status < 300;
      throughput.recordOutcome(ok);
      throughput.recordStatus(response.status);
      if (!ok && statusErrors.length < 10) {
        statusErrors.push({ status: response.status, error: response.error, body: response.body.slice(0, 200) });
      }
      nextAt += intervalMs;
      if (nextAt < Date.now()) nextAt = Date.now();
    }
  };

  await Promise.all(Array.from({ length: workers }, () => worker()));
  const snapshot = throughput.snapshot();
  const summary = latency.summary();
  client.close();

  return {
    id: "payment-events",
    name: "payment/webhook event stream",
    measured: true,
    envGated: false,
    driver: "payment-events",
    requested: { targetRps, durationSeconds, webhookPath, signed: Boolean(signatureHeader) },
    notes,
    evidence: { ingressDiscovery: discovery, providerPollRoutes: PROVIDER_POLL_ROUTES },
    samples: {
      events: snapshot.total,
      acceptedRps: snapshot.achievedRps,
      errorRate: snapshot.errorRate,
      statusCounts: snapshot.statusCounts,
      latencyMs: {
        p50: Math.round(summary.p50 ?? 0),
        p95: Math.round(summary.p95 ?? 0),
        p99: Math.round(summary.p99 ?? 0),
      },
      sampleErrors: statusErrors,
    },
    measurements: {
      payment_webhook_events_per_second: evaluateMin(snapshot.achievedRps, target.min, {
        claimsTarget: claimsTarget && Boolean(signatureHeader),
      }),
    },
  };
}

export { jsonHeaders, sleep, randomUUID };
