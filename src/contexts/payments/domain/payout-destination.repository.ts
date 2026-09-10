import type {
  PayoutDestination,
  PayoutDestinationStatus,
  PayoutDestinationType,
} from "./payout-destination";
import type { PaymentCurrency } from "./payment-provider-result";

export interface CreatePayoutDestinationInput {
  id: string;
  memberId: string;
  type: PayoutDestinationType;
  bankCode: string;
  accountNumberMasked: string;
  accountDigest: string;
  accountHolderName: string;
  currency: PaymentCurrency;
}

export interface ResolvePayoutDestinationVerificationInput {
  status: PayoutDestinationStatus;
  expectedVersion: number;
  verificationEvidenceRef: string | null;
  verifiedAt: Date | null;
}

export interface PayoutDestinationRepository {
  /**
   * Persists a new Payout Destination in `PENDING`. Returns `null` when the
   * Member already registered the same destination reference (unique
   * `(memberId, accountDigest)`).
   */
  create(input: CreatePayoutDestinationInput): Promise<PayoutDestination | null>;
  findById(id: string): Promise<PayoutDestination | null>;
  findByAccountDigest(accountDigest: string): Promise<readonly PayoutDestination[]>;
  listByMember(memberId: string): Promise<readonly PayoutDestination[]>;
  /**
   * Applies a verification outcome with optimistic version guarding. Returns
   * `null` when the destination changed concurrently.
   */
  resolveVerification(
    id: string,
    input: ResolvePayoutDestinationVerificationInput,
  ): Promise<PayoutDestination | null>;
}

export const PAYOUT_DESTINATION_REPOSITORY = Symbol("PAYOUT_DESTINATION_REPOSITORY");
