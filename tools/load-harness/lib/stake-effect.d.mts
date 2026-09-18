// Type declarations for the harness's plain-ESM evaluation module.
// `tools/` is not part of the typecheck project (tsconfig.check.json), but the
// assertion script is TypeScript, so the contract is declared here.

export declare const STAKE_EXPECTED_STATES: readonly string[];
export declare const STAKE_IN_FLIGHT_STATES: readonly string[];

export interface StakeEffectOrderRow {
  readonly id: string;
  readonly state: string;
}

export interface FinancialEffectRow {
  readonly businessTransactionId: string;
}

export interface StakeEffectEvaluation {
  readonly checks: Record<string, unknown>;
  readonly failures: string[];
  readonly samples: Record<string, unknown>;
}

export declare function evaluateStakeEffectOnceOnly(input: {
  readonly orders: ReadonlyArray<StakeEffectOrderRow>;
  readonly stakeCommits: ReadonlyArray<FinancialEffectRow>;
  readonly refunds?: ReadonlyArray<FinancialEffectRow>;
  readonly manifestOrderIds?: readonly string[];
}): StakeEffectEvaluation;
