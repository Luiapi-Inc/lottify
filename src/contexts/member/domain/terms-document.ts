import { createHash } from "node:crypto";
import { OnboardingRuleError } from "./onboarding-error";

/**
 * Versioned Member Terms document (Ticket 06 required Terms acceptance,
 * Ticket 11 `phone → OTP → required Terms acceptance → profile`).
 *
 * A Terms version is governed exactly like the repository's other versioned
 * configuration: an Admin-authored DRAFT, an approval-gated PUBLISHED state and
 * a RETIRED state. Only a PUBLISHED version inside its effective window is
 * "currently required" for a Member. Published content is immutable, so the
 * exact text a Member accepted is always reproducible.
 */
export const TERMS_DOCUMENT_STATES = ["DRAFT", "PUBLISHED", "RETIRED"] as const;
export type TermsDocumentState = (typeof TERMS_DOCUMENT_STATES)[number];

/**
 * v1 has one governed agreement covering account terms. The code exists so a
 * future agreement (e.g. a risk disclosure) is a new code rather than a rewrite
 * of this one, and so a Member's acceptance is always tied to a named document.
 */
export const MEMBER_TERMS_CODE = "MEMBER_TERMS";

/** Action class for the fresh-MFA requirement on Terms publication. */
export const MEMBER_TERMS_PUBLISH_ACTION_CLASS = "member-terms.publish";

/** How an acceptance was obtained. v1 records Member self-service only. */
export const TERMS_ACCEPTANCE_SOURCE = "MEMBER_SELF_SERVICE";

export const TERMS_TITLE_MAX_LENGTH = 200;
export const TERMS_BODY_MAX_LENGTH = 100_000;
export const TERMS_CODE_MAX_LENGTH = 100;

export interface TermsDocumentContent {
  readonly code: string;
  readonly version: number;
  readonly title: string;
  readonly body: string;
}

export interface TermsDocumentSnapshot {
  readonly state: TermsDocumentState;
  readonly effectiveFrom: Date;
  readonly effectiveUntil: Date | null;
}

/** The version a Member's acceptance must be recorded against. */
export function termsDocumentDigest(content: TermsDocumentContent): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        code: content.code,
        version: content.version,
        title: content.title,
        body: content.body,
      }),
      "utf8",
    )
    .digest("hex");
}

export function assertTermsDocumentContentValid(content: TermsDocumentContent): void {
  const code = content.code?.trim();
  if (!code || code.length > TERMS_CODE_MAX_LENGTH) {
    throw new OnboardingRuleError(
      "VALIDATION_ERROR",
      `code is required and must be at most ${TERMS_CODE_MAX_LENGTH} characters`,
      { field: "code" },
    );
  }
  if (!Number.isInteger(content.version) || content.version < 1) {
    throw new OnboardingRuleError("VALIDATION_ERROR", "version must be a positive integer", {
      field: "version",
    });
  }
  const title = content.title?.trim();
  if (!title || title.length > TERMS_TITLE_MAX_LENGTH) {
    throw new OnboardingRuleError(
      "VALIDATION_ERROR",
      `title is required and must be at most ${TERMS_TITLE_MAX_LENGTH} characters`,
      { field: "title" },
    );
  }
  const body = content.body?.trim();
  if (!body || body.length > TERMS_BODY_MAX_LENGTH) {
    throw new OnboardingRuleError(
      "VALIDATION_ERROR",
      `body is required and must be at most ${TERMS_BODY_MAX_LENGTH} characters`,
      { field: "body" },
    );
  }
}

/**
 * Term lifecycle: `DRAFT → PUBLISHED → RETIRED`. Publication is only reachable
 * from DRAFT (so an approved version is never silently re-approved), and a
 * retired version is terminal and therefore never required again.
 */
export function assertTermsDocumentTransition(
  from: TermsDocumentState,
  to: TermsDocumentState,
): void {
  const allowed =
    (from === "DRAFT" && to === "PUBLISHED") || (from === "PUBLISHED" && to === "RETIRED");
  if (!allowed) {
    throw new OnboardingRuleError(
      "STATE_CONFLICT",
      `A ${from} Member Terms version cannot become ${to}`,
      { from, to },
    );
  }
}

export function isTermsDocumentEffective(
  document: TermsDocumentSnapshot,
  at: Date,
): boolean {
  if (document.state !== "PUBLISHED") return false;
  if (document.effectiveFrom.getTime() > at.getTime()) return false;
  if (document.effectiveUntil === null) return true;
  return document.effectiveUntil.getTime() > at.getTime();
}

export function assertExpectedRevision(actual: number, expected: number): void {
  if (!Number.isInteger(expected) || expected < 1) {
    throw new OnboardingRuleError(
      "VALIDATION_ERROR",
      "expectedRevision must be a positive integer",
      { field: "expectedRevision" },
    );
  }
  if (actual !== expected) {
    throw new OnboardingRuleError(
      "VERSION_CONFLICT",
      "The Member Terms version changed since it was read",
      { expectedRevision: expected, actualRevision: actual },
    );
  }
}

export function assertEffectiveWindow(effectiveFrom: Date, effectiveUntil: Date | null): void {
  if (!(effectiveFrom instanceof Date) || Number.isNaN(effectiveFrom.getTime())) {
    throw new OnboardingRuleError("VALIDATION_ERROR", "effectiveFrom must be an RFC 3339 instant", {
      field: "effectiveFrom",
    });
  }
  if (effectiveUntil === null) return;
  if (!(effectiveUntil instanceof Date) || Number.isNaN(effectiveUntil.getTime())) {
    throw new OnboardingRuleError("VALIDATION_ERROR", "effectiveUntil must be an RFC 3339 instant", {
      field: "effectiveUntil",
    });
  }
  if (effectiveUntil.getTime() <= effectiveFrom.getTime()) {
    throw new OnboardingRuleError(
      "VALIDATION_ERROR",
      "effectiveUntil must be after effectiveFrom",
      { field: "effectiveUntil" },
    );
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.keys(item as Record<string, unknown>)
          .sort()
          .map((key) => [key, (item as Record<string, unknown>)[key]]),
      );
    }
    return item;
  });
}
