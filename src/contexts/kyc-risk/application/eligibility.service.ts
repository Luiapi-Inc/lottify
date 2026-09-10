import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import type { EligibilityDecision } from "../domain/eligibility-decision";
import {
  resolveEligibilityDecision,
  type EligibilityPolicyLayerResult,
  type EligibilityPolicyLayerResults,
} from "../domain/eligibility-policy";
import { isKycProviderOutcome } from "../domain/kyc-provider-result";
import {
  createVerificationRecord,
  getFreshVerificationsByType,
  isVerificationFresh,
  type VerificationRecord,
  type VerificationType,
} from "../domain/verification-record";
import type {
  CapabilityRestrictionEvaluation,
  CapabilityRestrictionPort,
} from "./capability-restriction.port";
import { CAPABILITY_RESTRICTION_PORT } from "./capability-restriction.port";
import type {
  MemberReadinessFactsPort,
  MemberReadinessRequirements,
} from "./member-readiness-facts.port";
import { MEMBER_READINESS_FACTS_PORT } from "./member-readiness-facts.port";

/**
 * Member capability readiness + KYC eligibility (Ticket 06).
 *
 * A Member is ready for a capability when the locked deny-first layer
 * precedence — hard restriction/self-exclusion, then compliance, then risk,
 * then capability policy — all allow it. Lower-priority layers can never
 * override an earlier non-allow. Every decision is a point-in-time
 * `EligibilityDecision` with policy version, reason codes, evaluation time and
 * a bounded freshness window; an ALLOW is never invented and never permanently
 * valid.
 *
 * The Member-owned facts (capability restrictions, required Terms acceptance,
 * mandatory profile completeness) are read through cross-context ports so
 * KYC/Risk never re-derives or re-implements another context's rules.
 * Verification records and normalized KYC state are this context's own
 * persistence.
 */

/**
 * The post-authentication capabilities the Member readiness surface evaluates.
 * `LOGIN` is the pre-auth gate and is not re-evaluated here: reaching this
 * authenticated endpoint already proves the Member can log in.
 */
export const READINESS_CAPABILITIES = [
  "BET",
  "WITHDRAWAL",
  "DEPOSIT",
  "PROMOTION",
] as const;

export type ReadinessCapability = (typeof READINESS_CAPABILITIES)[number];

export const CAPABILITY_READINESS_POLICY_VERSION =
  "capability-readiness-policy-v1";

/**
 * Bounded freshness of a readiness decision. A decision is a point-in-time
 * result; the bounded window is exposed so a consumer never treats a decision
 * as a permanent grant and re-evaluates at the execution point.
 */
export const CAPABILITY_READINESS_FRESHNESS_MS = 5 * 60 * 1000;

/**
 * Which capabilities require a verified, fresh KYC before they are enabled.
 *
 * The source locks that KYC requirements are per-capability (Ticket 06 round 2:
 * betting/withdrawal can require KYC while deposit may be allowed before it)
 * but not the exact set, so this default is recorded as an implementation
 * decision in `docs/implementation/member-readiness-decisions.md`.
 */
export const CAPABILITY_KYC_REQUIREMENTS: Record<ReadinessCapability, boolean> = {
  BET: true,
  WITHDRAWAL: true,
  DEPOSIT: false,
  PROMOTION: false,
};

export interface ReadinessCapabilityDecision {
  readonly capability: ReadinessCapability;
  readonly outcome: EligibilityDecision["outcome"];
  readonly reasonCodes: readonly string[];
  readonly policyVersion: string;
  readonly evaluatedAt: Date;
  readonly validUntil: Date;
}

export interface ReadinessKycState {
  readonly required: boolean;
  readonly status: string | null;
  readonly verified: boolean;
  readonly expired: boolean;
}

export interface MemberReadinessRequirementsView {
  readonly termsSatisfied: boolean;
  readonly profileComplete: boolean;
  readonly missingProfileFields: readonly string[];
  readonly kyc: ReadinessKycState;
  readonly outstandingRequirements: readonly string[];
}

export interface MemberReadinessView {
  readonly memberId: string;
  readonly asOf: Date;
  readonly policyVersion: string;
  readonly capabilities: readonly ReadinessCapabilityDecision[];
  readonly requirements: MemberReadinessRequirementsView;
}

