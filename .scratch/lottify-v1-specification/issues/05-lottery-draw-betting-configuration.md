# Lock Lottery Product, Draw and betting configuration semantics

Type: grilling
Status: resolved
Blocked by: 01

## Question

What is the exact versioned configuration model for Lottery Product, Bet Type, Schedule Template, Draw snapshot/override, payout, cutoff, number restrictions, min/max stake, exposure/liability limits, Result Schema, settlement rules, timezone, and rolling Draw generation while preserving all Q1–Q156 constraints?

## Comments

### Configuration round 1 — confirmed

- Lottery Product is the configuration root and has immutable published versions. Each version defines at least Product timezone, enabled Bet Types, Schedule Template reference, Result Schema/settlement rule references, default payout/limit/restriction policy references, and effective period. Product lifecycle is separate from configuration-version lifecycle; publishing a new version never mutates historical versions.
- Bet Type has a stable identity/code while validation, canonical number format, default payout, min/max stake, limits, and settlement rule are versioned configuration. Every Draw snapshot references the exact Bet Type configuration versions used so historical bets remain reproducible.
- Schedule Template is represented as structured business schedule data rather than raw RRULE input. It carries local timezone, recurrence pattern, expected Draw/open/cutoff times, rolling-generation horizon, and date-specific exceptions/overrides for irregular real-world Draw dates.
- Creating a Draw snapshots the effective Product version, enabled Bet Types and versions, payout, stake limits, restriction baseline, Result Schema/settlement rules, timezone, and business schedule. Later Product-version changes do not mutate a published/open Draw.
- Per-Draw changes use explicit versioned Draw Overrides rather than silent mutation of the original snapshot. Allowed override fields include Draw date/time, cutoff, payout, min/max stake, number restrictions, and result source. Each override records reason, effective time, actor/approval/audit evidence and is previewed as a diff before publish.

### Configuration round 2 — confirmed

- Payout precedence resolves as `Draw Override → Draw Snapshot / Bet Type Version Default`. Quote snapshots the resolved payout, and Confirm uses that accepted Quote value while the Quote remains valid; later configuration changes never rewrite a confirmed Bet's payout.
- Number restrictions resolve from Product/Bet Type baseline plus Draw-specific overrides before Quote. `BLOCKED` dominates all other rules, `MAX_AMOUNT` uses the strictest applicable amount, and `REDUCED_PAYOUT` uses the most restrictive applicable payout policy. Hard/emergency restrictions may invalidate an otherwise unexpired Quote immediately.
- Stake/exposure/liability controls are modeled separately for per-Line min/max stake, Bet Order limits, Member limits, Product/Draw exposure, number-level exposure, and max payout/liability. When multiple limits apply, the strictest applicable rule wins; Confirm recomputes against authoritative current exposure.
- Result Schema and Settlement Rules are immutable published versions. A Draw snapshots the exact versions and both Result validation and Settlement use those Draw-snapshotted versions rather than the latest Product configuration at result time.
- Rolling Draw generation is idempotent by Product plus schedule-occurrence identity. Re-running the generator cannot create duplicates; schedule exceptions can skip/move/replace an occurrence; manually created exceptional Draws retain distinct provenance; and generation never overwrites a Draw that already has manual override or business activity.

### Configuration round 3 — confirmed

- Draw cutoff is a single server-authoritative instant shared by all Bet Types in the Draw. Business schedule calculation uses the Product timezone, while the persisted cutoff is a canonical instant. Quote/Confirm are forbidden after cutoff. Cutoff changes require a versioned Draw Override; extending a Draw after closure requires the already-governed exceptional reopen workflow.
- Product timezone is versioned configuration. A timezone change affects future Draw generation only; existing Draws retain their snapshotted timezone/schedule semantics and historical instants are never reinterpreted through a newer timezone version.
- Published configuration follows `DRAFT → REVIEW/APPROVAL → PUBLISHED` with effective periods. Ambiguous overlapping published effective versions in the same scope are forbidden. Future-effective versions do not mutate Draws that have already snapshotted configuration.
- While a Draw is OPEN, a versioned Draw Override may affect only future decisions. Confirmed Bets are immutable. Existing Quotes keep their accepted snapshot until expiry unless invalidated by a hard/emergency restriction; newly created Quotes use the latest effective Draw configuration. Every live change requires diff, reason, audit and approval according to policy.
- Disabling a Bet Type in a new Product version affects future Draws only. Stopping that Bet Type in an already-selling Draw requires an explicit Draw-level operational/configuration override. Historical Bet Lines retain the exact Bet Type version they accepted and remain settleable under that version.

