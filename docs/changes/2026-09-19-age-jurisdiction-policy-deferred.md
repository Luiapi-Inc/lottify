# Change Request — Age/Jurisdiction eligibility policy explicitly deferred

Date: 2026-09-19
Status: approved by Product Owner

## Decision

Concrete age/jurisdiction eligibility policy is intentionally not part of the current Lottify v1 engineering implementation scope.

The following items are explicitly deferred and must not be treated as specification gaps, implementation blockers, or Production GO blockers for the current approved engineering scope:

- concrete minimum-age threshold;
- jurisdiction allow/deny threshold or jurisdiction policy;
- jurisdiction-specific eligibility evidence requirements;
- jurisdiction-specific policy outcomes.

This decision records scope; it does not invent replacement policy values.

## Existing implementation boundary

Existing profile/date-of-birth, Terms acceptance, KYC/readiness, restriction, and capability-decision behavior remains unchanged. Implementations must not derive or invent legal age or jurisdiction policy from profile data, provider output, UI copy, or environment configuration.

Where existing specifications describe age/jurisdiction as an eligibility concern, those statements remain historical/domain intent but the concrete policy bindings above are deferred by Product Owner for the current v1 engineering scope.

## Acceptance and release impact

- Missing concrete age/jurisdiction thresholds, evidence rules, or policy outcomes are not acceptance gaps for the current approved engineering scope.
- Ticket 16 evidence must not fail solely because these deferred bindings are absent.
- Identity/Eligibility milestone and release reviews must classify these items as `DEFERRED_BY_PRODUCT_OWNER`, not `SOURCE_BLOCKED` or `MISSING`.
- Any future implementation of these policies requires a new explicit Change Request or approved specification decision before code, API, configuration, or acceptance criteria are changed.

## Non-change

This Change Request does not alter:

- authentication/session/OTP controls;
- KYC behavior already in scope;
- responsible-gaming/self-exclusion behavior;
- capability restrictions;
- Terms/profile data contracts;
- financial, betting, withdrawal, or settlement invariants;
- legal or licensing analysis outside the engineering specification.
