# Lock identity, eligibility, KYC, risk and recovery policies

Type: grilling
Status: resolved
Blocked by: 01

## Question

What exact policy model governs OTP registration/login, sessions/devices, onboarding, KYC and verification capabilities, duplicate-account signals, betting eligibility, responsible-gaming/self-exclusion, account restrictions, payout-destination verification, withdrawal thresholds, and high-risk account recovery?

## Comments

### Identity/risk round 1 — confirmed

- OTP policy is versioned per purpose such as `LOGIN`, `REGISTER`, `REAUTH`, and `RECOVERY`, including expiry, attempt limits, resend cooldown, rate limits, old-code invalidation, anti-enumeration behavior, and risk-escalation thresholds. OTP proves possession/authentication evidence only; it is not high-assurance KYC identity proof.
- Session/device policy uses short-lived access tokens plus rotating refresh tokens, logical Device records, and revocation at session/device/all-device scope. New or anomalous devices emit Risk Signals and policy can return `ALLOW`, `CHALLENGE`, `REAUTH`, or `BLOCK`. Device evidence alone never proves identity ownership or duplicate-account status.
- Member capability readiness is derived from explicit requirements rather than one `onboardingCompleted` flag. Requirements can include phone verification, required Terms acceptance, mandatory profile fields, age/jurisdiction eligibility, capability restrictions, and action-specific KYC. Therefore capabilities such as deposit, betting, and withdrawal can be independently enabled or blocked.
- KYC/Risk returns a machine-readable Eligibility Decision per governed capability such as BET, WITHDRAW, or DEPOSIT. Decisions include `ALLOW`, `DENY`, `REVIEW_REQUIRED`, or `CHALLENGE/REAUTH_REQUIRED`, plus reason codes, policy version, and evidence references. Betting evaluates eligibility before Quote and again before Confirm.
- Capability restrictions are explicit independent controls such as `BET_BLOCKED`, `WITHDRAWAL_BLOCKED`, `DEPOSIT_BLOCKED`, `LOGIN_BLOCKED`, and `PROMOTION_BLOCKED`, each with source/reason/effective period and actor-or-policy reference. One overloaded account status cannot replace these separate controls.

### Identity/risk round 2 — confirmed

- KYC requirements are policy-driven per capability and threshold rather than a global boolean. Registration/deposit may be allowed before KYC, while betting or withdrawal can require KYC, enhanced verification, or manual review according to amount, risk, jurisdiction, and the effective policy version. Every decision records the policy version used.
- Duplicate-account policy evaluates weighted signals from phone, KYC identity, payout destination, device, IP/network, and behavior. Strong identity matches may trigger review/block, while device/IP alone remain non-authoritative signals. The policy returns `ALLOW`, `REVIEW_REQUIRED`, or `BLOCK`; manual resolution requires reason and audit evidence.
- Responsible-gaming controls are independent policy capabilities such as deposit limits, betting/loss limits, cool-off, and self-exclusion. Self-exclusion applies `BET_BLOCKED` immediately, cannot be overridden through normal Admin operation, and follows explicit effective/expiry semantics. Eligible withdrawals remain governed by compliance policy.
- Payments owns Payout Destination state while KYC/Risk decides its eligibility. Destination verification is separate from Member/KYC status; sharing one bank account across Members is blocked by default policy. Add/change operations are security-sensitive and may require risk evaluation plus OTP/re-auth. Withdrawal rechecks destination eligibility before payout.
- Account recovery is a high-risk policy workflow requiring sufficient existing identity/KYC/historical evidence and manual review/Approval when policy requires. New-phone OTP alone is insufficient. Successful recovery revokes prior Sessions, may place temporary holds on payout/security-sensitive capabilities, and preserves immutable evidence, decision, notification, and audit history.

### Identity/risk round 3 — confirmed

- Verification freshness is explicit per verification type. Each verification records `verifiedAt`, evidence/source, and optional expiry/reverification policy; KYC, phone, device, and payout-destination verification can therefore expire or require refresh independently.
- KYC provider-specific responses are normalized into Lottify canonical outcomes such as `VERIFIED`, `REJECTED`, `REVIEW_REQUIRED`, and `MORE_INFO_REQUIRED`, with normalized evidence. Business policy does not depend directly on vendor-specific status values.
- Withdrawal eligibility evaluates the strictest applicable rules across amount limits, daily aggregate, frequency, KYC tier, payout-destination verification, risk, capability restrictions, and approval thresholds. The resulting decision is `ALLOW`, `REVIEW_REQUIRED`, or `DENY` with reasons and policy identity.
- Eligibility/Risk Decisions are point-in-time results with policy version, evidence references, evaluation time, and bounded freshness. Critical operations re-evaluate at the execution point rather than treating an old decision as permanently valid.
- Policy precedence is deny-first: hard restriction/self-exclusion, then compliance requirements, then risk decisions, then capability/business policy, then allow. Lower-priority rules cannot override a hard block.

## Answer

Lottify v1 uses versioned, capability-specific identity and risk policy rather than one global account/KYC status. Authentication, verification, eligibility and restrictions remain separately modeled and are re-evaluated at sensitive execution points.

1. OTP policy is versioned per purpose with expiry, attempt/resend/rate-limit controls, anti-enumeration and risk escalation. OTP proves possession, not high-assurance identity.
2. Sessions use short-lived access tokens, rotating refresh tokens, logical Device records and scoped revocation. Device anomalies feed Risk Signals but device evidence alone does not prove identity or duplicate-account status.
3. Member readiness is capability-based. Phone verification, terms, profile requirements, age/jurisdiction, restrictions and action-specific KYC independently govern deposit, betting, withdrawal and promotion access.
4. KYC/Risk returns machine-readable Eligibility Decisions with outcome, reason codes, policy version and evidence references. Betting rechecks before Quote and Confirm; other critical actions re-evaluate at execution time.
5. Capability restrictions are independent controls such as betting, withdrawal, deposit, login and promotion blocks, each with source, reason and effective period.
6. KYC requirements are threshold/capability driven and can escalate to enhanced verification or manual review without coupling registration itself to KYC.
7. Duplicate-account detection combines weighted identity, phone, payout destination, device, network and behavior signals. Device/IP alone cannot hard-block; strong identity matches may trigger review or block.
8. Responsible-gaming controls include configurable deposit/bet/loss limits, cool-off and self-exclusion. Self-exclusion blocks betting immediately and is not normally Admin-overridable.
9. Payout Destination is owned by Payments but eligibility is decided by KYC/Risk; verification is independent, sharing is blocked by default, changes are sensitive, and withdrawal rechecks eligibility before payout.
10. Account recovery is high-risk, evidence-driven and may require KYC/manual review/Approval. New-phone OTP alone is insufficient; successful recovery revokes prior Sessions and may temporarily restrict sensitive capabilities.
11. Verification types carry their own freshness/expiry/reverification semantics and evidence provenance.
12. Provider KYC results are normalized into canonical Lottify outcomes so business rules remain vendor-independent.
13. Withdrawal policy applies the strictest combination of limits, KYC, destination, risk, restrictions and approval thresholds and returns `ALLOW`, `REVIEW_REQUIRED`, or `DENY`.
14. Eligibility/Risk Decisions are time-bounded point-in-time decisions, not permanent grants.
15. Policy precedence is deny-first; hard restrictions and self-exclusion cannot be overridden by lower-priority business rules.

These rules make authentication, verification, betting/withdrawal eligibility, responsible-gaming restrictions and recovery decisions reproducible from immutable policy versions, evidence and decision records.
