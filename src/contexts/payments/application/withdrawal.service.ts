import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import {
  PAYOUT_PROVIDER_ADAPTER,
  PayoutProviderAdapterError,
  type GetPayoutStatusResult,
  type PayoutProviderAdapter,
} from "./payout-provider.adapter";
import {
  MEMBER_WITHDRAWAL_RESTRICTION_PORT,
  type MemberWithdrawalRestrictionPort,
} from "./withdrawal-restriction.port";
import {
  WITHDRAWAL_LEDGER_PORT,
  WithdrawalFundsUnavailableError,
  type WithdrawalLedgerPort,
} from "./withdrawal-ledger.port";
import {
  PAYOUT_DESTINATION_REPOSITORY,
  type PayoutDestinationRepository,
} from "../domain/payout-destination.repository";
import {
  payoutDestinationIsUsable,
  type PayoutDestination,
} from "../domain/payout-destination";
import { createPaymentFeeQuote } from "../domain/payment-fee-policy";
import type { PaymentCurrency, PaymentProviderOutcome } from "../domain/payment-provider-result";
import {
  WITHDRAWAL_REPOSITORY,
  type CreateWithdrawalInput,
  type WithdrawalEventRecord,
  type WithdrawalListPage,
  type WithdrawalListQuery,
  type WithdrawalRecord,
  type WithdrawalRepository,
  type WithdrawalTransitionPatch,
} from "../domain/withdrawal.repository";
import {
  PAYOUT_PROVIDER_ID,
  WithdrawalError,
  assertWithdrawalTransition,
  validateWithdrawalInitiation,
  withdrawalIsTerminal,
  withdrawalStateForPayoutOutcome,
  type WithdrawalState,
} from "../domain/withdrawal";
import {
  WITHDRAWAL_ELIGIBILITY_POLICY_VERSION,
  resolveWithdrawalEligibility,
  type WithdrawalEligibilityDecision,
} from "../domain/withdrawal-eligibility";

/** Bounded freshness window for the withdrawal eligibility decision. */
export const WITHDRAWAL_ELIGIBILITY_VALIDITY_MS = 5 * 60 * 1000;

export interface CreateWithdrawalCommand {
  payoutDestinationId: string;
  amountMinor: bigint;
  currency: PaymentCurrency;
  idempotencyKey: string;
}

export interface AdminWithdrawalDecisionCommand {
  adminId: string;
  reason: string;
}

@Injectable()
export class WithdrawalService {
  constructor(
    @Inject(WITHDRAWAL_REPOSITORY) private readonly withdrawals: WithdrawalRepository,
    @Inject(PAYOUT_DESTINATION_REPOSITORY)
    private readonly destinations: PayoutDestinationRepository,
    @Inject(WITHDRAWAL_LEDGER_PORT) private readonly ledger: WithdrawalLedgerPort,
    @Inject(PAYOUT_PROVIDER_ADAPTER) private readonly provider: PayoutProviderAdapter,
    @Inject(MEMBER_WITHDRAWAL_RESTRICTION_PORT)
    private readonly restrictions: MemberWithdrawalRestrictionPort,
  ) {}

