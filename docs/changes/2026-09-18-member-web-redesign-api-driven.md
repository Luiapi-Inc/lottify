# Change Request — Member Web redesign with complete Member API integration

Date: 2026-09-18
Branch: `feature/member-web-redesign-api-driven`
Integration base: `4834ea6af7a7057c47f0a0e91313b5280183858f`

## Requested change

Create a new Member Web implementation on a dedicated branch with a completely new visual design that is not constrained by the existing Member UI. Preserve the approved Lottify Member information architecture and business workflows, but bind the application to the existing Member REST API contract and make every existing `/api/v1/member/*` operation reachable through a real user flow or application behavior.

## Source alignment

This change is governed by:

- Ticket 02 — end-to-end business workflows.
- Ticket 06 — identity, eligibility, KYC and risk policy.
- Ticket 07 — promotion/referral/turnover semantics.
- Ticket 10 — REST/OpenAPI resource model and contract conventions.
- Ticket 11 — Member application workflow prototype.
- Ticket 16 — acceptance criteria and test traceability.
- Ticket 19 — implementation roadmap and delivery sequencing.
- `apps/api/openapi/openapi.json` and generated `@lottify/contracts` types.
- User-provided “Lottify Member — ChatGPT Sites API-Driven Design & Implementation Prompt” for route, Thai-first/mobile-first UX, and screen-to-API mapping.

## Change from the Sites-specific prompt

The supplied prompt contains runtime restrictions specific to ChatGPT Sites: synthetic/demo sessions and simulated money-moving mutations. This branch targets the repository application at `apps/member-web`, not a ChatGPT Sites deployment. Therefore the Sites-only simulation restriction does not apply to this branch.

For this branch:

- browser code continues to call same-origin `/api/v1/member/*`;
- the existing Next.js API bridge remains the transport boundary to the configured backend origin;
- OpenAPI is the authoritative wire contract;
- real backend responses are authoritative for auth, catalog, betting, wallet, deposits, payout destinations, withdrawals, promotions, terms/profile/readiness and security self-service;
- no production deployment, database migration, traffic switch, or production credential change is part of this Change Request.

## Design direction

The previous Member UI is not an acceptance baseline. The redesign must preserve the approved five primary areas:

1. หน้าแรก
2. ซื้อหวย
3. โพยของฉัน
4. กระเป๋า
5. บัญชี

The new design is Thai-first, mobile-first, responsive, and must cover normal, loading, empty, error and recovery states. Business state is never fabricated from static fixtures when an authoritative endpoint exists.

## API completion rule

Every operation currently published under `/api/v1/member/*` must:

1. have a typed client method derived from the generated OpenAPI schemas;
2. be invoked by a real route, interaction, application shell behavior, or recovery flow;
3. preserve auth, idempotency and version requirements from the contract;
4. render server state rather than optimistic financial success;
5. expose Member-safe errors while retaining correlation IDs for support.

## Acceptance evidence

Completion requires:

- route inventory present and navigable;
- static API coverage evidence proving the complete current Member OpenAPI inventory is represented and invoked;
- focused unit/contract tests;
- TypeScript typecheck;
- Member production build;
- functional verification of critical flows where the local integration environment supports it;
- visual evidence for the redesign before any production deployment.

Passing build/test alone does not establish completion.
