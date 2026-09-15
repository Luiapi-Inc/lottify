// Test doubles for the Draw-cancellation refund (Issue 116).
//
// `InMemoryStakeRefundRepository` implements the same contract as the Prisma
// repository, with two deliberate knobs:
//   - `mode: "superset"` returns every Order of the Draw, so a test can prove the
//     caller's refundability predicate is what skips Orders rather than trusting
//     the fake's own WHERE clause;
//   - `onBeforeClaim` runs between the read and the optimistic-concurrency claim,
//     which lets a test interleave a concurrent writer deterministically.
//
// `FakeBetOrderWalletPort` reproduces the one behaviour the whole operation rests
// on: `BET_STAKE_REFUND` is idempotent per Bet Order, so re-driving an Order
// returns the durable reversal instead of posting a second one.

import type { BetOrderWalletPort, BetStakeEffect } from "../../src/contexts/betting/application/betting-order-wallet.port";
import {
  isRefundableStakeOrder,
  type StakeOrderRecord,
} from "../../src/contexts/betting/domain/stake-refund";
import type {
  StakeRefundClaim,
  StakeRefundRepository,
  StakeRefundSettlement,
} from "../../src/contexts/betting/domain/stake-refund.repository";

export interface RecordedClaim {
  readonly orderId: string;
  readonly expectedState: string;
  readonly nextState: string;
  readonly idempotencyKey: string;
}

export interface RecordedSettlement {
  readonly orderId: string;
  readonly refundTransactionId: string;
  readonly reason: string | null;
}

export class InMemoryStakeRefundRepository implements StakeRefundRepository {
  private readonly rows = new Map<string, StakeOrderRecord>();
  readonly claims: RecordedClaim[] = [];
  readonly settlements: RecordedSettlement[] = [];

  /** Interleaves a concurrent writer between the read and the claim. */
  onBeforeClaim: (() => void | Promise<void>) | null = null;

  constructor(private readonly mode: "narrow" | "superset" = "narrow") {}

  seed(record: StakeOrderRecord): void {
    this.rows.set(record.id, { ...record });
  }

  /** Emulates durable state written by another writer or left by a crash. */
  patch(orderId: string, changes: Partial<StakeOrderRecord>): void {
    const current = this.rows.get(orderId);
    if (!current) throw new Error(`unknown Order ${orderId}`);
    this.rows.set(orderId, { ...current, ...changes });
  }

  record(orderId: string): StakeOrderRecord | undefined {
    return this.rows.get(orderId);
  }

  async listRefundableStakes(drawId: string): Promise<readonly StakeOrderRecord[]> {
    const ofDraw = [...this.rows.values()].filter((row) => row.drawId === drawId);
    if (this.mode === "superset") return ofDraw;
    return ofDraw.filter(isRefundableStakeOrder);
  }

  async readOrder(orderId: string): Promise<StakeOrderRecord | null> {
    return this.rows.get(orderId) ?? null;
  }

  async claimForRefund(claim: StakeRefundClaim): Promise<StakeOrderRecord | null> {
    if (this.onBeforeClaim) await this.onBeforeClaim();
    const current = this.rows.get(claim.orderId);
    if (
      !current ||
      current.state !== claim.expectedState ||
      current.version !== claim.expectedVersion
    ) {
      return null;
    }
    this.claims.push({
      orderId: claim.orderId,
      expectedState: claim.expectedState,
      nextState: claim.nextState,
      idempotencyKey: claim.idempotencyKey,
    });
    const next: StakeOrderRecord = {
      ...current,
      state: claim.nextState,
      version: claim.nextVersion,
    };
    this.rows.set(next.id, next);
    return next;
  }

  async settleRefund(settlement: StakeRefundSettlement): Promise<StakeOrderRecord | null> {
    const current = this.rows.get(settlement.orderId);
    if (
      !current ||
      current.state !== "CANCELLING" ||
      current.version !== settlement.expectedVersion
    ) {
      return null;
    }
    this.settlements.push({
      orderId: settlement.orderId,
      refundTransactionId: settlement.refundTransactionId,
      reason: settlement.reason,
    });
    const next: StakeOrderRecord = {
      ...current,
      state: "CANCELLED",
      version: settlement.nextVersion,
      refundTransactionId: settlement.refundTransactionId,
    };
    this.rows.set(next.id, next);
    return next;
  }
}

export class FakeBetOrderWalletPort implements BetOrderWalletPort {
  private readonly refundPostings = new Map<string, string>();
  private readonly failing = new Set<string>();
  readonly refundRequests: Array<{
    readonly orderId: string;
    readonly memberId: string;
    readonly stakeTransactionId: string;
  }> = [];

  async commitStake(): Promise<BetStakeEffect> {
    throw new Error("a Draw-cancellation refund never commits a stake");
  }

  async refundStake(input: {
    orderId: string;
    memberId: string;
    stakeTransactionId: string;
    currency: "THB";
    correlationId: string;
  }): Promise<BetStakeEffect> {
    this.refundRequests.push({
      orderId: input.orderId,
      memberId: input.memberId,
      stakeTransactionId: input.stakeTransactionId,
    });
    if (this.failing.has(input.orderId)) {
      throw new Error(`ledger is unavailable for Bet Order ${input.orderId}`);
    }
    const existing = this.refundPostings.get(input.orderId);
    if (existing) {
      return { reservationId: `reservation-${input.orderId}`, transactionId: existing };
    }
    const transactionId = `refund-transaction-${this.refundPostings.size + 1}`;
    this.refundPostings.set(input.orderId, transactionId);
    return { reservationId: `reservation-${input.orderId}`, transactionId };
  }

  /** Makes the reversal fail for one Order so a partial run can be exercised. */
  failRefundFor(orderId: string): void {
    this.failing.add(orderId);
  }

  clearRefundFailure(orderId: string): void {
    this.failing.delete(orderId);
  }

  /**
   * Replays the durable reversal a crashed run already posted, so a re-driven
   * run must reuse it rather than post a second one.
   */
  seedDurableReversal(orderId: string): string {
    const transactionId = `refund-transaction-${this.refundPostings.size + 1}`;
    this.refundPostings.set(orderId, transactionId);
    return transactionId;
  }

  /** The durable reversals actually posted — at most one per Bet Order. */
  get postedRefundCount(): number {
    return this.refundPostings.size;
  }

  postedRefundFor(orderId: string): string | undefined {
    return this.refundPostings.get(orderId);
  }
}
