export const MEMBER_LEDGER_BUCKETS = ["CASH", "BONUS", "LOCKED"] as const;

export type MemberLedgerBucket = (typeof MEMBER_LEDGER_BUCKETS)[number];

export const LEDGER_POSTING_SIDES = ["DEBIT", "CREDIT"] as const;

export type LedgerPostingSide = (typeof LEDGER_POSTING_SIDES)[number];

export type FinancialCurrency = "THB";

export interface LedgerPostingAmount {
  side: LedgerPostingSide;
  amountMinor: bigint;
  currency: FinancialCurrency;
}

export function assertBalancedLedgerPostings(
  postings: readonly LedgerPostingAmount[],
): void {
  if (postings.length < 2) {
    throw new Error("A financial transaction requires at least two postings");
  }

  let debitMinor = 0n;
  let creditMinor = 0n;

  for (const posting of postings) {
    if (posting.amountMinor <= 0n) {
      throw new Error("Ledger posting amount must be positive integer minor units");
    }

    if (posting.side === "DEBIT") {
      debitMinor += posting.amountMinor;
    } else {
      creditMinor += posting.amountMinor;
    }
  }

  if (debitMinor !== creditMinor) {
    throw new Error("Financial transaction postings must balance debit and credit");
  }
}

export function calculateAvailableMinorUnits(
  postedSpendableBalanceMinor: bigint,
  activeReservationAmountsMinor: readonly bigint[],
): bigint {
  const reservedMinor = activeReservationAmountsMinor.reduce(
    (total, amountMinor) => {
      if (amountMinor <= 0n) {
        throw new Error("Active reservation amount must be positive integer minor units");
      }

      return total + amountMinor;
    },
    0n,
  );

  return postedSpendableBalanceMinor - reservedMinor;
}

export function assertReservationCanBeCreated(
  postedSpendableBalanceMinor: bigint,
  activeReservationAmountsMinor: readonly bigint[],
  requestedAmountMinor: bigint,
): void {
  if (requestedAmountMinor <= 0n) {
    throw new Error("Reservation amount must be positive integer minor units");
  }

  const availableMinor = calculateAvailableMinorUnits(
    postedSpendableBalanceMinor,
    activeReservationAmountsMinor,
  );

  if (availableMinor < requestedAmountMinor) {
    throw new Error("Reservation would exceed available spendable balance");
  }
}
