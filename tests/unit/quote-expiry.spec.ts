import { describe, expect, it } from "vitest";
import {
  InvalidQuoteExpiryInstantError,
  isQuoteExpired,
  resolveQuoteExpiry,
} from "../../src/contexts/betting/domain/quote-expiry";

describe("Bet Quote expiry", () => {
  it("uses the configured TTL expiry when it occurs before Draw cutoff", () => {
    expect(
      resolveQuoteExpiry({
        configuredTtlExpiresAt: new Date("2026-09-06T03:00:30.000Z"),
        drawCutoffAt: new Date("2026-09-06T03:10:00.000Z"),
      }),
    ).toEqual({
      expiresAt: new Date("2026-09-06T03:00:30.000Z"),
    });
  });

  it("uses Draw cutoff when it occurs before the configured TTL expiry", () => {
    expect(
      resolveQuoteExpiry({
        configuredTtlExpiresAt: new Date("2026-09-06T03:10:00.000Z"),
        drawCutoffAt: new Date("2026-09-06T03:00:30.000Z"),
      }),
    ).toEqual({
      expiresAt: new Date("2026-09-06T03:00:30.000Z"),
    });
  });

  it("resolves equal candidate instants deterministically", () => {
    const instant = new Date("2026-09-06T03:00:30.000Z");

    expect(
      resolveQuoteExpiry({
        configuredTtlExpiresAt: instant,
        drawCutoffAt: new Date(instant),
      }),
    ).toEqual({ expiresAt: instant });
  });

  it("defensively snapshots the resolved expiry instant", () => {
    const configuredTtlExpiresAt = new Date("2026-09-06T03:00:30.000Z");
    const expiry = resolveQuoteExpiry({
      configuredTtlExpiresAt,
      drawCutoffAt: new Date("2026-09-06T03:10:00.000Z"),
    });

    configuredTtlExpiresAt.setTime(new Date("2026-09-07T03:00:30.000Z").getTime());

    expect(expiry.expiresAt).toEqual(new Date("2026-09-06T03:00:30.000Z"));
  });

  it("treats the exact expiry boundary as expired using server time", () => {
    const expiry = resolveQuoteExpiry({
      configuredTtlExpiresAt: new Date("2026-09-06T03:00:30.000Z"),
      drawCutoffAt: new Date("2026-09-06T03:10:00.000Z"),
    });

    expect(isQuoteExpired(expiry, new Date("2026-09-06T03:00:29.999Z"))).toBe(false);
    expect(isQuoteExpired(expiry, new Date("2026-09-06T03:00:30.000Z"))).toBe(true);
    expect(isQuoteExpired(expiry, new Date("2026-09-06T03:00:30.001Z"))).toBe(true);
  });

  it.each([
    ["configuredTtlExpiresAt", new Date(Number.NaN), new Date("2026-09-06T03:10:00.000Z")],
    ["drawCutoffAt", new Date("2026-09-06T03:00:30.000Z"), new Date(Number.NaN)],
  ] as const)("rejects an invalid %s", (field, configuredTtlExpiresAt, drawCutoffAt) => {
    expect(() =>
      resolveQuoteExpiry({ configuredTtlExpiresAt, drawCutoffAt }),
    ).toThrow(InvalidQuoteExpiryInstantError);
    expect(() =>
      resolveQuoteExpiry({ configuredTtlExpiresAt, drawCutoffAt }),
    ).toThrow(`${field} must be a valid instant`);
  });

  it("rejects an invalid server-authoritative instant", () => {
    const expiry = resolveQuoteExpiry({
      configuredTtlExpiresAt: new Date("2026-09-06T03:00:30.000Z"),
      drawCutoffAt: new Date("2026-09-06T03:10:00.000Z"),
    });

    expect(() => isQuoteExpired(expiry, new Date(Number.NaN))).toThrow(
      "serverNow must be a valid instant",
    );
  });

  it("rejects an invalid resolved expiry instant", () => {
    expect(() =>
      isQuoteExpired(
        { expiresAt: new Date(Number.NaN) },
        new Date("2026-09-06T03:00:00.000Z"),
      ),
    ).toThrow("expiresAt must be a valid instant");
  });
});
