/**
 * Shared Idempotency-Key / UUID generator for the admin-web tier.
 *
 * The admin-web page is served over plain HTTP in the deployed UAT
 * environment, where `window.isSecureContext === false` and
 * `crypto.randomUUID` is undefined. Every admin command needs a stable
 * Idempotency-Key, so this helper returns `crypto.randomUUID()` when the
 * native API is available and otherwise builds an RFC 4122 v4 UUID from
 * `crypto.getRandomValues` (never `Math.random`).
 */
export function randomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Set the version (4) and variant (RFC 4122) bits.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
