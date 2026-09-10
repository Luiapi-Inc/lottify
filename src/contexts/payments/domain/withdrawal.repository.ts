import type { PaymentCurrency } from "./payment-provider-result";
import {
  withdrawalAllowedActions,
  withdrawalQueue,
  withdrawalSeverity,
  type WithdrawalActorType,
  type WithdrawalAllowedActions,
  type WithdrawalEligibilityOutcome,
  type WithdrawalQueue,
  type WithdrawalSeverity,
  type WithdrawalState,
} from "./withdrawal";

export interface WithdrawalRecord {
  id: string;
  memberId: string;
  payoutDestinationId: string;
  amountMinor: bigint;
  feeMinor: bigint;
  currency: PaymentCurrency;
  state: WithdrawalState;
  version: number;
  eligibilityOutcome: WithdrawalEligibilityOutcome;
  eligibilityPolicyVersion: string;
  eligibilityReasonCodes: readonly string[];
  eligibilityEvidenceRefs: readonly string[];
  requiresApproval: boolean;
  idempotencyScope: string;
  idempotencyKey: string;
  fingerprint: string;
  reservationId: string | null;
  providerId: string;
  providerReferenceKey: string;
  providerTransactionId: string | null;
  payoutEvidenceRef: string | null;
  ledgerTransactionId: string | null;
  reconciliationAttempts: number;
  decidedByAdminId: string | null;
  decisionReason: string | null;
  failureReason: string | null;
  incomingProviderError: string | null;
  correlationId: string;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WithdrawalEventRecord {
  id: string;
  withdrawalId: string;
  fromState: WithdrawalState | null;
  toState: WithdrawalState;
  actorType: WithdrawalActorType;
  actorId: string | null;
  reason: string | null;
  evidenceRef: string | null;
  correlationId: string;
  createdAt: Date;
}

export interface CreateWithdrawalInput {
  id: string;
  memberId: string;
  payoutDestinationId: string;
  amountMinor: bigint;
  feeMinor: bigint;
  currency: PaymentCurrency;
  eligibilityOutcome: WithdrawalEligibilityOutcome;
  eligibilityPolicyVersion: string;
  eligibilityReasonCodes: readonly string[];
  eligibilityEvidenceRefs: readonly string[];
  requiresApproval: boolean;
  idempotencyScope: string;
  idempotencyKey: string;
  fingerprint: string;
  providerId: string;
  providerReferenceKey: string;
  correlationId: string;
}

export interface WithdrawalTransitionPatch {
  reservationId?: string;
  providerTransactionId?: string | null;
  payoutEvidenceRef?: string | null;
  ledgerTransactionId?: string | null;
  decidedByAdminId?: string | null;
  decisionReason?: string | null;
  failureReason?: string | null;
  incomingProviderError?: string | null;
  completedAt?: Date | null;
  countReconciliationAttempt?: boolean;
}

export interface WithdrawalTransitionInput {
  id: string;
  /** The single state the caller observed; the guard is exact, never a wildcard. */
  from: WithdrawalState;
  to: WithdrawalState;
  expectedVersion: number;
  patch?: WithdrawalTransitionPatch;
  event: {
    actorType: WithdrawalActorType;
    actorId?: string | null;
    reason?: string | null;
    evidenceRef?: string | null;
    correlationId: string;
  };
}

export interface WithdrawalCursor {
  createdAt: Date;
  id: string;
}

export interface WithdrawalListQuery {
  memberId?: string;
  state?: WithdrawalState;
  queue?: WithdrawalQueue;
  requiresApproval?: boolean;
  limit: number;
  cursor?: WithdrawalCursor | null;
}

export interface WithdrawalListPage {
  items: readonly WithdrawalRecord[];
  nextCursor: WithdrawalCursor | null;
}

export interface WithdrawalRepository {
  /**
   * Persists the durable Withdrawal intent in `REQUESTED`. Returns `null` when
   * the scoped Idempotency-Key is already bound to another withdrawal.
   */
  create(input: CreateWithdrawalInput): Promise<WithdrawalRecord | null>;
  findById(id: string): Promise<WithdrawalRecord | null>;
  findByIdempotency(scope: string, key: string): Promise<WithdrawalRecord | null>;
  /**
   * Applies one guarded state transition and appends the durable workflow event
   * in one transaction. Returns `null` when the optimistic guard is lost so the
   * caller can surface a version/state conflict instead of silently winning.
   */
  transition(input: WithdrawalTransitionInput): Promise<WithdrawalRecord | null>;
  list(query: WithdrawalListQuery): Promise<WithdrawalListPage>;
  listEvents(withdrawalId: string): Promise<readonly WithdrawalEventRecord[]>;
}

export const WITHDRAWAL_REPOSITORY = Symbol("WITHDRAWAL_REPOSITORY");

export interface WithdrawalView extends WithdrawalRecord {
  allowedActions: WithdrawalAllowedActions;
  queue: WithdrawalQueue | null;
  severity: WithdrawalSeverity;
}

/**
 * Projects the durable Withdrawal into the Member/Admin representation: canonical
 * state plus the only currently permitted commands, the intent-specific queue it
 * belongs to, and the operational severity used by the Admin queue surface.
 */
export function toWithdrawalView(record: WithdrawalRecord): WithdrawalView {
  return {
    ...record,
    allowedActions: withdrawalAllowedActions(record.state),
    queue: withdrawalQueue(record.state, record.requiresApproval),
    severity: withdrawalSeverity(record.state),
  };
}
