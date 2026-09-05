import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keyLength: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const PREFIX = "scrypt-v1";

export async function hashAdminPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `${PREFIX}$${salt}$${hash.toString("base64url")}`;
}

export async function verifyAdminPassword(
  encoded: string,
  password: string,
): Promise<boolean> {
  const [prefix, salt, expectedPart] = encoded.split("$");
  if (prefix !== PREFIX || !salt || !expectedPart) return false;
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
