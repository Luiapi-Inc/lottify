// Once-only stake-effect evaluation (pure, unit-testable).
//
// The Ticket 13 target is "no duplicate financial effect under load". The
// evidence for it is SQL over the dedicated load database, and this module turns
// those rows into checks + failures. It is deliberately pure so the rule can be
// tested without a database.
//
// Two mistakes this module exists to prevent, both found in review:
//   1. Filtering the population to one Order state. The settlement driver moves
//      the seeded Orders CONFIRMED -> SETTLED earlier in the same run, so a
//      `state === "CONFIRMED"` filter examined zero rows and the duplicate/missing
//      counters were 0-over-zero — an empty check that read as PASS.
//   2. Only examining the seeded population. The Orders the live load creates are
//      equally subject to a duplicate stake effect, so the scope is the whole
//      dedicated load database, not the manifest list.
//
// An empty examined population is therefore a FAILURE, never a pass.

/** States that only exist after the stake was committed (reserve + commit). */
export const STAKE_EXPECTED_STATES = ["CONFIRMED", "SETTLED", "CANCELLING", "CANCELLED"];

/**
 * States that may legitimately be reached without a durable stake effect yet.
 * A run that ends while an Order is mid-confirm is reported, not failed: the
 * stake commit is the step that resolves CONFIRMING, so an in-flight Order is
 * simply not yet assertable.
 */
export const STAKE_IN_FLIGHT_STATES = ["CONFIRMING"];

/** Business transaction ids that are not the bare Order id. */
const REFUND_SUFFIX = ":refund";

/**
 * @param {object} input
 * @param {Array<{id: string, state: string}>} input.orders      every Bet Order in the load DB
 * @param {Array<{businessTransactionId: string}>} input.stakeCommits  BET_STAKE_COMMIT rows
 * @param {Array<{businessTransactionId: string}>} input.refunds       BET_STAKE_REFUND rows
 * @param {string[]} [input.manifestOrderIds]                   the seeded settlement population
 */
