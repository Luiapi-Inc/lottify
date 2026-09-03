import { describe, expect, it } from "vitest";
import { hashRefreshToken } from "../../src/contexts/identity-access/application/session.service";

describe("refresh token hashing", () => {
  it("is deterministic without retaining the plaintext token", () => {
    const token = "high-entropy-refresh-token";
    const hash = hashRefreshToken(token);
    expect(hash).toBe(hashRefreshToken(token));
    expect(hash).not.toContain(token);
    expect(hash).toHaveLength(64);
  });
});
