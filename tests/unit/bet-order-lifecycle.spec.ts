import { describe, expect, it } from "vitest";
import {
  allowedBetOrderActions,
  applyBetOrderCommand,
  applyBetOrderResolution,
  BetOrderCommandError,
  isTerminalBetOrderState,
  type BetOrderState,
  type BetOrderStateRecord,
} from "../../src/contexts/betting/domain/bet-order-lifecycle";

function record(state: BetOrderState, version = 1): BetOrderStateRecord {
  return { state, version };
}

describe("Bet Order lifecycle command state machine", () => {
  describe("allowedBetOrderActions", () => {
    it("offers CONFIRM on a QUOTED Order", () => {
      expect(allowedBetOrderActions("QUOTED")).toEqual(["CONFIRM"]);
    });

    it("offers CONFIRM retry while CONFIRMING", () => {
      expect(allowedBetOrderActions("CONFIRMING")).toEqual(["CONFIRM"]);
    });

    it("offers CANCEL on a CONFIRMED Order", () => {
      expect(allowedBetOrderActions("CONFIRMED")).toEqual(["CANCEL"]);
    });

    it("offers CANCEL retry while CANCELLING", () => {
      expect(allowedBetOrderActions("CANCELLING")).toEqual(["CANCEL"]);
    });

    it("offers no commands on DRAFT, terminal, or settlement-only states", () => {
      for (const state of ["DRAFT", "EXPIRED", "REJECTED", "CANCELLED", "SETTLED"]) {
        expect(allowedBetOrderActions(state as BetOrderState)).toEqual([]);
      }
    });

    it("rejects an unknown state", () => {
      expect(() => allowedBetOrderActions("OPEN" as BetOrderState)).toThrow(
        /Unknown Bet Order state/,
      );
    });
  });

  describe("isTerminalBetOrderState", () => {
    it("treats EXPIRED, REJECTED, CANCELLED and SETTLED as terminal", () => {
      expect(isTerminalBetOrderState("EXPIRED")).toBe(true);
      expect(isTerminalBetOrderState("REJECTED")).toBe(true);
      expect(isTerminalBetOrderState("CANCELLED")).toBe(true);
      expect(isTerminalBetOrderState("SETTLED")).toBe(true);
    });

    it("treats active and in-flight states as non-terminal", () => {
      for (const state of ["DRAFT", "QUOTED", "CONFIRMING", "CONFIRMED", "CANCELLING"]) {
        expect(isTerminalBetOrderState(state as BetOrderState)).toBe(false);
      }
    });
  });

  describe("confirm path", () => {
    it("moves QUOTED -> CONFIRMING and increments version", () => {
      const result = applyBetOrderCommand({
        current: record("QUOTED", 1),
        expectedVersion: 1,
        command: "CONFIRM",
      });
      expect(result).toEqual({ state: "CONFIRMING", version: 2 });
    });

    it("resolves CONFIRMING -> CONFIRMED only after the reserve+commit is durable", () => {
      const result = applyBetOrderResolution({
        current: record("CONFIRMING", 2),
        expectedVersion: 2,
        resolution: "CONFIRMED",
      });
      expect(result).toEqual({ state: "CONFIRMED", version: 3 });
    });

    it("resolves CONFIRMING -> REJECTED on an authoritative denial", () => {
      const result = applyBetOrderResolution({
        current: record("CONFIRMING", 2),
        expectedVersion: 2,
        resolution: "REJECTED",
      });
      expect(result).toEqual({ state: "REJECTED", version: 3 });
    });

    it("command retry while CONFIRMING is an idempotent no-op (no version increment)", () => {
      const retry = applyBetOrderCommand({
        current: record("CONFIRMING", 2),
        expectedVersion: 2,
        command: "CONFIRM",
      });
      expect(retry).toEqual({ state: "CONFIRMING", version: 2 });
    });
  });

  describe("cancel path", () => {
    it("moves CONFIRMED -> CANCELLING on the CANCEL command", () => {
      const begin = applyBetOrderCommand({
        current: record("CONFIRMED", 3),
        expectedVersion: 3,
        command: "CANCEL",
      });
      expect(begin).toEqual({ state: "CANCELLING", version: 4 });
    });

    it("resolves CANCELLING -> CANCELLED only after the refund is posted", () => {
      const begin = applyBetOrderCommand({
        current: record("CONFIRMED", 3),
        expectedVersion: 3,
        command: "CANCEL",
      });
      const done = applyBetOrderResolution({
        current: begin,
        expectedVersion: begin.version,
        resolution: "CANCELLED",
      });
      expect(done).toEqual({ state: "CANCELLED", version: 5 });
    });

    it("command retry while CANCELLING is an idempotent no-op", () => {
      const result = applyBetOrderCommand({
        current: record("CANCELLING", 4),
        expectedVersion: 4,
        command: "CANCEL",
      });
      expect(result).toEqual({ state: "CANCELLING", version: 4 });
    });
  });

  describe("resolution preconditions", () => {
    it("rejects CONFIRMED from a state other than CONFIRMING", () => {
      expect(() =>
        applyBetOrderResolution({
          current: record("CONFIRMED", 3),
          expectedVersion: 3,
          resolution: "CONFIRMED",
        }),
      ).toThrow(/requires a CONFIRMING Bet Order/);
    });

    it("rejects CANCELLED from CONFIRMING", () => {
      expect(() =>
        applyBetOrderResolution({
          current: record("CONFIRMING", 2),
          expectedVersion: 2,
          resolution: "CANCELLED",
        }),
      ).toThrow(/requires a CANCELLING Bet Order/);
    });
  });

  describe("optimistic concurrency", () => {
    it("rejects a stale write with VERSION_CONFLICT and reports both versions", () => {
      try {
        applyBetOrderCommand({
          current: record("CONFIRMED", 5),
          expectedVersion: 3,
          command: "CANCEL",
        });
        expect.unreachable("expected VERSION_CONFLICT");
      } catch (error) {
        expect(error).toBeInstanceOf(BetOrderCommandError);
        const e = error as BetOrderCommandError;
        expect(e.code).toBe("VERSION_CONFLICT");
        expect(e.details).toEqual({ expectedVersion: 3, currentVersion: 5 });
      }
    });

    it("forbids silent last-write-wins on resolution too", () => {
      expect(() =>
        applyBetOrderResolution({
          current: record("CONFIRMING", 2),
          expectedVersion: 1,
          resolution: "CONFIRMED",
        }),
      ).toThrow(BetOrderCommandError);
    });
  });

  describe("terminal and illegal transitions", () => {
    it("rejects any command on a terminal Order", () => {
      for (const state of ["EXPIRED", "REJECTED", "CANCELLED", "SETTLED"]) {
        expect(() =>
          applyBetOrderCommand({
            current: record(state as BetOrderState, 9),
            expectedVersion: 9,
            command: "CANCEL",
          }),
        ).toThrow(/terminal Bet Order/);
      }
    });

    it("rejects resolution on a terminal Order", () => {
      expect(() =>
        applyBetOrderResolution({
          current: record("CANCELLED", 9),
          expectedVersion: 9,
          resolution: "CONFIRMED",
        }),
      ).toThrow(/terminal Bet Order/);
    });

    it("rejects CONFIRM on a CONFIRMED Order (illegal from state)", () => {
      try {
        applyBetOrderCommand({
          current: record("CONFIRMED", 3),
          expectedVersion: 3,
          command: "CONFIRM",
        });
        expect.unreachable("expected ILLEGAL_ACTION");
      } catch (error) {
        expect(error).toBeInstanceOf(BetOrderCommandError);
        expect((error as BetOrderCommandError).code).toBe("ILLEGAL_ACTION");
      }
    });

    it("rejects CONFIRM from a DRAFT Order that has not yet quoted", () => {
      expect(() =>
        applyBetOrderCommand({
          current: record("DRAFT", 1),
          expectedVersion: 1,
          command: "CONFIRM",
        }),
      ).toThrow(/does not allow CONFIRM/);
    });

    it("rejects an invalid state record", () => {
      expect(() =>
        applyBetOrderCommand({
          current: { state: "OPEN" as BetOrderState, version: 1 },
          expectedVersion: 1,
          command: "CONFIRM",
        }),
      ).toThrow(/legal state/);
    });
  });
});
