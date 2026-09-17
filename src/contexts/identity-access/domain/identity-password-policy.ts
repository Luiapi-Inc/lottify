/**
 * Member password policy (CR #141).
 *
 * Server-authoritative bounds for the credential that replaces OTP as the
 * Member login channel. The API validator and the application service both
 * apply this policy: a client-side form check is convenience, never authority.
 *
 * No complexity-class rule is imposed (length + a blocklist of obviously weak
 * values is what this baseline can actually enforce); raising the minimum later
 * is a policy change, not a migration.
 */
export const MEMBER_PASSWORD_MIN_LENGTH = 12;
export const MEMBER_PASSWORD_MAX_LENGTH = 128;

/**
 * Values that must never survive as a Member credential. Compared
 * case-insensitively against the whole password, so a password that merely
 * contains one of these tokens is still accepted.
 */
const WEAK_PASSWORDS: readonly string[] = [
  "password",
  "password123",
  "password1234",
  "123456789012",
  "qwertyuiop12",
  "lottify12345",
  "administrator",
];

export type MemberPasswordViolation =
  | "TOO_SHORT"
  | "TOO_LONG"
  | "COMMON_VALUE";

/**
 * Returns the violation for a candidate password, or `null` when it satisfies
 * the policy. The password itself is never included in the returned value or in
 * any error the caller raises.
 */
export function memberPasswordViolation(
  password: string,
): MemberPasswordViolation | null {
  if (password.length < MEMBER_PASSWORD_MIN_LENGTH) return "TOO_SHORT";
  if (password.length > MEMBER_PASSWORD_MAX_LENGTH) return "TOO_LONG";
  if (WEAK_PASSWORDS.includes(password.toLowerCase())) return "COMMON_VALUE";
  return null;
}

export function isAcceptableMemberPassword(password: string): boolean {
  return memberPasswordViolation(password) === null;
}
