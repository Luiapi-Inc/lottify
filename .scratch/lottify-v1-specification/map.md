# Lottify v1 — Implementation-ready specification map

Label: wayfinder:map

## Destination

Reach a fully decided route to an implementation-ready and technically production-deployable Lottify v1 specification covering workflow, domain model, state machines, business rules, permissions/policies, API contract, UX flows, acceptance criteria, technology baseline, and implementation roadmap, without implementing product code.

## Notes

- The locked baseline is [Q1–Q156 baseline](./baseline.md). Do not reopen those decisions unless the user explicitly requests a change.
- The existing/previous Lottify implementation is out of scope for this effort: do not inspect, compare against, or use it as a design baseline.
- Use `grilling` + `domain-modeling` for decision tickets unless a ticket is explicitly marked `prototype` or `research`.
- Local Markdown tracker fallback is in use for this map.
- Agent model/hierarchy and multi-tenant/operator support are out of scope for v1.
- Wayfinder status: **complete**. The specification route is fully decided and handoff-ready for implementation toward a production deployment; no in-scope decision ticket or fog remains.

## Decisions so far

<!-- Closed Wayfinder tickets are indexed here. The pre-map Q1–Q156 decisions live in baseline.md. -->

- [Lock canonical domain language and bounded-context ownership](./issues/01-canonical-domain-language-and-ownership.md): each mutable business concept has one bounded-context owner; cross-context contracts use identifiers/explicit commands or events, immutable snapshots only for reproducibility, and there is no generic Workflow context.
- [Lock end-to-end business workflows and orchestration boundaries](./issues/02-end-to-end-business-workflows.md): each major Member, financial, Draw, settlement, promotion and recovery flow has one durable owner-controlled orchestration, explicit completion semantics, idempotent recovery, and reconciliation-first handling for ambiguous provider outcomes.
- [Lock lifecycle state machines and transition invariants](./issues/03-lifecycle-state-machines.md): Draw, betting, payments, Result/Settlement, Promotion, KYC, Approval, and async jobs now have explicit normal/exception/retry/terminal lifecycle semantics with immutable history and idempotent recovery.
- [Lock financial ledger, balance and accounting invariants](./issues/04-financial-ledger-and-balance-invariants.md): the financial core is an immutable balanced double-entry subledger with explicit Member buckets, durable reservations, deterministic source allocation, governed reversal/compensation, period close, and Ledger-authoritative reconciliation.
- [Lock Lottery Product, Draw and betting configuration semantics](./issues/05-lottery-draw-betting-configuration.md): Product/Bet Type/Result/Settlement configuration is immutable and effective-dated; each Draw snapshots exact versions, live changes use governed Draw Overrides, schedule generation is structured/idempotent, and Quote/Confirm always apply explicit cutoff, restriction and liability precedence.
- [Lock identity, eligibility, KYC, risk and recovery policies](./issues/06-identity-eligibility-kyc-risk-policies.md): identity and risk controls are versioned and capability-specific, with purpose-scoped OTP/session policy, normalized KYC evidence, point-in-time eligibility decisions, deny-first restrictions, responsible-gaming controls, governed payout-destination checks, and evidence-driven account recovery.
- [Lock promotion, referral, bonus and turnover semantics](./issues/07-promotion-referral-turnover-semantics.md): promotions use immutable Campaign versions and Member Entitlement snapshots with deterministic stacking/funding, traceable BONUS provenance, lifecycle-correct turnover, governed expiry/anti-abuse, idempotent referral/cashback, and compensating corrections.
- [Lock Admin permissions, approvals and sensitive-data controls](./issues/08-admin-permissions-approvals-and-sensitive-data.md): Admin authorization uses explicit RBAC capabilities plus contextual policy, fresh re-authentication, maker-checker/threshold approvals, separation of duties, least-privilege masked data access, immutable audit, governed config/rollback controls, scoped emergency controls, and invariant-preserving exceptional workflows.
- [Lock provider integration, webhook and asynchronous reliability contracts](./issues/09-provider-integration-and-async-reliability.md): external providers are isolated behind canonical adapters with immutable provider/business identities, verified and replay-safe webhooks, transactional outbox plus idempotent consumers, governed retry/DLQ/replay, ambiguity-first reconciliation, safe routing/failover, versioned events, and secret/evidence controls.
- [Lock REST/OpenAPI resource model and contract conventions](./issues/10-api-resource-and-contract-model.md): `/api/v1` now has explicit Member/Admin business resources and command endpoints, scoped idempotency, deterministic list/error/concurrency conventions, versioned realtime/OpenAPI compatibility, canonical wire formats, async operation resources, and server-authoritative authentication/session contracts.
- [Prototype the Member application workflows](./issues/11-member-application-flow-prototype.md): the Thai-first mobile Member journey now covers onboarding, assisted betting and requote failure handling, immutable Receipt/history, Wallet/Payments, Promotion/turnover, security self-service, correction visibility, realtime recovery, and accessibility/clarity conventions.
- [Prototype the Admin operational control plane](./issues/12-admin-control-plane-prototype.md): the Admin/Super Admin/Auditor experience now uses permission-aware operational navigation, actionable queues, governed Draw/risk/payment/result/config controls, discrepancy-first reconciliation, masked support diagnostics, immutable approvals/audit, safe provider/emergency controls, and async reporting/export workflows without unsafe force-state or balance-edit paths.
- [Set measurable non-functional targets and release gates](./issues/13-non-functional-targets-and-release-gates.md): v1 now has explicit capacity/latency/queue/settlement/recovery/observability/security/reconciliation targets and a hard evidence-driven production GO/NO-GO gate with verified backup/restore and rollback readiness.
- [Lock reporting, reconciliation and export semantics](./issues/14-reporting-reconciliation-and-export-model.md): reporting is a rebuildable lineage-preserving projection with canonical turnover/GGR/payment/liability definitions, explicit period/freshness semantics, durable discrepancy-driven reconciliation, semantic dimensions, and governed asynchronous masked exports.
- [Lock architecture and technology baseline](./issues/15-architecture-and-technology-baseline.md): v1 is an implementation-ready TypeScript/Node.js Modular Monolith using NestJS, PostgreSQL authority, Prisma behind context-owned persistence seams, Redis/BullMQ as non-authoritative infrastructure, durable Outbox/idempotent workers, separate Next.js Member/Admin apps, immutable OCI deployments, governed migrations/blue-green recovery, and observable/recoverable workload-specific scaling.
- [Lock acceptance criteria and test traceability model](./issues/16-acceptance-criteria-and-test-traceability.md): every approved decision now has a risk-appropriate path from stable requirement identity through objective Acceptance Criteria, scenarios/test levels and durable evidence, with deterministic financial/state anchors, API/UX/provider/security/recovery/NFR proof, change-impact invalidation, and a mandatory evidence-driven production GO/NO-GO matrix.
- [Lock implementation roadmap and delivery sequencing](./issues/19-implementation-roadmap-and-delivery-sequencing.md): implementation is sequenced as dependency-driven vertical milestones on a production-shaped foundation, with the financial core first, Admin/provider/security capabilities delivered alongside their governed verticals, bounded traceable work packages, in-milestone migration/backfill, production-like readiness evidence, scope/contract freeze, immutable blue/green release candidates and compatibility-aware rollback/roll-forward gates.

## Not yet specified

<!-- No in-scope specification fog remains for the current Destination. -->

## Out of scope

- Agent hierarchy / Master Agent → Agent → Member model for v1.
- Multi-tenant / multi-operator architecture for v1.
- Jurisdiction selection, gambling/lottery licensing strategy, legal opinions, and Malta/GLO operating-model research are outside this engineering Wayfinder.
- Concrete age/jurisdiction eligibility bindings (minimum-age threshold, jurisdiction allow/deny policy, jurisdiction-specific evidence requirements, and jurisdiction-specific policy outcomes) are explicitly deferred from the current v1 engineering implementation and acceptance scope by `docs/changes/2026-09-19-age-jurisdiction-policy-deferred.md`.
- Production visual-design-system styling and component-level visual polish are implementation/design-system work beyond this Wayfinder Destination; the required Member/Admin UX flows and interaction semantics are already locked by the resolved prototype tickets.
- Product-code implementation during this Wayfinder effort.
