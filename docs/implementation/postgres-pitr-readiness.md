# PostgreSQL PITR operational-readiness status

Source of truth: Wayfinder Tickets 13, 15, 16, and 19. This record does not redefine those requirements.

## Requirement

Production PostgreSQL must support continuous point-in-time recovery with `RPO <= 5 minutes` and `RTO <= 60 minutes`, automated daily backups, and isolated restore verification. Recovery evidence must verify schema/migration state, Ledger invariants, critical business references, and safe recovery of authoritative state rather than database startup alone.

## Plan

1. Keep `archive_mode=on`, place archived WAL outside `PGDATA`, and enforce `archive_timeout <= 300s` without restarting PostgreSQL.
2. Produce a retained PostgreSQL 18 physical base backup using `pg_basebackup`.
3. Create an operational PostgreSQL restore point and switch WAL; this writes recovery metadata/WAL only and does not create or mutate business rows.
4. Restore the physical backup plus archived WAL into an isolated PostgreSQL container and promote exactly at the named restore point.
5. Run deterministic integrity checks against migrations, required critical tables, balanced Ledger postings, Reservation invariants, and validated foreign keys.
6. Retain machine-readable configuration, base-backup, and restore evidence with timestamps, backup checksum, WAL identity, recovery target, and measured RPO/RTO.

## Versioned operations

- `infra/ops/postgres-pitr/configure.sh check|apply|rollback`
- `infra/ops/postgres-pitr/base-backup.sh`
- `infra/ops/postgres-pitr/verify-restore.sh <base-backup.tar.gz>`
- `infra/ops/postgres-pitr/verify-latest.sh`
- `infra/ops/postgres-pitr/integrity.sql`
- `infra/systemd/lottify-postgres-base-backup.service`
- `infra/systemd/lottify-postgres-base-backup.timer`
- `infra/systemd/lottify-postgres-pitr-verify.service`
- `infra/systemd/lottify-postgres-pitr-verify.timer`

`configure.sh` refuses to enable `archive_mode` because that requires a PostgreSQL restart. It only operates when archiving is already enabled, records the previous reloadable settings, and provides an explicit rollback path.

The physical base-backup timer runs daily and defaults to seven-day retention, matching the existing explicit logical-backup retention window. The PITR verification timer runs monthly against the latest physical base backup. Restore verification measures the elapsed time from creation of the named recovery target until its WAL is archived as RPO evidence, then measures end-to-end isolated restore and integrity verification as RTO evidence.

## Deployment alignment gate

Do not apply these controls to a database whose deployed application/schema identity does not match the release candidate being accepted. Platform-level restore success from another Lottify generation is useful diagnostic evidence but is not Ticket 16 acceptance evidence for this candidate.

## Current disposition

Implementation is not accepted until the versioned candidate passes CI and the matching production-like environment produces successful configuration, physical-base-backup, isolated PITR, integrity, RPO, and RTO evidence. Green application CI alone does not close this release gate.

## PostgreSQL 18 sandbox verification — 2026-09-11

- The versioned workflow was executed end to end against an isolated PostgreSQL 18 sandbox: reloadable PITR configuration, physical base backup, named restore point, WAL switch/archive, isolated restore, integrity verification, and configuration rollback.
- The final sandbox run measured `RPO = 0s` from restore-point creation to archived target WAL and `RTO = 3s` for the isolated restore plus integrity gate. Ledger balance, Reservation, migration, required-table, and foreign-key checks passed.
- The sandbox rollback restored `archive_timeout=0` and the prior empty sandbox `archive_command`; the production PostgreSQL container was not modified by this execution.
- This proves the operational tooling path, not the Lottify release gate. The currently deployed `lottify-prod` database belongs to the `lottify-v2-*` deployment while this work package is for the current `lottify` candidate, so production application/schema alignment remains mandatory before applying the configuration or claiming Ticket 16 acceptance.