  /**
   * Creates a Withdrawal idempotently by a scoped Idempotency-Key. The
   * authoritative Reservation is created by Wallet & Ledger and the resulting
   * available balance is never exceeded; a policy DENY is terminal `REJECTED`
   * before any Reservation exists.
   */
  async createWithdrawal(
    memberId: string,
    command: CreateWithdrawalCommand,
    correlationId: string,
  ): Promise<WithdrawalRecord> {
    const key = command.idempotencyKey.trim();
    if (!key || key.length > 200) {
      throw new WithdrawalError(
        "INVALID",
        "Idempotency-Key is required and must be at most 200 characters",
      );
    }
    validateWithdrawalInitiation(command);

    const scope = `WITHDRAWAL_CREATE:${memberId}`;
    const fingerprint = withdrawalFingerprint({
      memberId,
      payoutDestinationId: command.payoutDestinationId,
      amountMinor: command.amountMinor,
      currency: command.currency,
    });

    const existing = await this.withdrawals.findByIdempotency(scope, key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new WithdrawalError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different withdrawal payload",
        );
      }
      return existing;
    }

    const destination = await this.destinations.findById(command.payoutDestinationId);
    if (!destination || destination.memberId !== memberId) {
      /**
       * The referenced destination does not exist, or is not this Member's. That
       * is a rejected *request*, not a rejection of a persisted withdrawal: no
       * Withdrawal row is written, so the caller always receives a mapped client
       * error instead of an unmapped persistence failure. Both cases are reported
       * identically so the response cannot be used to probe whether another
       * Member's destination identity exists.
       */
      throw new WithdrawalError(
        "PAYOUT_DESTINATION_NOT_ELIGIBLE",
        "Payout Destination is not linked to this Member",
      );
    }
    const correlation = correlationId || randomUUID();
    const decision = await this.evaluateEligibility(memberId, destination);
    const feeQuote = createPaymentFeeQuote({
      operation: "WITHDRAWAL",
      providerCode: PAYOUT_PROVIDER_ID,
      methodCode: destination?.type ?? "BANK_ACCOUNT",
      amountMinor: command.amountMinor,
    });

    const id = randomUUID();
    const create: CreateWithdrawalInput = {
      id,
      memberId,
      payoutDestinationId: command.payoutDestinationId,
      amountMinor: command.amountMinor,
      feeMinor: feeQuote.feeMinor,
      currency: command.currency,
      eligibilityOutcome: decision.outcome,
      eligibilityPolicyVersion: decision.policyVersion,
      eligibilityReasonCodes: decision.reasonCodes,
      eligibilityEvidenceRefs: decision.evidenceRefs,
      requiresApproval: decision.outcome === "REVIEW_REQUIRED",
      idempotencyScope: scope,
      idempotencyKey: key,
      fingerprint,
      providerId: PAYOUT_PROVIDER_ID,
      providerReferenceKey: `wdr:${id}`,
      correlationId: correlation,
    };

    const created = await this.withdrawals.create(create);
    if (!created) {
      // A concurrent request with the same key won the insert: replay its result.
      const raced = await this.withdrawals.findByIdempotency(scope, key);
      if (!raced) throw new WithdrawalError("INVALID", "Withdrawal could not be created");
      if (raced.fingerprint !== fingerprint) {
        throw new WithdrawalError(
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different withdrawal payload",
        );
      }
      return raced;
    }

    if (decision.outcome === "DENY") {
      return this.transitionOrThrow(
        created,
        "REQUESTED",
        "REJECTED",
        { failureReason: decision.reasonCodes.join(",") },
        {
          actorType: "SYSTEM",
          reason: decision.reasonCodes.join(","),
          evidenceRef: decision.evidenceRefs[0] ?? null,
          correlationId: correlation,
        },
      );
    }

    let reservationId: string;
    try {
      reservationId = await this.ledger.reserveWithdrawal({
        withdrawalId: created.id,
        memberId,
        amountMinor: created.amountMinor,
        currency: created.currency,
        correlationId: correlation,
      });
    } catch (error) {
      const insufficient = error instanceof WithdrawalFundsUnavailableError;
      await this.transitionOrThrow(
        created,
        "REQUESTED",
        "REJECTED",
        { failureReason: insufficient ? "INSUFFICIENT_FUNDS" : "RESERVATION_FAILED" },
        {
          actorType: "SYSTEM",
          reason: insufficient ? "INSUFFICIENT_FUNDS" : "RESERVATION_FAILED",
          correlationId: correlation,
        },
      );
      if (insufficient) {
        throw new WithdrawalError(
          "INSUFFICIENT_FUNDS",
          "Withdrawal exceeds the available spendable balance",
        );
      }
      throw error;
    }

    const reserved = await this.transitionOrThrow(
      created,
      "REQUESTED",
      "RESERVING",
      { reservationId },
      { actorType: "SYSTEM", correlationId: correlation },
    );

    return this.transitionOrThrow(
      reserved,
      "RESERVING",
      created.requiresApproval ? "REVIEWING" : "APPROVED",
      {},
      { actorType: "SYSTEM", correlationId: correlation },
    );
  }

  async getWithdrawal(memberId: string, withdrawalId: string): Promise<WithdrawalRecord> {
    return this.requireOwnedWithdrawal(memberId, withdrawalId);
  }

  /**
   * Admin control-plane read. Authorization is the Admin capability boundary, so
   * the Member ownership check does not apply; the returned record is the
   * canonical orchestration state plus evidence, never a balance authority.
   */
  getWithdrawalForAdministration(withdrawalId: string): Promise<WithdrawalRecord> {
    return this.requireWithdrawal(withdrawalId);
  }

  listMemberWithdrawals(
    memberId: string,
    query: { limit: number; cursor?: WithdrawalListQuery["cursor"] },
  ): Promise<WithdrawalListPage> {
    return this.withdrawals.list({
      memberId,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
  }

  listWithdrawals(query: WithdrawalListQuery): Promise<WithdrawalListPage> {
    return this.withdrawals.list(query);
  }

  listEvents(withdrawalId: string): Promise<readonly WithdrawalEventRecord[]> {
    return this.withdrawals.listEvents(withdrawalId);
  }

  /**
   * Member cancellation before payout releases the Reservation through the
   * owning workflow (ADR 0003). Once a payout is in flight (or its outcome is
   * unknown) cancellation is refused: the funds must remain reserved until the
   * payout outcome is authoritative.
   */
  async cancelWithdrawal(
    memberId: string,
    withdrawalId: string,
    correlationId: string,
  ): Promise<WithdrawalRecord> {
    const withdrawal = await this.requireOwnedWithdrawal(memberId, withdrawalId);
    if (withdrawal.state === "CANCELLED") return withdrawal;
    if (withdrawalIsTerminal(withdrawal.state)) {
      throw new WithdrawalError(
        "STATE_CONFLICT",
        `Withdrawal cannot be cancelled from ${withdrawal.state}`,
      );
    }
    if (!["RESERVING", "REVIEWING", "APPROVED"].includes(withdrawal.state)) {
      throw new WithdrawalError(
        "STATE_CONFLICT",
        "Withdrawal can no longer be cancelled once payout is in flight",
      );
    }

    const cancelling = await this.transitionOrThrow(
      withdrawal,
      withdrawal.state,
      "CANCELLING",
      {},
      { actorType: "MEMBER", actorId: memberId, correlationId },
    );
    await this.releaseReservation(cancelling, correlationId);
    return this.transitionOrThrow(
      cancelling,
      "CANCELLING",
      "CANCELLED",
      {},
      { actorType: "MEMBER", actorId: memberId, correlationId },
    );
  }

  /** Governed Admin review decision: approval moves the withdrawal to payout eligibility. */
  async approveWithdrawal(
    withdrawalId: string,
    command: AdminWithdrawalDecisionCommand,
    correlationId: string,
  ): Promise<WithdrawalRecord> {
    const withdrawal = await this.requireWithdrawal(withdrawalId);
    const reason = command.reason.trim();
    if (!reason) {
      throw new WithdrawalError("INVALID", "Withdrawal approval reason is required");
    }
    if (withdrawal.state !== "REVIEWING") {
      throw new WithdrawalError(
        "STATE_CONFLICT",
        `Withdrawal cannot be approved from ${withdrawal.state}`,
      );
    }
    return this.transitionOrThrow(
      withdrawal,
      "REVIEWING",
      "APPROVED",
      { decidedByAdminId: command.adminId, decisionReason: reason },
      { actorType: "ADMIN", actorId: command.adminId, reason, correlationId },
    );
  }

  /**
   * Governed Admin review rejection: the Reservation is released through the
   * authoritative release path so the Member's available balance is restored
   * by Wallet & Ledger, never by a Payments-side balance edit.
   */
  async rejectWithdrawal(
    withdrawalId: string,
    command: AdminWithdrawalDecisionCommand,
    correlationId: string,
  ): Promise<WithdrawalRecord> {
    const withdrawal = await this.requireWithdrawal(withdrawalId);
    const reason = command.reason.trim();
    if (!reason) {
      throw new WithdrawalError("INVALID", "Withdrawal rejection reason is required");
    }
    if (withdrawal.state === "REJECTED") return withdrawal;
    if (withdrawal.state !== "REVIEWING" && withdrawal.state !== "APPROVED") {
      throw new WithdrawalError(
        "STATE_CONFLICT",
        `Withdrawal cannot be rejected from ${withdrawal.state}`,
      );
    }

    const rejected = await this.transitionOrThrow(
      withdrawal,
      withdrawal.state,
      "REJECTED",
      {
        decidedByAdminId: command.adminId,
        decisionReason: reason,
        failureReason: "REJECTED_BY_REVIEW",
      },
      { actorType: "ADMIN", actorId: command.adminId, reason, correlationId },
    );
    await this.releaseReservation(rejected, correlationId);
    return rejected;
  }

  /**
   * Requests the external payout for an approved Withdrawal. The destination is
   * re-evaluated before payout (Ticket 06) and an unknown/ambiguous provider
   * outcome enters reconciliation with the Reservation retained: a blind payout
   * retry is never constructed.
   */
  async requestPayout(
    withdrawalId: string,
    command: { adminId: string },
    correlationId: string,
  ): Promise<WithdrawalRecord> {
    const withdrawal = await this.requireWithdrawal(withdrawalId);
    if (withdrawal.state === "PAYOUT_PROCESSING") return withdrawal;
    if (withdrawal.state !== "APPROVED") {
      throw new WithdrawalError(
        "STATE_CONFLICT",
        `Payout can only be requested from APPROVED, not ${withdrawal.state}`,
      );
    }

    const destination = await this.destinations.findById(withdrawal.payoutDestinationId);
    const decision = await this.evaluateEligibility(withdrawal.memberId, destination);
    if (decision.outcome !== "ALLOW") {
      const rejected = await this.transitionOrThrow(
        withdrawal,
        "APPROVED",
        "REJECTED",
        { failureReason: decision.reasonCodes.join(",") },
        {
          actorType: "SYSTEM",
          reason: decision.reasonCodes.join(","),
          evidenceRef: decision.evidenceRefs[0] ?? null,
          correlationId,
        },
      );
      await this.releaseReservation(rejected, correlationId);
      return rejected;
    }

    const processing = await this.transitionOrThrow(
      withdrawal,
      "APPROVED",
      "PAYOUT_PROCESSING",
      {},
      { actorType: "ADMIN", actorId: command.adminId, correlationId },
    );

    const requestAttemptId = randomUUID();
    try {
      const initiated = await this.provider.initiatePayout({
        withdrawalId: processing.id,
        providerId: processing.providerId,
        amountMinor: processing.amountMinor,
        currency: processing.currency,
        destinationReference: destination?.accountDigest ?? processing.payoutDestinationId,
        providerReferenceKey: processing.providerReferenceKey,
        requestAttemptId,
        correlationId,
      });
      return await this.applyPayoutOutcome(
        processing,
        initiated.result.outcome,
        initiated.identity.providerTransactionId,
        correlationId,
      );
    } catch (error) {
      if (error instanceof PayoutProviderAdapterError) {
        return this.recordAmbiguousPayout(processing, error.failure.category, correlationId);
      }
      // Unclassified failure is ambiguous per Ticket 09: never a definitive
      // outcome and never blindly retried.
      return this.recordAmbiguousPayout(processing, "AMBIGUOUS_OUTCOME", correlationId);
    }
  }

  /**
   * Reconciles an in-flight or ambiguous Withdrawal against the payout provider
   * by its known reference key. The external side effect is never re-initiated;
   * reconciliation only consumes authoritative provider status evidence.
   */
  async reconcileWithdrawal(
    withdrawalId: string,
    actor: { adminId?: string },
    correlationId: string,
  ): Promise<WithdrawalRecord> {
    const withdrawal = await this.requireWithdrawal(withdrawalId);
    if (!["PAYOUT_PROCESSING", "RECONCILING"].includes(withdrawal.state)) {
      throw new WithdrawalError(
        "STATE_CONFLICT",
        `Withdrawal cannot be reconciled from ${withdrawal.state}`,
      );
    }

    let status: GetPayoutStatusResult;
    try {
      status = await this.provider.getPayoutStatus({
        withdrawalId: withdrawal.id,
        providerId: withdrawal.providerId,
        providerReferenceKey: withdrawal.providerReferenceKey,
        providerTransactionId: withdrawal.providerTransactionId ?? undefined,
        requestAttemptId: randomUUID(),
        correlationId,
      });
    } catch (error) {
      const category =
        error instanceof PayoutProviderAdapterError ? error.failure.category : "UNCLASSIFIED";
      return this.recordAmbiguousPayout(withdrawal, category, correlationId, actor.adminId);
    }
    return this.applyPayoutOutcome(
      withdrawal,
      status.result.outcome,
      status.identity.providerTransactionId,
      correlationId,
      actor.adminId,
    );
  }

  /**
   * Finishes the Withdrawal: only a proven payout may be finalized, and the
   * authoritative Ledger effect (Reservation consumption plus
   * `WITHDRAWAL_FINALIZE` posting) is applied exactly once. The Withdrawal only
   * becomes `COMPLETED` after payout evidence and Ledger finalization both hold.
   */
  async finalizeWithdrawal(
    withdrawalId: string,
    command: { adminId: string },
    correlationId: string,
  ): Promise<WithdrawalRecord> {
    const withdrawal = await this.requireWithdrawal(withdrawalId);
    if (withdrawal.state === "COMPLETED") return withdrawal;
    if (withdrawal.state !== "PAYOUT_CONFIRMED" && withdrawal.state !== "FINALIZING") {
      throw new WithdrawalError(
        "STATE_CONFLICT",
        "Withdrawal finalization requires proven payout confirmation",
      );
    }
    if (!withdrawal.reservationId) {
      throw new WithdrawalError(
        "STATE_CONFLICT",
        "Withdrawal has no Reservation to finalize against the Ledger",
      );
    }

    const finalizing =
      withdrawal.state === "FINALIZING"
        ? withdrawal
        : await this.transitionOrThrow(
            withdrawal,
            "PAYOUT_CONFIRMED",
            "FINALIZING",
            {},
            { actorType: "ADMIN", actorId: command.adminId, correlationId },
          );

    const ledgerTransactionId = await this.ledger.finalizeWithdrawal({
      withdrawalId: finalizing.id,
      memberId: finalizing.memberId,
      reservationId: finalizing.reservationId!,
      amountMinor: finalizing.amountMinor,
      currency: finalizing.currency,
      providerId: finalizing.providerId,
      correlationId,
    });

    return this.transitionOrThrow(
      finalizing,
      "FINALIZING",
      "COMPLETED",
      { ledgerTransactionId, completedAt: new Date() },
      { actorType: "ADMIN", actorId: command.adminId, correlationId },
    );
  }

  private async applyPayoutOutcome(
    withdrawal: WithdrawalRecord,
    outcome: PaymentProviderOutcome,
    providerTransactionId: string | null,
    correlationId: string,
    adminId?: string,
  ): Promise<WithdrawalRecord> {
    const target = withdrawalStateForPayoutOutcome(outcome, withdrawal.state);
    const inFlight = outcome === "PENDING";
    const actor = {
      actorType: adminId ? ("ADMIN" as const) : ("PROVIDER" as const),
      actorId: adminId ?? null,
      evidenceRef: providerTransactionId ? `payout:${providerTransactionId}` : null,
      correlationId,
    };

    if (target === "FAILED") {
      const failed = await this.transitionOrThrow(
        withdrawal,
        withdrawal.state,
        "FAILED",
        {
          providerTransactionId,
          incomingProviderError: "PAYOUT_REJECTED",
          failureReason: "PAYOUT_PROVIDER_REJECTED",
        },
        { ...actor, reason: "PAYOUT_PROVIDER_REJECTED" },
      );
      await this.releaseReservation(failed, correlationId);
      return failed;
    }

    return this.transitionOrThrow(
      withdrawal,
      withdrawal.state,
      target,
      {
        providerTransactionId,
        ...(target === "PAYOUT_CONFIRMED"
          ? { payoutEvidenceRef: `payout-evidence:${withdrawal.providerReferenceKey}` }
          : {}),
        // A pending outcome observed while reconciling is an attempt that did not
        // resolve the ambiguity yet, so it is counted as one.
        ...(inFlight && withdrawal.state === "RECONCILING"
          ? { countReconciliationAttempt: true }
          : {}),
      },
      { ...actor, reason: inFlight ? "PAYOUT_IN_FLIGHT" : null },
    );
  }

  private async recordAmbiguousPayout(
    withdrawal: WithdrawalRecord,
    category: string,
    correlationId: string,
    adminId?: string,
  ): Promise<WithdrawalRecord> {
    return this.transitionOrThrow(
      withdrawal,
      withdrawal.state,
      "RECONCILING",
      { incomingProviderError: category, countReconciliationAttempt: true },
      {
        actorType: adminId ? "ADMIN" : "PROVIDER",
        actorId: adminId ?? null,
        reason: category,
        correlationId,
      },
    );
  }

  private async releaseReservation(
    withdrawal: WithdrawalRecord,
    correlationId: string,
  ): Promise<void> {
    if (!withdrawal.reservationId) return;
    await this.ledger.releaseWithdrawal({
      withdrawalId: withdrawal.id,
      reservationId: withdrawal.reservationId,
      correlationId,
    });
  }

  private async evaluateEligibility(
    memberId: string,
    destination: PayoutDestination | null,
  ): Promise<WithdrawalEligibilityDecision> {
    const evaluatedAt = new Date();
    const restriction = await this.restrictions.evaluate({ memberId, at: evaluatedAt });
    return resolveWithdrawalEligibility({
      policyVersion: WITHDRAWAL_ELIGIBILITY_POLICY_VERSION,
      evaluatedAt,
      validUntil: new Date(evaluatedAt.getTime() + WITHDRAWAL_ELIGIBILITY_VALIDITY_MS),
      destination: {
        present: destination !== null,
        ownedByMember: destination !== null && destination.memberId === memberId,
        verified: destination !== null && payoutDestinationIsUsable(destination),
        disabled: destination !== null && destination.disabledAt !== null,
      },
      capability: {
        withdrawalBlocked: restriction.withdrawalBlocked,
        reasonCodes: restriction.reasonCodes,
        evidenceRefs: restriction.evidenceRefs,
      },
      additionalReview: {
        required: restriction.reviewRequired,
        reasonCodes: restriction.reasonCodes,
        evidenceRefs: restriction.evidenceRefs,
      },
    });
  }

  private async transitionOrThrow(
    withdrawal: WithdrawalRecord,
    from: WithdrawalState,
    to: WithdrawalState,
    patch: WithdrawalTransitionPatch,
    event: {
      actorType: "MEMBER" | "ADMIN" | "SYSTEM" | "PROVIDER";
      actorId?: string | null;
      reason?: string | null;
      evidenceRef?: string | null;
      correlationId: string;
    },
  ): Promise<WithdrawalRecord> {
    // The declared state machine is authoritative for every persisted transition,
    // so the domain rule and the durable guard can never disagree.
    assertWithdrawalTransition(from, to);
    const updated = await this.withdrawals.transition({
      id: withdrawal.id,
      from,
      to,
      expectedVersion: withdrawal.version,
      patch,
      event: {
        actorType: event.actorType,
        actorId: event.actorId ?? null,
        reason: event.reason ?? null,
        evidenceRef: event.evidenceRef ?? null,
        correlationId: event.correlationId,
      },
    });
    if (!updated) {
      throw new WithdrawalError(
        "VERSION_CONFLICT",
        `Withdrawal changed concurrently while applying ${withdrawal.state} -> ${to}`,
      );
    }
    return updated;
  }

  private async requireWithdrawal(withdrawalId: string): Promise<WithdrawalRecord> {
    const withdrawal = await this.withdrawals.findById(withdrawalId);
    if (!withdrawal) throw new WithdrawalError("NOT_FOUND", "Withdrawal not found");
    return withdrawal;
  }

  private async requireOwnedWithdrawal(
    memberId: string,
    withdrawalId: string,
  ): Promise<WithdrawalRecord> {
    const withdrawal = await this.requireWithdrawal(withdrawalId);
    if (withdrawal.memberId !== memberId) {
      throw new WithdrawalError("NOT_FOUND", "Withdrawal not found");
    }
    return withdrawal;
  }
}

export function withdrawalFingerprint(input: {
  memberId: string;
  payoutDestinationId: string;
  amountMinor: bigint;
  currency: PaymentCurrency;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        memberId: input.memberId,
        payoutDestinationId: input.payoutDestinationId,
        amountMinor: input.amountMinor.toString(),
        currency: input.currency,
      }),
      "utf8",
    )
    .digest("hex");
}
