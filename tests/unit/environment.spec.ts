import { describe, expect, it } from "vitest";
import { parseEnvironment } from "../../src/platform/config/env";

const valid = {
  APP_ENV: "test",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/lottify",
  REDIS_URL: "redis://localhost:6379",
  JWT_ACCESS_SECRET: "01234567890123456789012345678901",
};

describe("environment validation", () => {
  it("accepts a complete supported environment", () => {
    const parsed = parseEnvironment(valid);
    expect(parsed.APP_ENV).toBe("test");
    expect(parsed.MEMBER_OTP_MAX_ATTEMPTS).toBe(10);
  });

  it("rejects weak access-token secrets", () => {
    expect(() => parseEnvironment({ ...valid, JWT_ACCESS_SECRET: "short" })).toThrow();
  });

  it("rejects unknown environment semantics", () => {
    expect(() => parseEnvironment({ ...valid, APP_ENV: "qa" })).toThrow();
  });

  it("requires a dedicated Admin MFA encryption key outside local/test", () => {
    expect(() => parseEnvironment({ ...valid, APP_ENV: "staging" })).toThrow();
    expect(
      parseEnvironment({
        ...valid,
        APP_ENV: "staging",
        ADMIN_MFA_ENCRYPTION_KEY: "abcdefghijklmnopqrstuvwxyz012345",
      }).APP_ENV,
    ).toBe("staging");
  });

  it("defaults the withdrawal dual-control threshold to the G2 cutover value", () => {
    // G2 `system_settings.withdrawal.dual_control_threshold` = 50,000.00 THB, in
    // minor units (D11). Defaulting to it preserves pre-cutover behaviour.
    expect(parseEnvironment(valid).WITHDRAWAL_APPROVAL_THRESHOLD_MINOR).toBe(5_000_000);
  });

  it("accepts a configured withdrawal dual-control threshold", () => {
    expect(
      parseEnvironment({ ...valid, WITHDRAWAL_APPROVAL_THRESHOLD_MINOR: "10000" })
        .WITHDRAWAL_APPROVAL_THRESHOLD_MINOR,
    ).toBe(10_000);
  });

  it("rejects a negative or fractional withdrawal dual-control threshold", () => {
    expect(() =>
      parseEnvironment({ ...valid, WITHDRAWAL_APPROVAL_THRESHOLD_MINOR: "-1" }),
    ).toThrow();
    expect(() =>
      parseEnvironment({ ...valid, WITHDRAWAL_APPROVAL_THRESHOLD_MINOR: "1.5" }),
    ).toThrow();
  });
});
