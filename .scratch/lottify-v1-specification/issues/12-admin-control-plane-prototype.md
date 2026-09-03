# Prototype the Admin operational control plane

Type: prototype
Status: resolved
Blocked by: 03, 05, 08, 09, 10

## Question

What information architecture and operational flow lets Admin/Super Admin/Auditor safely operate Draws, betting risk/exposure, payments, withdrawals, results, settlement, promotions, configuration draft/review/publish, reconciliation, alerts, support diagnostics, exports, and exceptional corrections without exposing unsafe low-level controls?

## Comments

### Admin UX round 1 — confirmed

- Main navigation is organized by operational responsibility rather than persistence entities: `ภาพรวม`, `หวยและงวด`, `การเดิมพันและความเสี่ยง`, `การเงิน`, `ผลรางวัลและ Settlement`, `สมาชิกและ KYC`, `โปรโมชั่น`, `Reconciliation`, `Approvals`, `ระบบและตั้งค่า`, and `Audit / Reports`. Navigation is permission-aware so unavailable capabilities are hidden or clearly disabled according to UX policy rather than exposing unusable controls.
- The operations dashboard prioritizes actionable operational work instead of vanity metrics. It surfaces open/near-cutoff Draws, exposure/liability alerts, withdrawals awaiting review/approval, deposit/reconciliation discrepancies, Result conflicts/settlement failures, provider degradation, DLQ/stuck jobs, pending approvals, and active kill-switch/maintenance states, with each card drilling directly into its work queue.
- Draw management uses a calendar/timeline plus table and a structured business editor. Admin sees Product, draw/open/cutoff times, lifecycle state, generation source/provenance, overrides, and betting activity. Add/move/cancel actions use guided occurrence-level forms rather than raw RRULE or other technical syntax, including explicit exceptions for irregular government Draw dates.
- Governed Draw/config changes follow `Edit Draft → Preview Diff → Validate Impact → Reason → Approval/Re-auth if required → Publish/Effective Time`. The UI explicitly shows whether a change affects the current Draw, future Draws, new Quotes, existing Quotes, or confirmed Bets; there is no silent “save live” mutation path for payout, cutoff, restriction, stake-limit, Result-source, or equivalent high-impact configuration.
- Human-review work uses a shared operational queue pattern for Withdrawal review, KYC review, Result conflicts, reconciliation discrepancies, Approval requests, and DLQ/replay. Each item exposes priority/severity, age/SLA, current owner/assignee, reason/state, supporting evidence, allowed actions, and audit trail so operators do not have to discover unresolved work manually across unrelated screens.

### Admin UX round 2 — confirmed

- Betting risk/exposure is presented through an operational hierarchy from System → Product → Draw → Bet Type → Number/risk bucket, showing current exposure, configured limit, utilization, projected maximum payout/liability, and alert thresholds. Operators can change restrictions or limits only through governed override/config workflows; exposure itself is never directly editable.
- Deposit and Withdrawal operations are separated into intent-specific queues for deposit review/reconciliation, withdrawal review, withdrawal approval, and payout processing/reconciliation. Detail views combine Member eligibility/KYC/risk, amount and fee, payout destination, reservation state, provider evidence, workflow timeline, and only currently allowed actions. A `RECONCILING`/ambiguous provider outcome never exposes a blind payout-retry action.
- Result/Settlement operations follow `Result Intake → Validation → Conflict Review → Confirm → Settlement Preview → Execute Settlement → Monitor → Completed`. Before confirmation or execution, operators see source/evidence, schema validation, conflicting Results, affected Bet Orders, projected payout/liability, and approval requirements. Result correction is a dedicated immutable correction/re-settlement workflow rather than editing a confirmed Result.
- Reconciliation is discrepancy-first. Each discrepancy shows expected versus observed state/value, Ledger/business/provider references, monetary difference where applicable, age/severity, likely cause, evidence, and recommended resolution. Any resolution that changes money must create the governed Adjustment/Compensation workflow with approval/audit rather than editing balances.
- Member support uses a masked read-only diagnostic timeline covering account/capability state, OTP/session security events, deposits/withdrawals, bets/results/refunds, promotions, relevant KYC/Risk decisions, and support-safe correlation/reference IDs. There is no Member impersonation or direct database/state mutation; sensitive reveal requires explicit permission, reason, and audit.

