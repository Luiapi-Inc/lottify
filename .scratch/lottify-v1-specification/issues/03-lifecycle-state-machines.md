# Lock lifecycle state machines and transition invariants

Type: grilling
Status: resolved
Blocked by: 01, 02

## Question

What are the exact states, legal transitions, transition guards, terminal states, retry semantics, and exceptional transitions for Draw, Bet Order/Bet Line, Deposit, Withdrawal, Result, Settlement batch, Promotion Campaign, Promotion Entitlement, KYC verification, Approval, and asynchronous operational jobs?

## Comments

### State-machine round 1 — confirmed

- Draw: `DRAFT → SCHEDULED → OPEN → CLOSED → RESULT_PENDING → RESULT_CONFIRMED → SETTLING → SETTLED`. Cancellation uses `DRAFT/SCHEDULED/OPEN/CLOSED → CANCELLING → CANCELLED`. Reopen from `CLOSED` is exceptional/privileged only and forbidden after Result exists. `CANCELLED` and normal `SETTLED` are terminal; result correction uses a separate correction/re-settlement cycle rather than mutating historical Draw state.
- Bet Order: `DRAFT → QUOTED → CONFIRMING → CONFIRMED → SETTLED`; Member cancellation uses `CONFIRMED → CANCELLING → CANCELLED`. Quote expiry becomes `EXPIRED`; validation/risk/balance failure at Confirm becomes `REJECTED`; transient failures in `CONFIRMING/CANCELLING` remain retryable in-place. `REJECTED`, `EXPIRED`, `CANCELLED`, and `SETTLED` are terminal. Bet Lines inherit Order acceptance/cancellation state in v1 but retain per-Line settlement outcomes.
- Deposit: `CREATED → PROVIDER_PENDING → VERIFYING → CREDITING → COMPLETED`. Unmatched/ambiguous matching can enter `REVIEW_REQUIRED`; definitive provider failure becomes `FAILED`; ambiguous provider outcome becomes `RECONCILING`. Chargeback/reversal after completion creates a separate recovery/reversal workflow and never rewrites the completed Deposit. `COMPLETED` and `FAILED` are terminal for the original Deposit transaction.
- Withdrawal: `REQUESTED → RESERVING → REVIEWING → APPROVED → PAYOUT_PROCESSING → PAYOUT_CONFIRMED → FINALIZING → COMPLETED`. Member cancellation before payout uses `CANCELLING → CANCELLED`; policy/review rejection becomes `REJECTED` with reserve release; definitive payout failure becomes `FAILED` with authoritative release/recovery; unknown provider outcome becomes `RECONCILING` and retains the reserve. `COMPLETED`, `CANCELLED`, `REJECTED`, and resolved `FAILED` are terminal.
- Result revisions and Settlement Batches are separate state machines. Result revision: `RECEIVED/DRAFT → VALIDATING → REVIEW_REQUIRED? → CONFIRMED`, with a prior confirmed revision becoming relationally `SUPERSEDED` when a correction revision is confirmed; confirmed payloads remain immutable. Settlement Batch: `PENDING → CALCULATING → POSTING → COMMITTING → COMPLETED`; failures enter `FAILED/RETRY_PENDING`, remain non-visible as partial settlement, and resume from durable checkpoints with idempotent financial postings.

### State-machine round 2 — confirmed

- Promotion Campaign: `DRAFT → SCHEDULED → ACTIVE → PAUSED → ENDED`. `DRAFT → CANCELLED` is allowed before launch; `PAUSED → ACTIVE` is allowed according to policy. `ENDED` and `CANCELLED` are terminal. Once a Campaign version has taken effect, changes use a new version rather than rewriting historical state.
- Promotion Entitlement: `PENDING → GRANTED → ACTIVE → COMPLETED`. Active Entitlements may instead become `EXPIRED` or, only through governed anti-abuse/correction flow, `REVOKED`. A transition that asserts a reward/grant/conversion has completed cannot occur before its required Wallet & Ledger posting succeeds. `COMPLETED`, `EXPIRED`, and `REVOKED` are terminal.
- KYC Verification Case: `CREATED → SUBMITTED → VERIFYING → VERIFIED`. Cases may enter `REVIEW_REQUIRED`, `MORE_INFO_REQUIRED`, `REJECTED`, or `RETRY_PENDING` according to review/evidence/provider outcome. Technical/provider retry does not alter historical evidence; a later independent verification attempt creates a new Case rather than rewriting the prior result.
- Approval: `PENDING → APPROVED | REJECTED | EXPIRED | CANCELLED`. The first valid terminal decision is authoritative and immutable. Reconsideration creates a new Approval referencing the previous one. The originating domain workflow remains owner and resumes from the Approval result.
- Async Operational Job: `QUEUED → RUNNING → SUCCEEDED`; transient failure uses `RUNNING → RETRY_PENDING → QUEUED`. Exhausted retry policy moves the job to `DEAD_LETTERED`; operator/system replay uses `DEAD_LETTERED → REPLAY_QUEUED → RUNNING`. Every attempt/replay retains failure history and must preserve business-effect idempotency.

