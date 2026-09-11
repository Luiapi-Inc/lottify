import { Inject, Injectable } from "@nestjs/common";
import {
  type BettingEligibilityDecision,
  type BettingEligibilityPort,
} from "../../contexts/betting/application/betting-eligibility.port";
import { EligibilityService } from "../../contexts/kyc-risk/application/eligibility.service";

/**
 * Platform composition-root adapter for Betting -> KYC/Risk eligibility.
 * KYC/Risk remains the authority for the decision while Betting consumes only
 * the capability-specific result it needs before Quote and Confirm.
 */
@Injectable()
export class BettingEligibilityAdapter implements BettingEligibilityPort {
  constructor(
    @Inject(EligibilityService)
    private readonly eligibility: EligibilityService,
  ) {}

  async evaluate(memberId: string, at: Date): Promise<BettingEligibilityDecision> {
    const decision = await this.eligibility.resolveCapability(memberId, "BET", at);
    return {
      outcome: decision.outcome,
      reasonCodes: decision.reasonCodes,
      policyVersion: decision.policyVersion,
      evidenceRefs: decision.evidenceRefs,
    };
  }
}
