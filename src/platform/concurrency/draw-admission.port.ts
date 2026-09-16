// Draw admission boundary (Issue 117 rework, ADR 0001 workflow 5).
//
// Two writers can move money against one Draw:
//   - Confirm (betting): revalidates the Draw is OPEN, then commits the stake;
//   - Draw cancellation (lottery): scans -> refunds -> terminalizes CANCELLED.
//
// Without a shared admission boundary they interleave: a Confirm passes its
// Draw-open check while the Draw is still OPEN, the Draw is requested-cancelled
// and terminalized CANCELLED, and only then does the Confirm commit the stake.
// The order is CONFIRMED with a committed stake in a CANCELLED Draw, and it is
// invisible to the cancelled-Draw refund scans (a CONFIRMING order has no
// committed stake yet, so it is not a refund candidate when the run starts).
//
// This boundary is the mutual exclusion for that pair: `work` submitted for the
// same `drawId` never overlaps with another `work` for the same `drawId`, in
// this process or any other, because implementations serialise durably (the
// PostgreSQL implementation takes a transaction-scoped advisory lock). Both the
// betting Confirm path and the lottery cancellation path must hold the SAME
// boundary: the boundary is only a proof when it is shared.
//
// Contract rules for callers and implementers:
//   - `work` MUST re-read the Draw's authoritative state inside the boundary
//     before moving money; holding the boundary is what makes that read
//     trustworthy, and it is the caller's job to act on it (fail closed).
//   - `work` MUST NOT re-enter `admit` for the same `drawId` (implementations
//     take a non-reentrant durable lock; a nested call would wait on itself).
//   - The boundary serialises execution; it is NOT a distributed transaction.
//     Writes `work` performs through other connections are already durable when
//     `work` returns, and are not rolled back if a later step throws.
//   - Implementations must release the boundary on every exit path, including
//     thrown errors and process crashes.

export const DRAW_ADMISSION_BOUNDARY = Symbol("DRAW_ADMISSION_BOUNDARY");

export interface DrawAdmissionBoundary {
  /**
   * Runs `work` holding the exclusive admission boundary of one Draw. The
   * returned value is `work`'s; a rejection propagates unchanged.
   */
  admit<T>(drawId: string, work: () => Promise<T>): Promise<T>;
}
