import { describe, expect, it } from "vitest";
import {
  CAPABILITY_KYC_REQUIREMENTS,
  EligibilityService,
  READINESS_CAPABILITIES,
} from "../../src/contexts/kyc-risk/application/eligibility.service";
import type { CapabilityRestrictionPort } from "../../src/contexts/kyc-risk/application/capability-restriction.port";
import type { MemberReadinessFactsPort } from "../../src/contexts/kyc-risk/application/member-readiness-facts.port";

/**
 * Capability readiness decision logic (Ticket 06): deny-first layer precedence
 * over persisted restrictions, verification freshness and the Issue 64
 * onboarding facts. The application service is exercised with stubbed ports and
 * persistence so the decision rules are proven deterministically.
 */

const FIXED_NOW = new Date("2026-09-10T12:00:00.000Z");

function prismaStub() {
  return {
    memberVerificationRecord: {
      findMany: async () => [],
    },
    memberKycStatus: {
      findUnique: async () => null,
    },
    capabilityRestriction: {
      findMany: async () => [],
    },
  } as never;
}

function service(overrides: {
  restrictions?: CapabilityRestrictionPort;
  facts?: MemberReadinessFactsPort;
  kycOutcome?: string | null;
  kycVerificationExpiresAt?: Date | null;
} = {}) {
  const restrictions: CapabilityRestrictionPort = overrides.restrictions ?? {
    evaluate: async () => ({ blocked: false, selfExclusion: false, reasonCodes: [], evidenceRefs: [] }),
  };
  const facts: MemberReadinessFactsPort = overrides.facts ?? {
    getRequirements: async () => ({
      termsSatisfied: true,
      profileComplete: true,
      missingProfileFields: [],
    }),
  };
  const prisma = {
    memberVerificationRecord: {
      findMany: async () =>
        overrides.kycVerificationExpiresAt === undefined
          ? []
          : [
              {
                type: "KYC",
                verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
                source: "provider",
                evidenceRefs: [],
                expiresAt: overrides.kycVerificationExpiresAt,
                reverificationPolicyRef: null,
              },
            ],
    },
    memberKycStatus: {
      findUnique: async () =>
        overrides.kycOutcome === undefined
          ? null
          : {
              outcome: overrides.kycOutcome,
              policyVersion: "kyc-policy-v1",
              evidenceRefs: [],
              source: "provider",
              evaluatedAt: FIXED_NOW,
            },
    },
  } as never;
  return new EligibilityService(prisma, restrictions, facts);
}

function blockedEvaluation(reasonCodes: string[]) {
  return async () => ({
    blocked: true,
    selfExclusion: reasonCodes.includes("SELF_EXCLUSION"),
    reasonCodes,
    evidenceRefs: [],
  });
}

