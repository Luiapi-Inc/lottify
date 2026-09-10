export interface MemberWithdrawalRestrictionEvaluation {
  /** An effective capability restriction denies the Withdrawal capability. */
  withdrawalBlocked: boolean;
  /** The owning policy layer requires human review before payout. */
  reviewRequired: boolean;
  reasonCodes: readonly string[];
  evidenceRefs: readonly string[];
}

/**
 * KYC/Risk-owned withdrawal capability restriction seam (Ticket 06). Member
 * capability restrictions are modelled as independent controls
 * (`WITHDRAWAL_BLOCKED` among others) with source, reason, effective period and
 * actor-or-policy reference. Payments must not read Member/KYC persistence
 * directly (bounded-context boundary), and self-exclusion does not by itself
 * block an otherwise eligible Withdrawal.
 */
export interface MemberWithdrawalRestrictionPort {
  evaluate(input: {
    memberId: string;
    at: Date;
  }): Promise<MemberWithdrawalRestrictionEvaluation>;
}

export const MEMBER_WITHDRAWAL_RESTRICTION_PORT = Symbol(
  "MEMBER_WITHDRAWAL_RESTRICTION_PORT",
);