### Admin UX round 3 — confirmed

- Promotion operations follow a versioned lifecycle `Draft → Validate → Preview eligibility/financial impact → Approval → Schedule/Publish → Monitor`. Admin views show Campaign version, eligibility, reward funding, turnover rules, stacking, expiry, active Entitlements, and projected liability. Published terms and already-issued Entitlement terms are never edited retrospectively.
- Provider/system controls expose enablement/capability, health/circuit state, routing priority, recent failures, reconciliation backlog, and masked secret-reference/rotation metadata. Disable/failover uses guarded commands with impact preview, reason, and re-auth/approval according to risk; plaintext provider secrets are never displayed.
- Approval UX shows requested action, requester, immutable payload diff/hash, reason, risk/threshold, required/completed approvers, expiry, and supporting evidence. Approve/Reject revalidates current state before execution; material payload/state change invalidates the old approval. Audit is an immutable searchable timeline, never an editable log.
- Exceptional operations are dedicated governed workflows for post-cutoff Bet cancellation, Result correction, manual financial adjustment, exceptional Draw reopen, kill switch, and break-glass. Each requires impact preview, reason, re-auth/approval as policy dictates, audit, and the correct domain compensation/workflow; generic force-status and direct balance editing do not exist.
- Reports and exports are read-model operations separate from mutation screens. Large exports run as durable async Jobs/Operations with explicit scope/filter/date range, permission/masking/audit controls for sensitive data, and visible `QUEUED/RUNNING/SUCCEEDED/FAILED` state, progress/result reference, and retry/replay only when safe.

## Answer

Lottify v1 Admin is a permission-aware operational control plane designed around safe work queues, governed commands, immutable evidence, and explicit impact rather than CRUD access to internal state.

1. Navigation is organized by operational responsibility across overview, Lottery/Draws, betting risk, finance, Results/Settlement, Members/KYC, Promotions, Reconciliation, Approvals, system/configuration, and Audit/Reports.
2. The dashboard prioritizes actionable risk/work: near-cutoff Draws, exposure alerts, pending financial reviews, Result/Settlement exceptions, provider degradation, DLQ/stuck jobs, approvals, and emergency controls.
3. Draw and schedule operations use calendar/timeline plus guided structured editors and occurrence-level exceptions; Admin never edits raw recurrence syntax.
4. High-impact configuration follows draft, diff/impact preview, validation, reason, re-auth/approval, publish, and effective-time semantics instead of live mutation.
5. Human intervention uses a common queue model with severity, age/SLA, owner, evidence, allowed actions, and audit trail.
6. Betting exposure is monitored hierarchically with utilization/liability visibility; limits/restrictions change only through governed configuration or override workflows.
7. Deposit/Withdrawal work is separated into review, approval, payout, and reconciliation queues; ambiguous provider outcomes never expose blind duplicate-payout controls.
8. Result/Settlement follows intake, validation/conflict review, confirmation, preview, execution, monitoring, and completion; corrections are new governed workflows rather than edits.
9. Reconciliation is discrepancy-first and monetary remediation creates approved Adjustment/Compensation transactions instead of direct balance changes.
10. Member support is masked, read-only, evidence-rich, and non-impersonating, with audited sensitive reveal where permitted.
11. Promotion operations are versioned and preview financial/eligibility impact; issued Entitlement terms remain immutable.
12. Provider/system controls expose health/routing/secret-reference metadata safely and govern disable/failover with impact preview and authorization controls.
13. Approvals preserve immutable action evidence and revalidate current state before execution; Audit is immutable and searchable.
14. Exceptional corrections and emergency controls are explicit, permissioned, re-authenticated/approved, auditable domain workflows with no generic force-state or balance-edit escape hatch.
15. Reports/exports use read models and durable async Jobs with scope, masking, permission, audit, progress, result references, and safe retry/replay semantics.

This interaction model keeps Admin/Super Admin/Auditor workflows operationally efficient while preserving the locked state-machine, financial, authorization, provider, and audit invariants.
