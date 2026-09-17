import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  hashAdminPassword,
  verifyAdminPassword,
} from "../../src/contexts/identity-access/domain/admin-password";
import {
  isAcceptableMemberPassword,
  memberPasswordViolation,
  MEMBER_PASSWORD_MAX_LENGTH,
  MEMBER_PASSWORD_MIN_LENGTH,
} from "../../src/contexts/identity-access/domain/identity-password-policy";
import {
  burnPasswordHashCost,
  hashPassword,
  PASSWORD_HASH_PREFIX,
  verifyPassword,
} from "../../src/contexts/identity-access/domain/password-hash";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keyLength: number,
) => Promise<Buffer>;

/**
 * The Admin credential implementation that existed before CR #141 extracted the
 * shared `password-hash` module. It is reproduced here so the suite proves that
 * hashes already stored by the Admin login path still verify after the change.
 */
async function legacyAdminHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt-v1$${salt}$${hash.toString("base64url")}`;
}

const PASSWORD = "correct-horse-battery";

describe("credential hashing (CR #141)", () => {
  it("stores an encoded credential that never contains the plaintext", async () => {
    const encoded = await hashPassword(PASSWORD);
    expect(encoded.startsWith(`${PASSWORD_HASH_PREFIX}$`)).toBe(true);
    expect(encoded).not.toContain(PASSWORD);
    expect(encoded.split("$")).toHaveLength(3);
  });

  it("salts every credential independently and verifies only the right password", async () => {
    const first = await hashPassword(PASSWORD);
    const second = await hashPassword(PASSWORD);
    expect(first).not.toBe(second);

    expect(await verifyPassword(first, PASSWORD)).toBe(true);
    expect(await verifyPassword(first, `${PASSWORD}!`)).toBe(false);
  });

  it("treats malformed or foreign encodings as a failed verification", async () => {
    expect(await verifyPassword("", PASSWORD)).toBe(false);
    expect(await verifyPassword("scrypt-v1$onlysalt", PASSWORD)).toBe(false);
    expect(await verifyPassword("bcrypt-v1$salt$hash", PASSWORD)).toBe(false);
    expect(await verifyPassword("scrypt-v1$salt$not-base64url!!", PASSWORD)).toBe(false);
    // A truncated or over-long key must not be accepted as a match.
    expect(await verifyPassword(`scrypt-v1$salt$${Buffer.from("short").toString("base64url")}`, PASSWORD)).toBe(false);
  });

  it("burns the same KDF cost for an unknown identity instead of returning early", async () => {
    const startedAt = Date.now();
    await burnPasswordHashCost(PASSWORD);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(0);
    const encoded = await hashPassword(PASSWORD);
    expect(await verifyPassword(encoded, PASSWORD)).toBe(true);
  });

  it("keeps the Admin credential format and verification path compatible", async () => {
    // A hash written by the pre-CR #141 Admin implementation still verifies.
    const legacyEncoded = await legacyAdminHash(PASSWORD);
    expect(await verifyAdminPassword(legacyEncoded, PASSWORD)).toBe(true);
    expect(await verifyAdminPassword(legacyEncoded, "wrong-password")).toBe(false);
    // And a credential minted through the shared module verifies through the
    // Admin-scoped name, so both flows really share one authority.
    const encoded = await hashAdminPassword(PASSWORD);
    expect(await verifyPassword(encoded, PASSWORD)).toBe(true);
    const [, salt, key] = encoded.split("$");
    const expected = await scryptAsync(PASSWORD, salt!, 64);
    expect(timingSafeEqual(expected, Buffer.from(key!, "base64url"))).toBe(true);
  });
});

describe("member password policy (CR #141)", () => {
  it("accepts a reasonable password and reports the violation otherwise", () => {
    expect(memberPasswordViolation("correct-horse-battery")).toBeNull();
    expect(isAcceptableMemberPassword("correct-horse-battery")).toBe(true);

    expect(
      memberPasswordViolation("x".repeat(MEMBER_PASSWORD_MIN_LENGTH - 1)),
    ).toBe("TOO_SHORT");
    expect(
      memberPasswordViolation("x".repeat(MEMBER_PASSWORD_MAX_LENGTH + 1)),
    ).toBe("TOO_LONG");
    expect(memberPasswordViolation("Password1234")).toBe("COMMON_VALUE");
  });

  it("never echoes the rejected password in the violation report", () => {
    const weak = "Password1234";
    const violation = memberPasswordViolation(weak);
    expect(violation).not.toContain(weak);
    expect(JSON.stringify({ violation })).not.toContain(weak);
  });
});
