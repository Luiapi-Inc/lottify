# Critical command idempotency is durable

Critical mutations persist idempotency state durably with the principal/operation/business scope, request hash, canonical resource or operation identity, and the result identity established by the first accepted command. Reusing the key with the same request resolves to that original resource/result even if the HTTP response was lost; reusing it with a different request conflicts. The idempotency record is committed with the authoritative command acceptance/effect boundary so a process crash cannot turn a successful mutation into a second logical operation on retry.

Source decisions: Wayfinder Tickets 02, 09, 10, 15 and 16.