## Answer

Lottify v1 uses immutable, effective-dated configuration versions with explicit Draw snapshots and governed Draw Overrides so Product evolution never silently changes active or historical betting semantics.

1. **Lottery Product versions** — Product is the configuration root. Published versions define timezone, enabled Bet Types, schedule reference, Result Schema/Settlement Rule references, payout/limit/restriction references and effective period. Product lifecycle is independent of config-version lifecycle.
2. **Bet Type versions** — each Bet Type has a stable identity/code while canonical number format, validation, payout, min/max stake, limits and settlement behavior are immutable versioned configuration. Draws snapshot exact Bet Type versions.
3. **Schedule Template** — represented as structured business schedule data, not raw RRULE input, including local timezone, recurrence semantics, expected open/draw/cutoff times, rolling horizon and date-specific exceptions for irregular real-world Draw dates.
4. **Draw snapshot** — at creation, a Draw snapshots the effective Product/Bet Type versions, payout, limits, restriction baseline, Result Schema/Settlement Rules, timezone and business schedule. Later Product changes do not mutate the Draw.
5. **Draw Override** — per-Draw changes are explicit versioned overrides with allowed fields, reason, effective time, actor, diff, approval and audit evidence. Silent mutation of the original snapshot is forbidden.
6. **Payout resolution** — `Draw Override → Draw Snapshot / Bet Type Version Default`. Quote snapshots the resolved payout; a valid Quote preserves that accepted payout and confirmed Bets are never retroactively repriced.
7. **Restrictions** — Product/Bet Type baseline plus Draw override resolve into one effective rule set. `BLOCKED` dominates, `MAX_AMOUNT` uses the strictest amount, and `REDUCED_PAYOUT` uses the most restrictive applicable payout rule. Hard/emergency restrictions can invalidate an unconfirmed Quote immediately.
8. **Limits** — per-Line stake, Order, Member, Product/Draw exposure, number exposure and max payout/liability are separate controls. The strictest applicable limit governs and Confirm recomputes against authoritative live exposure.
9. **Result/Settlement versions** — Draws snapshot immutable Result Schema and Settlement Rule versions. Result validation and Settlement always use those snapshotted versions, never a later Product version.
10. **Draw generation** — rolling generation is idempotent by Product plus schedule-occurrence identity. Exceptions may skip/move/replace occurrences; manually created exceptional Draws retain provenance; generation never overwrites Draws with overrides or business activity.
11. **Cutoff/time** — each Draw has one cutoff for all Bet Types. Product timezone drives schedule calculation, persisted business times are canonical server-authoritative instants, and post-cutoff Quote/Confirm is forbidden.
12. **Timezone changes** — affect only future generation. Existing Draws retain the timezone/schedule snapshot under which they were created.
13. **Publication** — important configuration uses `DRAFT → REVIEW/APPROVAL → PUBLISHED` with non-ambiguous effective periods; published historical versions remain immutable.
14. **Changes during OPEN** — live overrides affect future decisions only. Confirmed Bets remain unchanged; existing Quotes retain their snapshot unless a hard/emergency policy invalidates them; new Quotes use the latest effective Draw configuration.
15. **Disabling Bet Types** — Product-version disablement affects future Draws. An active Draw requires an explicit Draw-level override, while historical Bet Lines remain tied to and settled by their accepted Bet Type version.

These rules make every Draw, Quote, Bet and Settlement reproducible from immutable configuration versions plus the Draw snapshot/override history that actually governed the transaction.
