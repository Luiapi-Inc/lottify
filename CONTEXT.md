# Lottify v1

Lottify v1 is a single-operator lottery platform whose domain centers on configurable lottery products, draw-based betting, immutable financial accounting, and governed operational workflows.

## Language

**Member**:
A person who registers with a phone number and may become eligible to deposit, bet, receive winnings, and withdraw according to policy.
_Avoid_: User, Customer, Player when referring to the canonical domain actor

**Login Identity**:
The phone-number identity used to authenticate a Member; email is profile/contact data and is not a login identifier in v1.
_Avoid_: Email login, Username

**Session**:
An authenticated access relationship for one Member or Admin actor that can be revoked independently.
_Avoid_: Account

**Device**:
A recognized client endpoint associated with authentication and risk signals without being treated as proof of identity by itself.
_Avoid_: Identity

**Lottery Product**:
A configurable lottery offering that defines its Bet Types, result shape, schedule semantics, and settlement rules.
_Avoid_: Lottery Category, Game

**Draw**:
A specific scheduled occurrence of a Lottery Product with its own lifecycle, cutoff, snapshotted configuration, result, and settlement.
_Avoid_: Round, Event

**Bet Type**:
A Product-defined way to interpret a canonical number selection, including its validation, payout, limits, and settlement rule.
_Avoid_: Market, Bet Category

**Bet Order**:
The atomic member submission that groups one or more Bet Lines and is confirmed or rejected as a whole.
_Avoid_: Ticket when referring to the aggregate

**Bet Line**:
A canonical wager inside a Bet Order for one Bet Type, number selection, and stake.
_Avoid_: Item, Selection

**Quote**:
A short-lived pre-confirmation snapshot of applicable payout, restrictions, and totals that does not reserve exposure capacity in v1.
_Avoid_: Odds lock

**Bet Receipt**:
The immutable member-facing reference for a confirmed Bet Order and the terms accepted at confirmation.
_Avoid_: Invoice

**Wallet**:
The member-facing financial projection of available, reserved, and locked value derived from authoritative Ledger activity.
_Avoid_: Ledger

**Ledger**:
The authoritative immutable double-entry accounting record for every financial movement.
_Avoid_: Wallet, Balance table

**Reservation**:
A durable hold on Member value that reduces available balance without transferring ownership in the Ledger; it remains governed by the business workflow that created it until consumed or released.
_Avoid_: Ledger posting, Temporary debit

**Balance Bucket**:
A classification of member value such as CASH, BONUS, or LOCKED whose spending and withdrawal behavior is governed by policy.
_Avoid_: Account status

**Promotion Campaign**:
A versioned offer that defines eligibility, rewards, stacking, expiry, and turnover behavior.
_Avoid_: Member Promotion

**Promotion Entitlement**:
A Member-specific grant of a Promotion Campaign whose terms are snapshotted when granted.
_Avoid_: Campaign

**Turnover**:
The eligible wagering contribution accumulated toward a Promotion Entitlement's release conditions.
_Avoid_: Deposit volume

**Result**:
The validated Product-shaped winning data for a Draw.
_Avoid_: Settlement

**Settlement**:
The deterministic process that evaluates confirmed Bet Lines against a validated Result and posts the resulting financial effects.
_Avoid_: Result

**Settlement Batch**:
A durable settlement execution unit whose internal work may progress incrementally while its Member-visible outcome becomes authoritative only when the batch completes.
_Avoid_: One giant database transaction, Partial settlement result

**Payout Destination**:
A Member-linked destination, such as a verified bank account, eligible to receive a Withdrawal according to policy.
_Avoid_: Wallet

**Capability Restriction**:
A policy-enforced limitation on a specific Member capability such as betting or withdrawal without necessarily disabling the whole account.
_Avoid_: Account status when only one capability is restricted

**Verification Case**:
A tracked verification attempt for a specific capability or evidence type such as KYC, phone, device, or payout-destination verification.
_Avoid_: Member status

**Risk Signal**:
An observed fact used by policy to inform a risk or eligibility decision; a signal is not itself a restriction or decision.
_Avoid_: Risk decision

**Eligibility Decision**:
A policy result that determines whether a Member may perform a governed capability at a specific decision point.
_Avoid_: Permission, Account status

**Approval**:
A governed maker-checker or threshold-based authorization required before a sensitive action becomes effective.
_Avoid_: Permission

**Audit Record**:
An immutable record of a security-sensitive, administrative, or business-significant action and its actor/context.
_Avoid_: Application log

**Notification**:
A governed member/admin communication request and its delivery outcome across one or more channels.
_Avoid_: Domain event

**Report**:
A read-only business or operational projection derived from authoritative domain state.
_Avoid_: Source of truth
