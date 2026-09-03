# Lock Admin permissions, approvals and sensitive-data controls

Type: grilling
Status: resolved
Blocked by: 01, 06

## Question

What exact RBAC roles, policy conditions, maker-checker/threshold approval rules, sensitive-action re-auth rules, support-view permissions, field masking, audit requirements, config publish/rollback controls, kill switches, maintenance controls, and exceptional correction permissions apply to each Admin operation?

## Comments

### Admin/security round 1 — confirmed

- Admin authorization uses the locked v1 roles `SUPER_ADMIN`, `ADMIN`, and `AUDITOR`, but roles are only one input to authorization. Effective access is `RBAC + policy conditions`, including resource scope, action risk, amount/threshold, current domain state, re-auth freshness, and approval requirements. `SUPER_ADMIN` cannot bypass hard business/compliance invariants.
- Permissions are explicit action capabilities such as `draw.publish`, `draw.override`, `draw.cancel`, `result.confirm`, `withdrawal.approve`, `ledger.adjust`, `member.restrict`, `config.publish`, `provider.manage`, and `audit.read`. Sensitive operations separate read/propose/approve/execute authority rather than relying on broad `admin:*` permissions for normal operation.
- High-risk operations use a configurable approval framework supporting no approval, one-person approval, maker-checker, or threshold-based multi-approval. When maker-checker applies, the requester cannot approve their own request. Approval snapshots the action/payload hash, requester, approvers, reason, applicable threshold/policy version, and expiry; any material payload change invalidates the prior approval.
- Admin authentication requires MFA. Sensitive actions additionally require fresh re-authentication according to action-class policy; the evidence is scoped to the Admin/session/action class and expires rather than granting an all-day blanket privilege.
- Sensitive-data access follows least privilege and field masking by default. Revealing sensitive fields requires explicit permission/reason and is audited. `AUDITOR` remains read-only within its allowed scope. Support uses permissioned masked diagnostic/read-only views with no true Member impersonation. Provider/secret credentials expose only masked metadata or secret references, never ordinary plaintext configuration values.

### Admin/security round 2 — confirmed

- Important configuration follows `DRAFT → REVIEW/APPROVAL → PUBLISHED`. Publication requires validated content, preview/diff, effective time, immutable audit evidence, and requester/approver separation when the applicable policy requires it. Published historical versions are immutable.
- Configuration rollback never edits an old version. It creates a new draft from historical content, records the source version being restored, and passes through the same validation/review/approval/publish controls as any other new version.
- Emergency kill switches are distinct from normal maintenance/configuration controls and can operate at system, Product, or Draw scope. Activation/deactivation requires explicit permission, reason, fresh re-authentication and approval according to risk policy, is fully audited, affects future actions immediately, and never rewrites historical transactions.
- Maintenance controls are capability-specific rather than one global boolean, for example blocking new bets, deposits or withdrawals, or pausing settlement automation independently. Each control records reason/operator message, effective period, actor and audit evidence.
- Exceptional operations such as post-cutoff cancellation, Result correction, manual financial adjustment, or exceptional Draw reopen require dedicated permissions plus reason, fresh re-authentication, approval when policy requires, and immutable audit evidence. Admin actions must invoke the authoritative domain workflow or compensation path; direct database/state/Ledger mutation to bypass invariants is forbidden.

### Admin/security round 3 — confirmed

- Sensitive Admin actions create immutable Audit Records containing actor, role, session, action, resource, before/after representation or payload hash, reason, re-auth evidence reference, approval reference, correlation identity, timestamp, and outcome.
- Role or sensitive-permission changes are high-risk security actions. They require fresh re-authentication, approval according to policy, and immutable audit evidence; direct self-escalation of privilege is forbidden.
- Approval decisions expire and are invalidated when the governed payload or relevant domain state changes materially. Expired, rejected, cancelled, or otherwise invalid approvals are not revived; a new Approval request is required.
- Emergency break-glass access is restricted to `SUPER_ADMIN`, requires fresh MFA/re-authentication, mandatory reason, explicit time limit, alerting and enhanced audit, and still cannot bypass Ledger, compliance, eligibility, or domain-state invariants.
- Separation-of-duties policy can require maker ≠ checker and can prohibit the same Admin from combining propose, approve, and execute authority for sensitive financial/configuration operations according to risk class or threshold.

## Answer

Lottify v1 Admin authorization is an operational-control-plane security model built from explicit RBAC capabilities plus contextual policy, approval, re-authentication, data-access and audit controls.

1. Admin roles are `SUPER_ADMIN`, `ADMIN`, and `AUDITOR`, but effective authorization is `RBAC + policy conditions`; no role can bypass hard business/compliance invariants.
2. Sensitive permissions are explicit actions and can separate read, propose, approve and execute authority.
3. High-risk actions use configurable approval policies including maker-checker and threshold-based multi-approval; approved payload/evidence is immutable and material changes require a new Approval.
4. Admin MFA is mandatory and sensitive action classes can require fresh scoped re-authentication.
5. Sensitive data is least-privilege and masked by default; unmasking is explicit and audited, support is read-only/diagnostic rather than Member impersonation, and secrets remain secret references/masked metadata.
6. Important configuration follows `DRAFT → REVIEW/APPROVAL → PUBLISHED`; rollback creates a new version from historical content rather than mutating history.
7. Kill switches are explicit emergency controls at system/Product/Draw scope and are distinct from capability-specific maintenance controls.
8. Exceptional corrections always invoke governed domain workflows/compensation paths with dedicated permission, reason, re-authentication, approval and audit; direct state/Ledger/database bypass is forbidden.
9. Sensitive actions emit immutable Audit Records with actor/session/action/resource/change/reason/re-auth/approval/correlation/outcome evidence.
10. Privilege changes are themselves high-risk, cannot self-escalate directly, and may require approval.
11. Approvals expire and are invalidated by material payload/state change; old terminal decisions are never revived.
12. Break-glass is tightly scoped, time-limited, alerted and audited, and never bypasses hard invariants.
13. Separation of duties can enforce maker/checker and propose/approve/execute separation according to action risk and threshold.

These controls ensure that every sensitive Admin operation is attributable, policy-authorized, reviewable and incapable of silently rewriting authoritative business history.
