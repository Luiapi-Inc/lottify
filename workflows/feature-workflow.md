# Feature Workflow

## Purpose

Implement an approved Lottify capability without redefining the requirement, while preserving source traceability, boundary ownership, required UX evidence, and Ticket 16 acceptance.

## Trigger

Run when an approved requirement, issue, or work package requests new behavior or a deliberate change to existing behavior.

If the requested behavior is not approved or conflicts with the active source of truth, stop implementation and route the discrepancy as a Change Request.

## Workflow

1. **Requirement**
   - Read the active implementation checkpoint, relevant Wayfinder ticket, Ticket 16, `CONTEXT.md`, applicable ADRs, API/event contracts, and approved UX/design source when Member/Admin is affected.
   - Record Requirement/Decision IDs, owning bounded context/surface, dependencies, contract/migration impact, and acceptance obligations.
   - If the work changes a requirement, approved specification, API contract, lifecycle/state invariant, policy, or other traced decision, perform Ticket 16 change-impact analysis before relying on prior evidence. Mark affected Acceptance Criteria, scenarios, tests, and prior evidence invalidated or explicitly re-evaluated; historical passing evidence is not automatically valid for the changed contract.
2. **Plan**
   - Establish `Plan -> Intended Result -> Current State -> Gap -> Implementation`.
   - Do not use current UI as the redesign baseline when an approved design specification exists.
   - If architectural module ownership is changing, apply the repository architecture/domain rules before implementation; unresolved ADR or domain-vocabulary conflict blocks the affected part.
3. **Skill routing**
   - Use `vercel:nextjs` and `vercel-react-best-practices` for affected Next.js/React surfaces.
   - Use `supabase:supabase-postgres-best-practices` for affected PostgreSQL schema/query/index/transaction work.
   - Use `security-best-practices` when the implementation is security-sensitive.
   - Escalate to the critical-change workflow if the high-risk classifier matches.
4. **Delegation**
   - Use `lottify` whenever multiple agents are delegated.
   - Parallel Writers require stable prerequisites and proven-disjoint write/ownership boundaries. When an unstable shared boundary is involved, keep multi-agent coordination serialized with one Writer owning that boundary at a time.
5. **Implementation**
   - Use `tdd` for behavior where a meaningful test-first seam exists.
   - Implement only the approved work package; generated clients, migrations, configuration, and Admin controls remain part of the owning vertical when the approved plan requires them.
6. **Test**
   - Run the test levels required by Ticket 16 for the changed invariant.
   - Contract changes require compatibility/contract evidence; transactional behavior requires deterministic integration evidence.
7. **Actual Result**
   - Verify the observable result against the approved requirement.
   - For Member/Admin UX, use `vercel:agent-browser-verify` and verify functional behavior plus user-visible normal/error/recovery states against the approved UX/design source.
   - Screenshots may supplement but never replace functional evidence.
8. **Review**
   - Run `code-review` before merge against both engineering standards and the approved specification.
   - Blocking findings return to the owning step.
9. **Acceptance record**
   - Record Requirement/Decision -> Acceptance Criterion -> Scenario -> Test Level -> Evidence, plus Actual Result and any remaining gap.

## Definition of done

A Feature run is implementation-complete only when the approved behavior is present, the applicable test/evidence levels pass, the Actual Result is observed, browser verification exists for affected Member/Admin UX, code review has no blocking finding, and no source-of-truth mismatch remains.

Implementation-complete does not by itself mean Production GO. Production eligibility is decided separately by Ticket 16 and `production-deploy-workflow.md`.

## Checkpoint policy

Run autonomously through reversible implementation/evidence work. Escalate only for a source-of-truth conflict or unresolved product decision; present the conflicting approved source, proposed change, impacted acceptance evidence, and the exact Change Request decision needed.
