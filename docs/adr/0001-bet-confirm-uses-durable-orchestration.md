# Bet Confirm uses durable orchestration

Bet Confirm crosses Betting and Wallet & Ledger ownership, so it is not implemented as one hidden cross-context database transaction. Betting persists `CONFIRMING` plus the business/idempotency identity, Wallet & Ledger performs reserve/consume under that stable identity, and Betting resumes from durable state to reach `CONFIRMED`; if a process fails after the financial effect commits, recovery observes the existing effect rather than debiting or creating the Bet Order again. This preserves explicit context ownership and once-only financial effects without pretending an external or cross-process distributed transaction exists.

Source decisions: Wayfinder Tickets 02, 04, 15 and 16.
