import { Injectable } from "@nestjs/common";
import type {
  MemberWithdrawalRestrictionEvaluation,
  MemberWithdrawalRestrictionPort,
} from "../application/withdrawal-restriction.port";

/**
 * v1 default restriction resolution. Member capability restrictions are modeled
 * and unit-proven in the Member/KYC-Risk domains, but no restriction store or
 * risk-signal evaluation is implemented yet, so this adapter resolves no
 * effective `WITHDRAWAL_BLOCKED` restriction and no additional review.
 *
 * The seam exists so the owning KYC/Risk policy can be bound without changing
 * the Withdrawal workflow, and so the denial path stays deterministically
 * testable (tests bind a stub that reports a restriction).
 */
@Injectable()
export class UnrestrictedMemberWithdrawalRestrictionAdapter
  implements MemberWithdrawalRestrictionPort
{
  async evaluate(): Promise<MemberWithdrawalRestrictionEvaluation> {
    return {
      withdrawalBlocked: false,
      reviewRequired: false,
      reasonCodes: [],
      evidenceRefs: [],
    };
  }
}
