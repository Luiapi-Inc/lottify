// Unit-level test double for the Draw admission boundary (Issue 117 rework).
//
// The unit suites exercise orchestration/ordering logic, not PostgreSQL lock
// semantics, so this double runs `work` inline. It still records every
// admission and flags a RE-ENTRANT admission of the same Draw, which the real
// (non-reentrant) advisory-lock implementation would deadlock on — so a unit
// suite can prove the code it drives never nests the boundary. Real mutual
// exclusion is proved against PostgreSQL in
// tests/integration/draw-confirm-cancel-race.integration.spec.ts.

import type { DrawAdmissionBoundary } from "../../src/platform/concurrency/draw-admission.port";

export class FakeDrawAdmissionBoundary implements DrawAdmissionBoundary {
  /** Draw ids admitted, in order, including repeated admissions. */
  readonly admittedDrawIds: string[] = [];
  /** Admissions that arrived while the same Draw was already inside. */
  reentrantAdmissions = 0;

  private readonly inFlight = new Set<string>();

  async admit<T>(drawId: string, work: () => Promise<T>): Promise<T> {
    this.admittedDrawIds.push(drawId);
    if (this.inFlight.has(drawId)) this.reentrantAdmissions += 1;
    this.inFlight.add(drawId);
    try {
      return await work();
    } finally {
      this.inFlight.delete(drawId);
    }
  }
}
