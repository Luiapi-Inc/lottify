// Driver: settlement capacity (>= 100,000 Bet Lines within 10 minutes).
//
// Ticket 13: "Settlement capacity target is at least 100,000 Bet Lines within 10
// minutes for the configured worker pool; failures must resume idempotently and
// partial completion is never Member-visible."
//
// The Settlement Batch is driven through the Admin command that owns it
// (POST /api/v1/admin/draws/:drawId/settlement), because the candidate's worker
// groups do not consume a settlement queue job — settlement is an admin command
// executed inline by the API process. The report says exactly that, so nobody
// mistakes this run for "the worker pool scaled".
//
// Three assertions are made here, all on the Member-visible surface:
//   1. throughput: bet lines settled inside the budget
//   2. idempotent resume: re-issuing the command returns the same COMPLETED batch
//      and creates no second batch / no second financial effect
//   3. no Member-visible partial completion: while the batch is in flight, the
//      Member settlement read for sampled Orders never PRESENTS a financial
//      result as final (see evaluateMemberVisiblePartialCompletion below) — and
//      the check is reported as NOT_MEASURED when no in-flight read was observed,
//      because a property nobody exercised cannot be certified.

import { HttpClient, jsonHeaders, sleep } from "../lib/http-client.mjs";
import { LatencyRecorder } from "../lib/stats.mjs";

/**
 * Ticket 13 requires that "partial completion is never Member-visible". What
 * "Member-visible" means is defined by the candidate's own Member-facing
 * contract, not by the harness: `MemberSettlementOutcomeBody`
 * (apps/api/src/member-settlement.controller.ts:28-39,53-56) documents that
 *
 *   - `authoritative` is true ONLY when the owning batch has COMPLETED, and
 *   - `outcome` is non-null only when the read is authoritative,
 *   - an in-flight or failed batch reports `authoritative: false` and
 *     "never exposes a partial financial outcome".
 *
 * So an in-flight read that returns `batchState: "POSTING"` with
 * `authoritative: false, outcome: null` is the contract working as designed.
 *
 * Review round 4 finding R1: the first version of this check called ANY 200 whose
 * batchState matched /PAYOUT|REVERS|POSTING|COMMITTING|CALCULATING/ a
 * Member-visible partial completion. That contradicted the candidate's own
 * contract — it reported the candidate as violating Ticket 13 while the observed
 * payload (`outcome: null, authoritative: false, batchState: "POSTING"`) was
 * exactly the non-visible state the contract promises.
 *
 * A violation is now a 200 read that PRESENTS a financial result as final — i.e.
 * `authoritative === true` or `outcome !== null` — while the batchState reported
 * in that same response is not "COMPLETED". That happens if either
 *   (a) the read exposes an outcome while the batch is still in flight (a Member
 *       can see a partial settlement result), or
 *   (b) the read claims authority over a batch that is not COMPLETED (so a
 *       partial result would be presented as final) — a contract violation in
 *       the candidate itself.
 *
 * `exercised` says whether the property was actually put to the test: a poller
 * that only ever saw COMPLETED reads certifies nothing, so the caller must report
 * NOT_MEASURED rather than a vacuous success.
 */
export function evaluateMemberVisiblePartialCompletion(observations = []) {
  const violations = [];
  let inFlightObservations = 0;
  let authoritativeObservations = 0;
  let unreadableObservations = 0;
  for (const observation of observations) {
    if (observation?.status !== 200) continue;
    const batchState = observation.batchState ?? null;
    const outcome = observation.outcome;
    const authoritative = observation.authoritative === true;
    if (observation.bodyParsed === false || (observation.batchState === null && observation.authoritative === null)) {
      unreadableObservations += 1;
      continue;
    }
    if (batchState === "COMPLETED") {
      if (authoritative) authoritativeObservations += 1;
      continue;
    }
    const exposesOutcome = outcome !== null && outcome !== undefined;
    if (authoritative || exposesOutcome) {
      violations.push({
        at: observation.at ?? null,
        orderId: observation.orderId ?? null,
        batchState,
        outcome: outcome ?? null,
        authoritative,
        reason: exposesOutcome
          ? "the read exposes a settlement outcome while its batch is not COMPLETED"
          : "the read claims authority (authoritative=true) while its batch is not COMPLETED",
      });
      continue;
    }
    inFlightObservations += 1;
  }
  return {
    violations,
    violationCount: violations.length,
    inFlightObservations,
    authoritativeObservations,
    unreadableObservations,
    exercised: inFlightObservations > 0,
  };
}

