import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keyLength: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

/**
 * Single credential-hashing authority for every password in the platform.
 *
 * Admin credentials and Member credentials share one encoded format
 * (`scrypt-v1$<salt>$<key>`) so there is exactly one verification path to
 * audit. CR #141 requires the new Member credential to follow the existing
 * admin-auth password pattern; reuse means the Member credential inherits the
 * same memory-hard KDF, per-hash random salt and constant-time comparison
 * instead of introducing a second scheme.
 *
 * Plaintext is never stored, returned or logged; the encoded value only ever
 * leaves this module as the `password_hash` column.
 */
export const PASSWORD_HASH_PREFIX = "scrypt-v1";

export function passwordHashSaltLength(): number {
  return 16;
}

export function passwordHashKeyLength(): number {
  return KEY_LENGTH;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(passwordHashSaltLength()).toString("base64url");
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `${PASSWORD_HASH_PREFIX}$${salt}$${hash.toString("base64url")}`;
}

export async function verifyPassword(
  encoded: string,
  password: string,
): Promise<boolean> {
  const [prefix, salt, expectedPart] = encoded.split("$");
  if (prefix !== PASSWORD_HASH_PREFIX || !salt || !expectedPart) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(expectedPart, "base64url");
  } catch {
    return false;
  }
  if (expected.length !== KEY_LENGTH) return false;
  const actual = await scryptAsync(password, salt, KEY_LENGTH);
  return timingSafeEqual(expected, actual);
}

/**
 * Burns the same KDF cost for an unknown/unenrolled identity as a real
 * verification does, so response timing cannot distinguish "no such credential"
 * from "wrong password".
 */
export async function burnPasswordHashCost(password: string): Promise<void> {
  await hashPassword(password);
}