describe("EligibilityService capability readiness", () => {
  it("allows a capability when every layer allows it and KYC is verified and fresh", async () => {
    const svc = service({ kycOutcome: "VERIFIED", kycVerificationExpiresAt: new Date("2099-01-01T00:00:00.000Z") });
    const decision = await svc.resolveCapability("member-1", "BET", FIXED_NOW);
    expect(decision.outcome).toBe("ALLOW");
    expect(decision.policyVersion).toBe("capability-readiness-policy-v1");
    expect(decision.reasonCodes).toEqual([]);
    expect(decision.validUntil.getTime()).toBeGreaterThan(decision.evaluatedAt.getTime());
  });

  it("denies with a hard restriction even when every lower layer would allow (deny-first)", async () => {
    const svc = service({
      kycOutcome: "VERIFIED",
      kycVerificationExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      restrictions: { evaluate: blockedEvaluation(["CAPABILITY_BLOCKED"]) },
    });
    const decision = await svc.resolveCapability("member-1", "BET", FIXED_NOW);
    expect(decision.outcome).toBe("DENY");
    expect(decision.reasonCodes).toContain("CAPABILITY_BLOCKED");
  });

  it("denies a self-exclusion restriction with the responsible-gaming reason", async () => {
    const svc = service({
      kycOutcome: "VERIFIED",
      kycVerificationExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      restrictions: { evaluate: blockedEvaluation(["SELF_EXCLUSION"]) },
    });
    const decision = await svc.resolveCapability("member-1", "BET", FIXED_NOW);
    expect(decision.outcome).toBe("DENY");
    expect(decision.reasonCodes).toContain("SELF_EXCLUSION");
  });

  it("denies when required Terms are not accepted", async () => {
    const svc = service({
      kycOutcome: "VERIFIED",
      kycVerificationExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      facts: {
        getRequirements: async () => ({
          termsSatisfied: false,
          profileComplete: true,
          missingProfileFields: [],
        }),
      },
    });
    const decision = await svc.resolveCapability("member-1", "BET", FIXED_NOW);
    expect(decision.outcome).toBe("DENY");
    expect(decision.reasonCodes).toContain("TERMS_NOT_ACCEPTED");
  });

  it("denies when the mandatory profile is incomplete", async () => {
    const svc = service({
      kycOutcome: "VERIFIED",
      kycVerificationExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      facts: {
        getRequirements: async () => ({
          termsSatisfied: true,
          profileComplete: false,
          missingProfileFields: ["dateOfBirth", "province"],
        }),
      },
    });
    const decision = await svc.resolveCapability("member-1", "BET", FIXED_NOW);
    expect(decision.outcome).toBe("DENY");
    expect(decision.reasonCodes).toContain("PROFILE_INCOMPLETE");
  });

  it("reports review-required when KYC is under review", async () => {
    const svc = service({ kycOutcome: "REVIEW_REQUIRED" });
    const decision = await svc.resolveCapability("member-1", "BET", FIXED_NOW);
    expect(decision.outcome).toBe("REVIEW_REQUIRED");
    expect(decision.reasonCodes).toContain("KYC_REVIEW_REQUIRED");
  });

  it("reports review-required when KYC asks for more information", async () => {
    const svc = service({ kycOutcome: "MORE_INFO_REQUIRED" });
    const decision = await svc.resolveCapability("member-1", "BET", FIXED_NOW);
    expect(decision.outcome).toBe("REVIEW_REQUIRED");
    expect(decision.reasonCodes).toContain("KYC_MORE_INFO_REQUIRED");
  });

  it("denies when KYC is rejected", async () => {
    const svc = service({ kycOutcome: "REJECTED" });
    const decision = await svc.resolveCapability("member-1", "BET", FIXED_NOW);
    expect(decision.outcome).toBe("DENY");
    expect(decision.reasonCodes).toContain("KYC_REJECTED");
  });

  it("does not treat an expired verification as valid for a KYC-requiring capability", async () => {
    const svc = service({
      kycOutcome: "VERIFIED",
      kycVerificationExpiresAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const decision = await svc.resolveCapability("member-1", "BET", FIXED_NOW);
    expect(decision.outcome).toBe("DENY");
    expect(decision.reasonCodes).toContain("KYC_EXPIRED");
  });

  it("requires KYC before betting when none exists", async () => {
    const svc = service();
    const decision = await svc.resolveCapability("member-1", "BET", FIXED_NOW);
    expect(decision.outcome).toBe("DENY");
    expect(decision.reasonCodes).toContain("KYC_REQUIRED");
  });

  it("allows a deposit without KYC when nothing else blocks (per-capability KYC)", async () => {
    const svc = service();
    const decision = await svc.resolveCapability("member-1", "DEPOSIT", FIXED_NOW);
    expect(decision.outcome).toBe("ALLOW");
    expect(CAPABILITY_KYC_REQUIREMENTS.DEPOSIT).toBe(false);
  });

  it("returns a consistent readiness view across all evaluated capabilities", async () => {
    const svc = service({
      kycOutcome: "VERIFIED",
      kycVerificationExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      restrictions: {
        evaluate: async (_memberId: string, capability: string) =>
          capability === "BET" ? { blocked: true, selfExclusion: false, reasonCodes: ["CAPABILITY_BLOCKED"], evidenceRefs: [] } : { blocked: false, selfExclusion: false, reasonCodes: [], evidenceRefs: [] },
      },
    });
    const view = await svc.getReadiness("member-1", FIXED_NOW);
    expect(view.capabilities.map((c) => c.capability)).toEqual([...READINESS_CAPABILITIES]);
    const bet = view.capabilities.find((c) => c.capability === "BET")!;
    expect(bet.outcome).toBe("DENY");
    expect(bet.reasonCodes).toContain("CAPABILITY_BLOCKED");
    const deposit = view.capabilities.find((c) => c.capability === "DEPOSIT")!;
    expect(deposit.outcome).toBe("ALLOW");
    expect(view.requirements.kyc.verified).toBe(true);
    expect(view.requirements.kyc.status).toBe("VERIFIED");
  });
});
