import { describe, expect, it } from "vitest";
import {
  WITHDRAWAL_STATES,
  WithdrawalError,
  withdrawalAllowedActions,
  withdrawalCanTransition,
  withdrawalIsTerminal,
  withdrawalQueue,
  withdrawalRetainsReservation,
  withdrawalSeverity,
  withdrawalStateForPayoutOutcome,
  withdrawalStatesForQueue,
  validateWithdrawalInitiation,
  type WithdrawalState,
} from "../../src/contexts/payments/domain/withdrawal";

describe("Withdrawal lifecycle state machine", () => {
  it("follows the locked request -> reserve -> review -> payout -> finalize path", () => {
    const transitions: Array<[WithdrawalState, WithdrawalState]> = [
      ["REQUESTED", "RESERVING"],
      ["RESERVING", "REVIEWING"],
      ["REVIEWING", "APPROVED"],
      ["APPROVED", "PAYOUT_PROCESSING"],
      ["PAYOUT_PROCESSING", "PAYOUT_CONFIRMED"],
      ["PAYOUT_CONFIRMED", "FINALIZING"],
      ["FINALIZING", "COMPLETED"],
    ];
    for (const [from, to] of transitions) {
      expect(withdrawalCanTransition(from, to)).toBe(true);
    }
  });

  it("allows cancellation before payout and refusal after it", () => {
    expect(withdrawalCanTransition("REVIEWING", "CANCELLING")).toBe(true);
    expect(withdrawalCanTransition("APPROVED", "CANCELLING")).toBe(true);
    expect(withdrawalCanTransition("PAYOUT_PROCESSING", "CANCELLING")).toBe(false);
    expect(withdrawalCanTransition("CANCELLING", "CANCELLED")).toBe(true);
  });

  it("treats only COMPLETED, CANCELLED, REJECTED and resolved FAILED as terminal", () => {
    const terminal = WITHDRAWAL_STATES.filter((state) => withdrawalIsTerminal(state));
    expect(terminal.sort()).toEqual(["CANCELLED", "COMPLETED", "FAILED", "REJECTED"]);
  });

  it("never allows a transition out of ACCEPTED terminal states", () => {
    for (const state of ["COMPLETED", "CANCELLED", "REJECTED", "FAILED"] as const) {
      for (const target of WITHDRAWAL_STATES) {
        expect(withdrawalCanTransition(state, target)).toBe(false);
      }
    }
  });

  it("keeps the Reservation held while the payout outcome is unknown", () => {
    expect(withdrawalRetainsReservation("RECONCILING")).toBe(true);
    expect(withdrawalRetainsReservation("PAYOUT_PROCESSING")).toBe(true);
    expect(withdrawalRetainsReservation("REQUESTED")).toBe(false);
    expect(withdrawalRetainsReservation("FAILED")).toBe(false);
    expect(withdrawalRetainsReservation("COMPLETED")).toBe(false);
  });

  it("separates review, approval, payout and reconciliation queues", () => {
    expect(withdrawalQueue("REVIEWING", false)).toBe("REVIEW");
    expect(withdrawalQueue("REVIEWING", true)).toBe("APPROVAL");
    expect(withdrawalQueue("APPROVED", true)).toBe("PAYOUT");
    expect(withdrawalQueue("PAYOUT_CONFIRMED", false)).toBe("PAYOUT");
    expect(withdrawalQueue("RECONCILING", false)).toBe("RECONCILIATION");
    expect(withdrawalQueue("COMPLETED", false)).toBeNull();
  });

  it("maps queue filters to their authoritative states", () => {
    expect(withdrawalStatesForQueue("REVIEW")).toEqual(["REVIEWING"]);
    expect(withdrawalStatesForQueue("APPROVAL")).toEqual(["REVIEWING"]);
    expect(withdrawalStatesForQueue("RECONCILIATION")).toEqual(["RECONCILING"]);
    expect(withdrawalStatesForQueue("PAYOUT")).toContain("PAYOUT_CONFIRMED");
  });

  it("elevates severity for ambiguous and failed payouts", () => {
    expect(withdrawalSeverity("RECONCILING")).toBe("HIGH");
    expect(withdrawalSeverity("FAILED")).toBe("HIGH");
    expect(withdrawalSeverity("REVIEWING")).toBe("MEDIUM");
    expect(withdrawalSeverity("APPROVED")).toBe("LOW");
  });

  it("never offers a blind payout retry from RECONCILING", () => {
    const allowed = withdrawalAllowedActions("RECONCILING");
    expect(allowed.admin).toEqual(["reconcile"]);
    expect(allowed.admin).not.toContain("payout");
    expect(allowed.admin).not.toContain("request-payout");
  });

  it("offers Member cancellation only before payout", () => {
    expect(withdrawalAllowedActions("REVIEWING").member).toEqual(["cancel"]);
    expect(withdrawalAllowedActions("APPROVED").member).toEqual(["cancel"]);
    expect(withdrawalAllowedActions("PAYOUT_PROCESSING").member).toEqual([]);
    expect(withdrawalAllowedActions("RECONCILING").member).toEqual([]);
  });

  it("maps provider payout outcomes without blind success", () => {
    expect(withdrawalStateForPayoutOutcome("APPROVED")).toBe("PAYOUT_CONFIRMED");
    expect(withdrawalStateForPayoutOutcome("PENDING")).toBe("PAYOUT_PROCESSING");
    expect(withdrawalStateForPayoutOutcome("REJECTED")).toBe("FAILED");
  });

  it("rejects a non-positive withdrawal amount", () => {
    expect(() => validateWithdrawalInitiation({ amountMinor: 0n, currency: "THB" })).toThrow(
      WithdrawalError,
    );
  });
});