## Answer

Lottify v1 uses explicit lifecycle state machines with one owner per aggregate/workflow, immutable terminal/history semantics, durable retry states, and exceptional transitions that never bypass financial, approval, or audit invariants.

1. **Draw** — `DRAFT → SCHEDULED → OPEN → CLOSED → RESULT_PENDING → RESULT_CONFIRMED → SETTLING → SETTLED`. Cancellation uses `... → CANCELLING → CANCELLED`. Closed Draw reopen is privileged/exceptional only and forbidden once a Result exists. `CANCELLED` and normal `SETTLED` are terminal; result correction is modeled as a separate correction/re-settlement cycle.
2. **Bet Order / Bet Line** — Order: `DRAFT → QUOTED → CONFIRMING → CONFIRMED → SETTLED`; cancellation: `CONFIRMED → CANCELLING → CANCELLED`; quote expiry: `EXPIRED`; authoritative Confirm rejection: `REJECTED`. Retryable failures remain resumable in `CONFIRMING/CANCELLING`. Bet Lines inherit Order acceptance/cancellation in v1 while retaining independent settlement outcomes.
3. **Deposit** — `CREATED → PROVIDER_PENDING → VERIFYING → CREDITING → COMPLETED`, with `REVIEW_REQUIRED`, `RECONCILING`, or `FAILED` for matching/provider exceptions. Chargeback/reversal after completion is a separate recovery workflow, not mutation of the completed Deposit.
4. **Withdrawal** — `REQUESTED → RESERVING → REVIEWING → APPROVED → PAYOUT_PROCESSING → PAYOUT_CONFIRMED → FINALIZING → COMPLETED`; cancellation uses `CANCELLING → CANCELLED`; policy rejection becomes `REJECTED`; definitive provider failure becomes `FAILED`; unknown external outcome becomes `RECONCILING` while funds remain reserved until authoritative resolution.
5. **Result revision** — `RECEIVED/DRAFT → VALIDATING → REVIEW_REQUIRED? → CONFIRMED`; confirmed revisions are immutable. A corrected Result is a new revision, and the prior revision becomes relationally `SUPERSEDED` when the new revision is confirmed.
6. **Settlement Batch** — `PENDING → CALCULATING → POSTING → COMMITTING → COMPLETED`; failure uses `FAILED/RETRY_PENDING` with durable resume and idempotent postings. Partial settlement is never exposed to Members.
7. **Promotion Campaign** — `DRAFT → SCHEDULED → ACTIVE → PAUSED → ENDED`, with pre-launch `DRAFT → CANCELLED` and policy-controlled `PAUSED → ACTIVE`. `ENDED/CANCELLED` are terminal and published history is versioned rather than rewritten.
8. **Promotion Entitlement** — `PENDING → GRANTED → ACTIVE → COMPLETED`, or `ACTIVE → EXPIRED/REVOKED` under the approved rules. Monetary-dependent transitions wait for authoritative Wallet & Ledger effects.
9. **KYC Verification Case** — `CREATED → SUBMITTED → VERIFYING → VERIFIED`, with `REVIEW_REQUIRED`, `MORE_INFO_REQUIRED`, `RETRY_PENDING`, or `REJECTED` for exceptional outcomes. New verification attempts create new Cases rather than rewriting prior evidence/results.
10. **Approval** — `PENDING → APPROVED | REJECTED | EXPIRED | CANCELLED`; terminal decisions are immutable and reconsideration creates a new Approval.
11. **Async Operational Job** — `QUEUED → RUNNING → SUCCEEDED`; retry: `RUNNING → RETRY_PENDING → QUEUED`; exhausted retries: `DEAD_LETTERED`; replay: `DEAD_LETTERED → REPLAY_QUEUED → RUNNING`. Attempts preserve failure history and once-only business effects.

Across all state machines, automatic and manual transitions must use the same transition guards. Retry/replay resumes from durable state and cannot duplicate financial or business effects.
