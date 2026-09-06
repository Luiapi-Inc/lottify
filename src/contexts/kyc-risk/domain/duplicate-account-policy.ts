export const DUPLICATE_ACCOUNT_SIGNAL_TYPES = [
  "PHONE",
  "KYC_IDENTITY",
  "PAYOUT_DESTINATION",
  "DEVICE",
  "IP_NETWORK",
  "BEHAVIOR",
] as const;

export type DuplicateAccountSignalType =
  (typeof DUPLICATE_ACCOUNT_SIGNAL_TYPES)[number];

export const DUPLICATE_ACCOUNT_OUTCOMES = [
  "ALLOW",
  "REVIEW_REQUIRED",
  "BLOCK",
] as const;

export type DuplicateAccountOutcome =
  (typeof DUPLICATE_ACCOUNT_OUTCOMES)[number];

export interface DuplicateAccountSignalResult {
  outcome: DuplicateAccountOutcome;
  reasonCodes: readonly string[];
  evidenceRefs: readonly string[];
}

export type DuplicateAccountSignalResults = Record<
  DuplicateAccountSignalType,
  DuplicateAccountSignalResult
>;

export interface DuplicateAccountDecision {
  outcome: DuplicateAccountOutcome;
  reasonCodes: readonly string[];
  policyVersion: string;
  evidenceRefs: readonly string[];
  evaluatedAt: Date;
}

export interface ResolveDuplicateAccountDecisionInput {
  policyVersion: string;
  evaluatedAt: Date;
  signals: DuplicateAccountSignalResults;
}

export interface DuplicateAccountManualResolutionEvidence {
  reason: string;
  auditEvidenceRef: string;
}

const OUTCOME_SEVERITY: Record<DuplicateAccountOutcome, number> = {
  ALLOW: 0,
  REVIEW_REQUIRED: 1,
  BLOCK: 2,
};

function effectiveSignalOutcome(
  signal: DuplicateAccountSignalType,
  outcome: DuplicateAccountOutcome,
): DuplicateAccountOutcome {
  if ((signal === "DEVICE" || signal === "IP_NETWORK") && outcome === "BLOCK") {
    return "REVIEW_REQUIRED";
  }

  return outcome;
}

export function resolveDuplicateAccountDecision(
  input: ResolveDuplicateAccountDecisionInput,
): DuplicateAccountDecision {
  let strictestOutcome: DuplicateAccountOutcome = "ALLOW";

  const evaluatedSignals = DUPLICATE_ACCOUNT_SIGNAL_TYPES.map((signal) => ({
    result: input.signals[signal],
    effectiveOutcome: effectiveSignalOutcome(
      signal,
      input.signals[signal].outcome,
    ),
  }));

  for (const signal of evaluatedSignals) {
    if (
      OUTCOME_SEVERITY[signal.effectiveOutcome] >
      OUTCOME_SEVERITY[strictestOutcome]
    ) {
      strictestOutcome = signal.effectiveOutcome;
    }
  }

  const decisiveSignals = evaluatedSignals.filter(
    (signal) => signal.effectiveOutcome === strictestOutcome,
  );

  return {
    outcome: strictestOutcome,
    reasonCodes: decisiveSignals.flatMap((signal) => signal.result.reasonCodes),
    policyVersion: input.policyVersion,
    evidenceRefs: decisiveSignals.flatMap((signal) => signal.result.evidenceRefs),
    evaluatedAt: new Date(input.evaluatedAt),
  };
}

export function createDuplicateAccountManualResolutionEvidence(
  input: DuplicateAccountManualResolutionEvidence,
): DuplicateAccountManualResolutionEvidence {
  if (input.reason.trim().length === 0) {
    throw new Error("Duplicate-account manual resolution requires a reason");
  }

  if (input.auditEvidenceRef.trim().length === 0) {
    throw new Error(
      "Duplicate-account manual resolution requires audit evidence",
    );
  }

  return {
    reason: input.reason,
    auditEvidenceRef: input.auditEvidenceRef,
  };
}