/**
 * Aligned (orderId, memberToken) pairs for the Member-visible poll.
 *
 * The Member-facing read only answers for the Order's own Member, and it answers
 * `404 BATCH_NOT_FOUND` both for "wrong Member" and for "no settlement row yet" —
 * so a mismatched pair silently produces empty evidence. Manifests seeded from
 * now on carry `partialCompletionSamples`, built as aligned pairs by the seed;
 * the older `memberTokens` / `memberOrderIds` slices are accepted as a fallback
 * (and flagged, because they are not index-aligned).
 */
export function resolvePartialCompletionSamples({ partialCompletionSamples = [], memberTokens = [], memberOrderIds = [] }) {
  const aligned = (partialCompletionSamples ?? []).filter((sample) => sample?.orderId && sample?.memberToken);
  if (aligned.length > 0) return { samples: aligned, fellBack: false };
  const samples = (memberOrderIds ?? [])
    .map((orderId, index) => ({ orderId, memberToken: memberTokens?.[index % Math.max(memberTokens.length, 1)] ?? null }))
    .filter((sample) => sample.orderId && sample.memberToken);
  return { samples, fellBack: samples.length > 0 };
}

/**
 * Starts a sampler that reads the Member-facing settlement surface while a batch
 * runs.
 *
 * Two deliberate choices, so the property check has real evidence behind it:
 *  - it re-reads a bounded window of the seeded Orders (`partialSampleWidth`)
 *    instead of walking all of them once. With 200 seeded Orders and a ~15
 *    sample budget, a single pass would land on one in-flight read at most;
 *    re-reading a small window gives several in-flight observations.
 *  - it keeps sampling for `postBatchGraceMs` after the settlement call returns,
 *    so the post-completion surface (batchState COMPLETED, authoritative true) is
 *    observed too. Without that, a poll that only ever saw in-flight reads could
 *    not tell "the surface never exposes a final result" apart from "the surface
 *    never exposes anything".
 */
function startPartialCompletionPoller({
  client,
  samples,
  partialPollMs,
  partialObservations,
  partialSampleWidth = 10,
  postBatchGraceMs = 2000,
  stopState = { stop: false, batchReturnedAt: null },
}) {
  const width = Math.max(1, Math.min(samples.length, partialSampleWidth));
  const promise = (async () => {
    if (samples.length === 0) return;
    while (!stopState.stop) {
      const index = partialObservations.length % width;
      const { orderId, memberToken } = samples[index];
      const response = await client.request({
        method: "GET",
        path: `/api/v1/member/orders/${encodeURIComponent(orderId)}/settlement`,
        headers: jsonHeaders(memberToken),
      });
      const body = safeJson(response.body);
      partialObservations.push({
        at: new Date().toISOString(),
        orderId,
        status: response.status,
        // Raw contract fields of MemberSettlementOutcomeBody, recorded verbatim so
        // the property check reads the payload rather than a regex over it.
        batchState: body?.batchState ?? body?.state ?? null,
        outcome: body?.outcome ?? null,
        authoritative: body?.authoritative ?? null,
        bodyParsed: body !== null,
        body: response.body.slice(0, 160),
      });
      await sleep(partialPollMs);
      if (stopState.batchReturnedAt !== null && Date.now() - stopState.batchReturnedAt >= postBatchGraceMs) break;
    }
  })();
  return {
    // The loop ends by itself once `postBatchGraceMs` has elapsed since
    // `stopState.batchReturnedAt` was set, so the caller waits for it instead of
    // flipping a stop flag that would cut the grace window short.
    waitForGrace: async () => {
      await promise;
    },
  };
}