export function evaluateStakeEffectOnceOnly({ orders, stakeCommits, refunds = [], manifestOrderIds = [] }) {
  const checks = {};
  const failures = [];
  const samples = {};

  const orderIds = new Set(orders.map((order) => order.id));

  const stateHistogram = {};
  for (const order of orders) stateHistogram[order.state] = (stateHistogram[order.state] ?? 0) + 1;

  // Per-Order stake commit counts, over EVERY Order in the scope. A second stake
  // commit is never legitimate, whatever the state.
  const stakeCommitCount = new Map();
  let stakeCommitsUnmatchedOrders = 0;
  const unmatchedStakeSamples = [];
  for (const commit of stakeCommits) {
    const orderId = commit.businessTransactionId;
    stakeCommitCount.set(orderId, (stakeCommitCount.get(orderId) ?? 0) + 1);
    if (!orderIds.has(orderId)) {
      stakeCommitsUnmatchedOrders += 1;
      if (unmatchedStakeSamples.length < 10) unmatchedStakeSamples.push(orderId);
    }
  }

  const refundCount = new Map();
  let refundsUnmatchedOrders = 0;
  for (const refund of refunds) {
    const reference = refund.businessTransactionId;
    const orderId = reference.endsWith(REFUND_SUFFIX) ? reference.slice(0, -REFUND_SUFFIX.length) : reference;
    refundCount.set(orderId, (refundCount.get(orderId) ?? 0) + 1);
    if (!orderIds.has(orderId)) refundsUnmatchedOrders += 1;
  }

  const stakeExpected = orders.filter((order) => STAKE_EXPECTED_STATES.includes(order.state));
  let ordersWithStakeEffect = 0;
  let ordersMissingStakeEffect = 0;
  const missingStakeSamples = [];
  for (const order of stakeExpected) {
    const count = stakeCommitCount.get(order.id) ?? 0;
    if (count === 1) ordersWithStakeEffect += 1;
    if (count === 0) {
      ordersMissingStakeEffect += 1;
      if (missingStakeSamples.length < 10) missingStakeSamples.push({ orderId: order.id, state: order.state });
    }
  }

  let ordersWithDuplicateStakeEffect = 0;
  const duplicateStakeSamples = [];
  for (const order of orders) {
    const count = stakeCommitCount.get(order.id) ?? 0;
    if (count > 1) {
      ordersWithDuplicateStakeEffect += 1;
      if (duplicateStakeSamples.length < 10) duplicateStakeSamples.push({ orderId: order.id, state: order.state, stakeTransactions: count });
    }
  }

  let ordersWithDuplicateRefundEffect = 0;
  const duplicateRefundSamples = [];
  for (const order of orders) {
    const count = refundCount.get(order.id) ?? 0;
    if (count > 1) {
      ordersWithDuplicateRefundEffect += 1;
      if (duplicateRefundSamples.length < 10) duplicateRefundSamples.push({ orderId: order.id, refundTransactions: count });
    }
  }

  const ordersInFlightNotAsserted = orders.filter((order) => STAKE_IN_FLIGHT_STATES.includes(order.state)).length;

  // Manifest coverage: the seeded settlement population must be inside the
  // examined scope, otherwise the SQL ran against the wrong database.
  const manifestSet = new Set(manifestOrderIds);
  const manifestInScope = orders.filter((order) => manifestSet.has(order.id));
  const manifestStakeExpected = manifestInScope.filter((order) => STAKE_EXPECTED_STATES.includes(order.state));

  checks.ordersExamined = orders.length;
  checks.ordersByState = stateHistogram;
  checks.stakeExpectedOrders = stakeExpected.length;
  checks.ordersWithStakeEffect = ordersWithStakeEffect;
  checks.ordersMissingStakeEffect = ordersMissingStakeEffect;
  checks.ordersWithDuplicateStakeEffect = ordersWithDuplicateStakeEffect;
  checks.stakeCommitTransactions = stakeCommits.length;
  checks.stakeCommitsUnmatchedOrders = stakeCommitsUnmatchedOrders;
  checks.refundTransactions = refunds.length;
  checks.refundsUnmatchedOrders = refundsUnmatchedOrders;
  checks.ordersWithDuplicateRefundEffect = ordersWithDuplicateRefundEffect;
  checks.ordersInFlightNotAsserted = ordersInFlightNotAsserted;
  checks.manifestOrdersExamined = manifestInScope.length;
  checks.manifestOrdersMissingFromScope = manifestOrderIds.length - manifestInScope.length;
  checks.manifestStakeExpectedOrders = manifestStakeExpected.length;
  checks.stakeEffectExaminedPopulation = stakeExpected.length;
  checks.duplicateFinancialEffectsFound =
    ordersWithDuplicateStakeEffect + ordersWithDuplicateRefundEffect + stakeCommitsUnmatchedOrders + refundsUnmatchedOrders;

  samples.duplicateStakeSamples = duplicateStakeSamples;
  samples.missingStakeSamples = missingStakeSamples;
  samples.duplicateRefundSamples = duplicateRefundSamples;
  samples.unmatchedStakeSamples = unmatchedStakeSamples;

  // ---- empty-population guards (an empty check must never read as a pass) ---
  if (orders.length === 0) {
    failures.push(
      "the once-only stake-effect assertion examined 0 Bet Orders in the load database: there is no evidence behind the no-duplicate-financial-effect target",
    );
  }
  if (stakeExpected.length === 0) {
    failures.push(
      `0 Bet Orders reached a stake-committed state (${STAKE_EXPECTED_STATES.join("/")}): the once-only stake-effect assertion examined an empty population and cannot certify the no-duplicate-financial-effect target`,
    );
  }
  if (manifestOrderIds.length > 0 && manifestInScope.length === 0) {
    failures.push(
      `none of the ${manifestOrderIds.length} seeded settlement Orders are present in the examined database (wrong database, or the manifest belongs to another run)`,
    );
  }
  if (manifestOrderIds.length > 0 && manifestInScope.length > 0 && manifestStakeExpected.length === 0) {
    failures.push(
      `0 of the ${manifestInScope.length} seeded settlement Orders in scope reached a stake-committed state: the seeded population was never asserted`,
    );
  }

  // ---- fact failures -------------------------------------------------------
  if (ordersMissingStakeEffect > 0) {
    failures.push(`${ordersMissingStakeEffect} order(s) in a stake-committed state have no stake financial transaction`);
  }
  if (ordersWithDuplicateStakeEffect > 0) {
    failures.push(`${ordersWithDuplicateStakeEffect} order(s) have more than one stake financial transaction`);
  }
  if (ordersWithDuplicateRefundEffect > 0) {
    failures.push(`${ordersWithDuplicateRefundEffect} order(s) have more than one stake refund transaction`);
  }
  if (stakeCommitsUnmatchedOrders > 0) {
    failures.push(`${stakeCommitsUnmatchedOrders} stake financial transaction(s) reference an Order that does not exist`);
  }
  if (refundsUnmatchedOrders > 0) {
    failures.push(`${refundsUnmatchedOrders} stake refund transaction(s) reference an Order that does not exist`);
  }

  return { checks, failures, samples };
}
