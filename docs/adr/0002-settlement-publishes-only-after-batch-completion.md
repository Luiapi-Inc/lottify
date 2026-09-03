# Settlement publishes only after batch completion

Large settlements are processed with durable checkpoints/chunks and idempotent financial postings rather than one database transaction spanning every Bet Line. The Member-visible settlement boundary is the completed Settlement Batch: intermediate calculation/posting progress remains non-authoritative for Member presentation, and the new settlement outcome is published only after the batch reaches `COMPLETED`. This avoids long, fragile transactions while preserving the specification rule that Members never observe a partial settlement outcome.

Source decisions: Wayfinder Tickets 02, 03, 13, 15 and 16.
