// Phone is the canonical Member login identity in v1 (email is profile data).
// A phone is normalized to E.164 "digits with optional leading +" so the same
// number is not stored under multiple spellings (spaces, dashes, parens).

const PHONE_PATTERN = /^\+?[1-9]\d{7,14}$/;

export function normalizePhone(raw: string): string {
  if (raw.trim().length === 0) {
    throw new PhoneValidationError("Phone is required");
  }
  const compact = raw.replace(/[\s\-().]/g, "");
  if (!PHONE_PATTERN.test(compact)) {
    throw new PhoneValidationError("Phone must be a valid international number");
  }
  return compact.startsWith("+") ? compact : `+${compact}`;
}

export class PhoneValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhoneValidationError";
  }
}
