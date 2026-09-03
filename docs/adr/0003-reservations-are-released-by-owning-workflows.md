# Reservations are released by owning workflows

Reservations do not use a generic TTL that automatically returns funds merely because time elapsed. The owning workflow decides when a Reservation is consumed or released from authoritative state: for example, a Withdrawal with an ambiguous provider outcome keeps its funds reserved until reconciliation proves the outcome, while stale or orphan-looking reservations enter recovery/reconciliation instead of automatic release. This chooses financial safety and once-only recovery over convenience cleanup that could make the same value spendable while an external effect is still possible.

Source decisions: Wayfinder Tickets 02, 04, 09 and 16.
