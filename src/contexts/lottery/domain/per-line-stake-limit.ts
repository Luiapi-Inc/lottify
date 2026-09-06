export interface ApplicablePerLineStakeLimits {
  readonly minimumsMinor: readonly bigint[];
  readonly maximumsMinor: readonly bigint[];
}

export interface ResolvedPerLineStakeLimits {
  readonly minStakeMinor?: bigint;
  readonly maxStakeMinor?: bigint;
}

export function resolveStrictestPerLineStakeLimits(
  applicable: ApplicablePerLineStakeLimits,
): ResolvedPerLineStakeLimits {
  let minStakeMinor: bigint | undefined;
  let maxStakeMinor: bigint | undefined;

  for (const minimumMinor of applicable.minimumsMinor) {
    if (minStakeMinor === undefined || minimumMinor > minStakeMinor) {
      minStakeMinor = minimumMinor;
    }
  }

  for (const maximumMinor of applicable.maximumsMinor) {
    if (maxStakeMinor === undefined || maximumMinor < maxStakeMinor) {
      maxStakeMinor = maximumMinor;
    }
  }

  return {
    ...(minStakeMinor === undefined ? {} : { minStakeMinor }),
    ...(maxStakeMinor === undefined ? {} : { maxStakeMinor }),
  };
}
