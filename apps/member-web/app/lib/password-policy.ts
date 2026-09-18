// Client-side convenience mirrors of the Member password policy. The server is
// authoritative (identity-password-policy.ts); these only give immediate inline
// feedback before a round-trip, and must never be treated as the real check.
export const MEMBER_PASSWORD_MIN_LENGTH = 12;
export const MEMBER_PASSWORD_MAX_LENGTH = 128;

export function passwordViolation(password: string): string | null {
  if (password.length < MEMBER_PASSWORD_MIN_LENGTH) {
    return `รหัสผ่านต้องมีอย่างน้อย ${MEMBER_PASSWORD_MIN_LENGTH} ตัวอักษร`;
  }
  if (password.length > MEMBER_PASSWORD_MAX_LENGTH) {
    return `รหัสผ่านต้องไม่เกิน ${MEMBER_PASSWORD_MAX_LENGTH} ตัวอักษร`;
  }
  return null;
}
