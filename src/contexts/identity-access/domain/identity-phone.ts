// Phone is the canonical Member login identity in v1 (email is profile data).
//
// Stored and returned format is the operator decision of 2026-09-17: a Thai
// mobile number in *local* form — `0XXXXXXXXX`, ten digits, no country code and
// no `66` prefix anywhere in the system (API input/output and the database).
// The only place a country code exists is the SMS gateway request, which is why
// this module also owns that single conversion.
//
// Input is still forgiving — spaces, dashes, parens and dots are stripped, and
// `+66XXXXXXXXX` / `66XXXXXXXXX` are accepted and converted — so a client that
// still sends an international spelling is not rejected. Storage is never
// forgiving: everything lands as `0XXXXXXXXX`.

const LOCAL_PHONE_PATTERN = /^0[2-9]\d{8}$/;

/** The only place a country code exists: the SMS provider request. */
export const THAI_SMS_COUNTRY_CODE = "66";

export function normalizePhone(raw: string): string {
  if (raw.trim().length === 0) {
    throw new PhoneValidationError("Phone is required");
  }
  const compact = raw.replace(/[\s\-().]/g, "");
  const local = toLocalThaiNumber(compact);
  if (!local) {
    throw new PhoneValidationError(
      "Phone must be a Thai number in local format (0XXXXXXXXX)",
    );
  }
  return local;
}

/** True only for the canonical stored form. */
export function isLocalThaiPhone(value: string): boolean {
  return LOCAL_PHONE_PATTERN.test(value);
}

function toLocalThaiNumber(compact: string): string | null {
  if (LOCAL_PHONE_PATTERN.test(compact)) return compact;
  const withoutPlus = compact.startsWith("+") ? compact.slice(1) : compact;
  if (!withoutPlus.startsWith(THAI_SMS_COUNTRY_CODE)) return null;
  const local = `0${withoutPlus.slice(THAI_SMS_COUNTRY_CODE.length)}`;
  return LOCAL_PHONE_PATTERN.test(local) ? local : null;
}

/**
 * Converts the canonical local form into the `66XXXXXXXXX` spelling ThaiBulkSMS
 * documents for its `msisdn` field. Refuses anything that is not the canonical
 * form so a malformed stored number fails loudly instead of being sent.
 */
export function toSmsProviderMsisdn(phone: string): string {
  if (!isLocalThaiPhone(phone)) {
    throw new PhoneValidationError(
      "SMS delivery requires a local Thai phone number (0XXXXXXXXX)",
    );
  }
  return `${THAI_SMS_COUNTRY_CODE}${phone.slice(1)}`;
}

export class PhoneValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhoneValidationError";
  }
}