@Injectable()
export class EligibilityService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CAPABILITY_RESTRICTION_PORT)
    private readonly restrictions: CapabilityRestrictionPort,
    @Inject(MEMBER_READINESS_FACTS_PORT)
    private readonly facts: MemberReadinessFactsPort,
  ) {}

  /**
   * Resolves the readiness decision for one capability through the locked
   * deny-first layer precedence at a point in time.
   */
  async resolveCapability(
    memberId: string,
    capability: ReadinessCapability,
    at: Date,
  ): Promise<EligibilityDecision> {
    const [restriction, requirements, verificationRows, kycRow] =
      await Promise.all([
        this.restrictions.evaluate(memberId, capability, at),
        this.facts.getRequirements(memberId, at),
        this.prisma.memberVerificationRecord.findMany({
          where: { memberId },
          orderBy: [{ verifiedAt: "asc" }, { id: "asc" }],
        }),
        this.prisma.memberKycStatus.findUnique({ where: { memberId } }),
      ]);

    return this.evaluateDecision(
      capability,
      restriction,
      requirements,
      kycRow ? normalizeKycOutcome(kycRow.outcome) : null,
      verificationRows.map(toVerificationRecord),
      at,
    );
  }

  /**
   * The Member's capability readiness plus the outstanding explicit
   * requirements the client needs to render onboarding/blocked states.
   * Evaluates every readiness capability against a single snapshot of the
   * Member's facts so a consistent view is returned.
   */
  async getReadiness(memberId: string, at: Date): Promise<MemberReadinessView> {
    const [requirements, verificationRows, kycRow, restrictionEvaluations] =
      await Promise.all([
        this.facts.getRequirements(memberId, at),
        this.prisma.memberVerificationRecord.findMany({
          where: { memberId },
          orderBy: [{ verifiedAt: "asc" }, { id: "asc" }],
        }),
        this.prisma.memberKycStatus.findUnique({ where: { memberId } }),
        Promise.all(
          READINESS_CAPABILITIES.map((capability) =>
            this.restrictions.evaluate(memberId, capability, at),
          ),
        ),
      ]);

    const verifications = verificationRows.map(toVerificationRecord);
    const kycOutcome = kycRow ? normalizeKycOutcome(kycRow.outcome) : null;

    const capabilities = READINESS_CAPABILITIES.map((capability, index) => {
      const decision = this.evaluateDecision(
        capability,
        restrictionEvaluations[index]!,
        requirements,
        kycOutcome,
        verifications,
        at,
      );
      return {
        capability,
        outcome: decision.outcome,
        reasonCodes: decision.reasonCodes,
        policyVersion: decision.policyVersion,
        evaluatedAt: decision.evaluatedAt,
        validUntil: decision.validUntil,
      } satisfies ReadinessCapabilityDecision;
    });

    const freshKyc = getFreshVerificationsByType("KYC", verifications, at);
    const kycVerified = kycOutcome === "VERIFIED" && freshKyc.length > 0;
    const kycExpired =
      kycOutcome === "VERIFIED" &&
      !kycVerified &&
      verifications.some(
        (verification) =>
          verification.type === "KYC" && !isVerificationFresh(verification, at),
      );
    const kycRequired = READINESS_CAPABILITIES.some(
      (capability) => CAPABILITY_KYC_REQUIREMENTS[capability],
    );

    const outstandingRequirements: string[] = [];
    if (!requirements.termsSatisfied) outstandingRequirements.push("TERMS_NOT_ACCEPTED");
    if (!requirements.profileComplete) outstandingRequirements.push("PROFILE_INCOMPLETE");
    if (kycRequired && !kycVerified) {
      if (kycOutcome === "REJECTED") outstandingRequirements.push("KYC_REJECTED");
      else if (kycOutcome === "REVIEW_REQUIRED") outstandingRequirements.push("KYC_REVIEW_REQUIRED");
      else if (kycOutcome === "MORE_INFO_REQUIRED") outstandingRequirements.push("KYC_MORE_INFO_REQUIRED");
      else if (kycExpired) outstandingRequirements.push("KYC_EXPIRED");
      else outstandingRequirements.push("KYC_REQUIRED");
    }

    return {
      memberId,
      asOf: at,
      policyVersion: CAPABILITY_READINESS_POLICY_VERSION,
      capabilities,
      requirements: {
        termsSatisfied: requirements.termsSatisfied,
        profileComplete: requirements.profileComplete,
        missingProfileFields: [...requirements.missingProfileFields],
        kyc: {
          required: kycRequired,
          status: kycOutcome,
          verified: kycVerified,
          expired: kycExpired,
        },
        outstandingRequirements,
      },
    };
  }

  private evaluateDecision(
    capability: ReadinessCapability,
    restriction: CapabilityRestrictionEvaluation,
    requirements: MemberReadinessRequirements,
    kycOutcome: string | null,
    verifications: readonly VerificationRecord[],
    at: Date,
  ): EligibilityDecision {
    const layers: EligibilityPolicyLayerResults = {
      HARD_RESTRICTION_OR_SELF_EXCLUSION: hardRestrictionLayer(restriction),
      COMPLIANCE: complianceLayer(requirements),
      RISK: riskLayer(capability, kycOutcome, verifications, at),
      CAPABILITY_POLICY: allowLayer(),
    };

    return resolveEligibilityDecision({
      capability,
      policyVersion: CAPABILITY_READINESS_POLICY_VERSION,
      evaluatedAt: at,
      validUntil: new Date(at.getTime() + CAPABILITY_READINESS_FRESHNESS_MS),
      layers,
    });
  }
}

