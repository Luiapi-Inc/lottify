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
    expect(parseEnvironment(valid).APP_ENV).toBe("test");
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
});
