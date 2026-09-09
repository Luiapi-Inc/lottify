// Bet Receipt (CONTEXT.md): the immutable member-facing reference for a
// confirmed Bet Order and the terms accepted at confirmation.
//
// A Receipt may only be issued for a CONFIRMED Order. It is structurally
// frozen and carries a SHA-256 content digest so that any later mutation of
// the accepted terms is detectable. Confirmation snapshots the resolved
// payout/limits/restrictions and authoritative cutoff accepted at confirm
// time; subsequent configuration or Draw changes never rewrite a Receipt.

import { createHash } from "node:crypto";
import type { BetOrderState } from "./bet-order-lifecycle";

/** A single canonical wager accepted on the Order. */
export interface ReceiptLine {
  readonly betTypeCode: string;
  readonly betTypeVersionId: string;
  readonly canonicalNumber: string;
  readonly stakeMinor: string;
  readonly resolvedPayout: unknown;
}

export interface ReceiptTerms {
  readonly productId: string;
  readonly productVersionId: string;
  /** Draw identity plus the server-authoritative cutoff accepted at confirm. */
  readonly drawReference: string | null;
  readonly drawCutoffAt: string | null;
  readonly currency: string;
  readonly totalStakeMinor: string;
  readonly acceptedAt: string;
  readonly lines: readonly ReceiptLine[];
  /** canonical codes of the restrictions the member accepted. */
  readonly acceptedRestrictions: readonly string[];
}

export interface BuildBetReceiptInput {
  readonly orderId: string;
  readonly orderState: BetOrderState;
  readonly orderVersion: number;
  readonly memberId: string;
  readonly terms: ReceiptTerms;
}

export interface BetReceipt {
  readonly id: string;
  readonly orderId: string;
  readonly memberId: string;
  /** Order version at the moment the Receipt was issued. */
  readonly orderVersion: number;
  readonly terms: Readonly<ReceiptTerms>;
  /** SHA-256 over the canonical serialization of {@link terms}. */
  readonly contentDigest: string;
}

export class InvalidBetReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBetReceiptError";
  }
}

/**
 * Builds an immutable Receipt for a CONFIRMED Order. Rejects orders that are
 * not confirmed and rejects non-finite amounts or empty lines.
 */
export function buildBetReceipt(input: BuildBetReceiptInput): BetReceipt {
  if (input.orderState !== "CONFIRMED") {
    throw new InvalidBetReceiptError(
      `A Bet Receipt may only be issued for a CONFIRMED Bet Order (state ${input.orderState})`,
    );
  }
  if (!Number.isInteger(input.orderVersion) || input.orderVersion < 1) {
    throw new InvalidBetReceiptError(
      "A Bet Receipt requires the confirmed Order version",
    );
  }
  if (input.memberId.trim().length === 0 || input.orderId.trim().length === 0) {
    throw new InvalidBetReceiptError(
      "A Bet Receipt requires a Member id and a Bet Order id",
    );
  }
  if (input.terms.lines.length === 0) {
    throw new InvalidBetReceiptError("A Bet Receipt requires at least one line");
  }
  for (const line of input.terms.lines) {
    if (!isNonNegativeIntegerString(line.stakeMinor)) {
      throw new InvalidBetReceiptError(
        "Every Bet Receipt line stake must be a non-negative integer minor-unit string",
      );
    }
  }
  if (!isNonNegativeIntegerString(input.terms.totalStakeMinor)) {
    throw new InvalidBetReceiptError(
      "Bet Receipt total stake must be a non-negative integer minor-unit string",
    );
  }
  if (Number.isNaN(Date.parse(input.terms.acceptedAt))) {
    throw new InvalidBetReceiptError(
      "Bet Receipt acceptedAt must be a valid instant",
    );
  }

  const terms = deepFreeze(structuredClone(input.terms));
  const contentDigest = createHash("sha256")
    .update(JSON.stringify(terms))
    .digest("hex");

  return deepFreeze({
    id: input.orderId,
    orderId: input.orderId,
    memberId: input.memberId,
    orderVersion: input.orderVersion,
    terms,
    contentDigest,
  });
}

function isNonNegativeIntegerString(value: string): boolean {
  return typeof value === "string" && /^\d+$/.test(value);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value as Readonly<T>;
}