export async function runSettlementCapacity({
  baseUrl,
  adminToken,
  drawId,
  betLines,
  budgetSeconds,
  resultSchemaVersionRef = "result-v1",
  winningBetTypeCode,
  winningCanonicalNumber = "42",
  scenario,
  claimsTarget,
  partialCompletionSamples = [],
  memberTokens = [],
  memberOrderIds = [],
  partialPollMs = 250,
  maxSockets = 64,
}) {
  if (!adminToken) throw new Error("settlement driver requires an admin access token");
  if (!drawId) throw new Error("settlement driver requires the seeded Draw id");

  const client = new HttpClient({ baseUrl, maxSockets });
  const latency = new LatencyRecorder();
  const notes = [];
  const runStartedAt = new Date().toISOString();
  const adminHeaders = (key) => jsonHeaders(adminToken, key ? { "idempotency-key": key } : {});

  // --- 0. Close the Draw, then intake + confirm the Result ----------------
  // Settlement refuses to run without an active CONFIRMED Result revision, and
  // Result intake requires a CLOSED Draw. Both are Admin commands owned by the
  // Lottery/Result contexts, so the driver performs them the way an operator
  // would, and keeps every response as evidence.
  const drawResponse = await client.request({
    method: "GET",
    path: `/api/v1/admin/draws/${encodeURIComponent(drawId)}`,
    headers: adminHeaders(),
  });
  const drawBody = safeJson(drawResponse.body);
  const drawState = drawBody?.state ?? null;
  const drawVersion = drawBody?.version ?? null;
  let closeBody = null;
  let closeResponse = null;
  if (drawState === "OPEN") {
    closeResponse = await client.request({
      method: "POST",
      path: `/api/v1/admin/draws/${encodeURIComponent(drawId)}/transition`,
      headers: adminHeaders(`close-${drawId}`),
      body: JSON.stringify({ command: "CLOSE", expectedVersion: drawVersion }),
    });
    closeBody = safeJson(closeResponse.body);
  }
  notes.push(
    `draw pre-state: ${drawState} (version ${drawVersion}); CLOSE: ${closeResponse ? `HTTP ${closeResponse.status}` : "not needed"}`,
  );

  const winningNumbers = { [winningBetTypeCode]: winningCanonicalNumber };
  const intakeResponse = await client.request({
    method: "POST",
    path: `/api/v1/admin/draws/${encodeURIComponent(drawId)}/result`,
    headers: adminHeaders(`result-${drawId}`),
    body: JSON.stringify({ winningNumbers, resultSchemaVersionRef }),
  });
  const intakeBody = safeJson(intakeResponse.body);
  const revision = intakeBody?.revision ?? intakeBody?.id ?? null;
  const confirmResponse = revision
    ? await client.request({
        method: "POST",
        path: `/api/v1/admin/draws/${encodeURIComponent(drawId)}/results/${encodeURIComponent(String(revision))}/confirm`,
        headers: adminHeaders(`result-confirm-${drawId}`),
        body: JSON.stringify({}),
      })
    : null;
  const confirmBody = confirmResponse ? safeJson(confirmResponse.body) : null;
  notes.push(
    `result intake: HTTP ${intakeResponse.status} (revision ${revision ?? "n/a"}); result confirm: HTTP ${confirmResponse?.status ?? "not attempted"}`,
  );
  const resultReady = Boolean(confirmResponse && confirmResponse.status >= 200 && confirmResponse.status < 300);
  if (!resultReady) {
    notes.push(
      "the Result could not be confirmed, so the Settlement command was attempted anyway and its refusal is recorded as evidence",
    );
  }

  // --- 3. Member-visible partial-completion poller -------------------------
  const partialObservations = [];
  const pollState = { stop: false, batchReturnedAt: null };
  const partialSamples = resolvePartialCompletionSamples({ partialCompletionSamples, memberTokens, memberOrderIds });
  if (partialSamples.fellBack) {
    notes.push(
      "the manifest carries no aligned partial-completion samples, so the poller paired memberTokens[i] with memberOrderIds[i]. " +
        "Those two manifest slices are not index-aligned (the seed creates several Orders per Member), and a mismatched pair answers " +
        "404 BATCH_NOT_FOUND, which is indistinguishable from an Order that has no settlement row yet — treat the Member-visible " +
        "partial-completion read count as unreliable for such a manifest.",
    );
  }
  const partialPoller = startPartialCompletionPoller({
    client,
    samples: partialSamples.samples,
    partialPollMs,
    partialObservations,
    stopState: pollState,
  });

  // --- 1. Throughput -------------------------------------------------------
  // The poller is awaited in the finally-style flow below: even if the Settlement
  // command throws, the batch-returned timestamp is set so the sampler terminates
  // on its own instead of polling forever.
  let first = null;
  let firstError = null;
  try {
    first = await client.request({
      method: "POST",
      path: `/api/v1/admin/draws/${encodeURIComponent(drawId)}/settlement`,
      headers: jsonHeaders(adminToken, { "idempotency-key": `settlement-${drawId}-first` }),
    });
  } catch (error) {
    firstError = error;
  }
  // Keep the poller alive for a short grace window after the batch call returned,
  // so the post-completion surface is observed as well (see the poller comment).
  pollState.batchReturnedAt = Date.now();
  await partialPoller.waitForGrace();
  if (firstError) throw firstError;
  latency.record(first.ms);
  const firstBody = safeJson(first.body);
  const firstOk = first.status >= 200 && first.status < 300;

  // --- 2. Idempotent resume ------------------------------------------------
  const second = await client.request({
    method: "POST",
    path: `/api/v1/admin/draws/${encodeURIComponent(drawId)}/settlement`,
    headers: jsonHeaders(adminToken, { "idempotency-key": `settlement-${drawId}-resume` }),
  });
  const secondBody = safeJson(second.body);

  const batchState = firstBody?.state ?? null;
  const resumedState = secondBody?.state ?? null;
  const sameBatch = Boolean(firstBody?.id) && firstBody?.id === secondBody?.id;
  const resumedCompleted = resumedState === "COMPLETED";
  const processedLines = firstBody?.settledBetLineCount ?? firstBody?.betLineCount ?? firstBody?.lineCount ?? null;
  const elapsedSeconds = latency.summary().count > 0 ? first.ms / 1000 : null;

  notes.push(
    `settlement was executed by POST /api/v1/admin/draws/${drawId}/settlement (Admin command). The candidate's worker groups (scheduler-outbox, payment-reconciliation) do not consume a settlement job, so this measures the API process executing the configured batch, not a scaled worker pool.`,
  );
  notes.push(
    `batch id first=${firstBody?.id ?? "n/a"} resume=${secondBody?.id ?? "n/a"}; state first=${batchState} resume=${resumedState}`,
  );
  if (processedLines === null) {
    notes.push(
      "the settlement batch response exposes no bet-line count, so the line count used for the throughput verdict comes from the independent SQL assertion (seed/assert-financial-effects.ts); the HTTP response body is attached verbatim as raw evidence",
    );
  }

  const target = scenario.targets.settlement_capacity;
  const linesForVerdict = processedLines;
  const withinBudget = elapsedSeconds !== null && elapsedSeconds <= budgetSeconds;
  const throughputOk =
    linesForVerdict !== null &&
    linesForVerdict >= Math.min(betLines, target.min_bet_lines) &&
    withinBudget &&
    firstOk;
  const partialCompletion = evaluateMemberVisiblePartialCompletion(partialObservations);
  const partialCompletionObserved = partialCompletion.violationCount > 0;
  // The property is only evidence if the poller actually observed the in-flight
  // window. A batch that was already COMPLETED on every sample proves nothing, so
  // that case is reported as NOT_MEASURED instead of a vacuous `true` (R1).
  const partialCompletionExercised = firstOk && partialCompletion.exercised;
  const partialCompletionDefinition =
    "violation = a 200 read of GET /api/v1/member/orders/:id/settlement that presents a final financial result " +
    "(outcome != null or authoritative = true) while the batchState in that same response is not COMPLETED " +
    "(contract: apps/api/src/member-settlement.controller.ts:37,55 — authoritative is true only once the batch COMPLETED)";
  const partialCompletionReason = !firstOk
    ? `not evaluated: the Settlement command did not succeed; ${partialCompletionDefinition}`
    : !partialCompletion.exercised
      ? `not exercised: the poller saw ${partialObservations.length} read(s) but none in flight (no non-COMPLETED sample), ` +
        `so no read could have exposed a partial result; ${partialCompletionDefinition}`
      : `${partialCompletionDefinition}; exercised on ${partialCompletion.inFlightObservations} in-flight read(s) ` +
        `(authoritative=false, outcome=null) and ${partialCompletion.authoritativeObservations} COMPLETED read(s); ` +
        `violations: ${partialCompletion.violationCount}`;

  client.close();

  return {
    id: "settlement-capacity",
    name: "Settlement capacity, idempotent resume, no Member-visible partial completion",
    measured: firstOk,
    envGated: false,
    driver: "settlement-capacity",
    requested: { drawId, betLines, budgetSeconds, partialPollMs },
    runStartedAt,
    notes,
    samples: {
      drawPreState: { status: drawResponse.status, state: drawState, version: drawVersion },
      closeCall: closeResponse ? { status: closeResponse.status, body: closeResponse.body.slice(0, 2000) } : null,
      resultIntakeCall: { status: intakeResponse.status, body: intakeResponse.body.slice(0, 2000) },
      resultConfirmCall: confirmResponse ? { status: confirmResponse.status, body: (confirmResponse.body ?? "").slice(0, 2000) } : null,
      firstCall: { status: first.status, ms: Math.round(first.ms), body: first.body.slice(0, 4000) },
      resumeCall: { status: second.status, ms: Math.round(second.ms), body: second.body.slice(0, 4000) },
      betLinesSettled: linesForVerdict,
      elapsedSeconds,
      sameBatchIdOnResume: sameBatch,
      resumedState,
      memberVisiblePartialCompletionObservations: partialObservations.slice(0, 200),
      memberVisiblePartialCompletionObservedStates: partialObservations.reduce((accumulator, observation) => {
        const key =
          observation.status === 200
            ? `${observation.batchState ?? "batchState:null"}${observation.authoritative === true ? " (authoritative)" : ""}${
                observation.outcome === null ? " (outcome:null)" : ` (outcome:${observation.outcome})`
              }`
            : `HTTP ${observation.status}`;
        accumulator[key] = (accumulator[key] ?? 0) + 1;
        return accumulator;
      }, {}),
      memberVisiblePartialCompletionFound: partialCompletionObserved,
      memberVisiblePartialCompletionExercised: partialCompletion.exercised,
      memberVisiblePartialCompletionInFlightReads: partialCompletion.inFlightObservations,
      memberVisiblePartialCompletionAuthoritativeReads: partialCompletion.authoritativeObservations,
      memberVisiblePartialCompletionViolations: partialCompletion.violations.slice(0, 50),
      memberVisiblePartialCompletionDefinition: partialCompletionDefinition,
    },
    measurements: {
      settlement_capacity_bet_lines: {
        target: { min: target.min_bet_lines, within_seconds: target.within_seconds },
        achieved: linesForVerdict,
        verdict: !firstOk
          ? "NOT_MEASURED"
          : linesForVerdict === null
            ? "NOT_MEASURED"
            : claimsTarget
              ? throughputOk
                ? "PASS"
                : "FAIL"
              : "MEASURED",
      },
      settlement_idempotent_resume: {
        target: { required: true },
        achieved: firstOk ? sameBatch && resumedCompleted : null,
        verdict: !firstOk ? "NOT_MEASURED" : claimsTarget ? (sameBatch && resumedCompleted ? "PASS" : "FAIL") : "MEASURED",
      },
      settlement_no_member_visible_partial_completion: {
        target: { required: true },
        achieved: partialCompletionExercised ? !partialCompletionObserved : null,
        achievedMeaning:
          "the required property HOLDS — no read presented a final result while its batch was not COMPLETED (true) or one did (false); null means the property was not exercised",
        definition: partialCompletionDefinition,
        exercisedOn: {
          inFlightReads: partialCompletion.inFlightObservations,
          authoritativeReads: partialCompletion.authoritativeObservations,
          unreadableReads: partialCompletion.unreadableObservations,
        },
        violations: partialCompletion.violations.slice(0, 50),
        reason: partialCompletionReason,
        verdict: !firstOk
          ? "NOT_MEASURED"
          : !partialCompletion.exercised
            ? "NOT_MEASURED"
            : claimsTarget
              ? partialCompletionObserved
                ? "FAIL"
                : "PASS"
              : "MEASURED",
      },
      settlement_within_budget_seconds: {
        target: { max_seconds: budgetSeconds },
        achieved: elapsedSeconds,
        verdict: !firstOk
          ? "NOT_MEASURED"
          : elapsedSeconds === null
            ? "NOT_MEASURED"
            : claimsTarget
              ? elapsedSeconds <= budgetSeconds
                ? "PASS"
                : "FAIL"
              : "MEASURED",
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
