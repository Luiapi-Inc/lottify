# Lottify Member UX Contract

## Product context
- Audience: authenticated Thai members.
- Primary jobs: onboarding/auth; Product → Draw → Bet → Quote → Confirm → Receipt; slips/results/settlement; wallet/deposit/withdrawal; promotions; account/security.
- Active locale: `th-TH`.
- Accessibility target: WCAG 2.2 AA.

## Business-context sources
| Domain | Authoritative source | Type |
|---|---|---|
| Identity/readiness/KYC | `.scratch/lottify-v1-specification/issues/06-identity-eligibility-kyc-risk-policies.md` | Domain policy |
| API/resources | `.scratch/lottify-v1-specification/issues/10-api-resource-and-contract-model.md` + `apps/api/openapi/openapi.json` | API contract |
| Member journeys | `.scratch/lottify-v1-specification/issues/11-member-application-flow-prototype.md` | Workflow |
| Acceptance | `.scratch/lottify-v1-specification/issues/16-acceptance-criteria-and-test-traceability.md` | Acceptance policy |
| Promotion/referral | `.scratch/lottify-v1-specification/issues/07-promotion-referral-turnover-semantics.md` | Domain policy |
| Current redesign | `docs/changes/2026-09-18-member-web-redesign-api-driven.md` | Change record |

## Visual contract
- Project design: `DESIGN.md`.
- Runtime token source: `apps/member-web/app/styles.css`.
- Shared shell: `app-chrome.tsx`, `topbar.tsx`, `navigation.tsx`, `auth-shell.tsx`.
- Desktop navigation: sticky masthead + floating five-area dock; no persistent left sidebar.
- Mobile navigation: compact masthead + five-area bottom navigation.

## Canonical UI Map
| Capability | Canonical owner | Source | Verification |
|---|---|---|---|
| Form/mutation | route component + `memberApi` | OpenAPI/domain contract | validation + E2E |
| Scrollbar | Member global stylesheet | DESIGN + UX contract | computed layout/E2E |
| Select | native unless authored geometry is required | UX contract | keyboard/E2E |
| Date/time | server value; client only formats | API/domain contract | locale/E2E |
| Feedback | inline/dedicated workflow states | UX contract | E2E |

## Flow ledger
| Operation | Pending rule | Success | Failure recovery |
|---|---|---|---|
| Quote | no duplicate mutation | server-resolved Quote shown | edit/requote |
| Confirm Order | reuse idempotency key for same logical retry | authoritative Receipt | server reason + requote/retry |
| Deposit | idempotent create | server deposit state | status/method recovery |
| Withdrawal | rerun preflight + idempotent create | final only when server says final | DENY reason/cancel where allowed |
| Cancel | only from `allowedActions` | refreshed server state | reason + retry |

## Navigation and responsive behavior
- Exactly five primary areas: หน้าแรก / ซื้อหวย / โพยของฉัน / กระเป๋า / บัญชี.
- Body-level horizontal overflow is a defect.
- Tables may scroll only inside `.table-wrap`.
- Fixed/floating navigation must not cover focused or final interactive content.
- Primary mobile navigation targets are at least 44×44 CSS px.

## Async and resilience
- Money, betting, identity, security, and payout mutations are pessimistic.
- Access token stays in memory; refresh bridge handles a single refresh/retry path.
- Same logical retry reuses the same idempotency key.
- Client must not claim success before authoritative server response.
- Recoverable request failures preserve user-entered values.

## Verification
- Member TypeScript.
- Focused Member unit/contract suite.
- Production Member build.
- Critical desktop + mobile E2E.
- Visual checks: no body overflow, correct desktop/mobile navigation, visible heading, >=44px mobile nav targets, final interactive control unobscured by fixed navigation.
- Browser plugin preferred; Playwright fallback when Browser plugin is unavailable in the session.