function hardRestrictionLayer(
  restriction: CapabilityRestrictionEvaluation,
): EligibilityPolicyLayerResult {
  if (!restriction.blocked) return allowLayer();
  return {
    outcome: "DENY",
    reasonCodes: restriction.reasonCodes,
    evidenceRefs: restriction.evidenceRefs,
  };
}

function complianceLayer(
  requirements: MemberReadinessRequirements,
): EligibilityPolicyLayerResult {
  const reasonCodes: string[] = [];
  if (!requirements.termsSatisfied) reasonCodes.push("TERMS_NOT_ACCEPTED");
  if (!requirements.profileComplete) reasonCodes.push("PROFILE_INCOMPLETE");
  if (reasonCodes.length === 0) return allowLayer();
  return { outcome: "DENY", reasonCodes, evidenceRefs: [] };
}

function riskLayer(
  capability: ReadinessCapability,
  kycOutcome: string | null,
  verifications: readonly VerificationRecord[],
  at: Date,
): EligibilityPolicyLayerResult {
  if (!CAPABILITY_KYC_REQUIREMENTS[capability]) return allowLayer();

  // No KYC state at all: the requirement is unmet.
  if (kycOutcome === null) {
    return { outcome: "DENY", reasonCodes: ["KYC_REQUIRED"], evidenceRefs: [] };
  }

  const freshKyc = getFreshVerificationsByType("KYC", verifications, at);

  switch (kycOutcome) {
    case "VERIFIED": {
      if (freshKyc.length > 0) return allowLayer();
      const hasExpiredKyc = verifications.some(
        (verification) =>
          verification.type === "KYC" && !isVerificationFresh(verification, at),
      );
      return hasExpiredKyc
        ? { outcome: "DENY", reasonCodes: ["KYC_EXPIRED"], evidenceRefs: [] }
        : { outcome: "DENY", reasonCodes: ["KYC_REQUIRED"], evidenceRefs: [] };
    }
    case "REJECTED":
      return { outcome: "DENY", reasonCodes: ["KYC_REJECTED"], evidenceRefs: [] };
    case "REVIEW_REQUIRED":
      return {
        outcome: "REVIEW_REQUIRED",
        reasonCodes: ["KYC_REVIEW_REQUIRED"],
        evidenceRefs: [],
      };
    case "MORE_INFO_REQUIRED":
      return {
        outcome: "REVIEW_REQUIRED",
        reasonCodes: ["KYC_MORE_INFO_REQUIRED"],
        evidenceRefs: [],
      };
    default:
      // An unrecognized stored outcome is not a valid verification signal.
      return { outcome: "DENY", reasonCodes: ["KYC_REQUIRED"], evidenceRefs: [] };
  }
}

function allowLayer(): EligibilityPolicyLayerResult {
  return { outcome: "ALLOW", reasonCodes: [], evidenceRefs: [] };
}

function toVerificationRecord(row: {
  type: string;
  verifiedAt: Date;
  source: string;
  evidenceRefs: Prisma.JsonValue;
  expiresAt: Date | null;
  reverificationPolicyRef: string | null;
}): VerificationRecord {
  return createVerificationRecord({
    type: row.type as VerificationType,
    verifiedAt: row.verifiedAt,
    source: row.source,
    evidenceRefs: Array.isArray(row.evidenceRefs)
      ? (row.evidenceRefs as string[])
      : [],
    expiresAt: row.expiresAt,
    reverificationPolicyRef: row.reverificationPolicyRef,
  });
}

function normalizeKycOutcome(outcome: string): string | null {
  return isKycProviderOutcome(outcome) ? outcome : null;
}
