// PostgreSQL implementation of the Draw admission boundary (Issue 117 rework).
//
// The mutual exclusion is a transaction-scoped advisory lock keyed by the Draw
// (`pg_advisory_xact_lock(namespace, key)`), taken on the pinned connection of
// an interactive Prisma transaction and released by PostgreSQL when that
// transaction ends — including when the transaction is aborted because `work`
// threw. Nothing has to be cleaned up by hand, and a crashed process cannot
// leave the boundary held: the connection dies with it.
//
// The lock key is derived in-process (SHA-256 of the Draw id) rather than with
// PostgreSQL's `hashtext`, so the key is stable across PostgreSQL versions and
// reproducible in tests. The two-key form keeps the Draw keys in their own
// namespace, so no other advisory-lock user in this database can collide with a
// Draw admission lock. A 32-bit collision between two different Draw ids is
// possible in principle; its only effect is that two unrelated Draws serialise
// against each other, never that two writers of one Draw run concurrently.

import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../persistence/prisma.service";
import {
  DRAW_ADMISSION_BOUNDARY,
  type DrawAdmissionBoundary,
} from "./draw-admission.port";

/** Advisory-lock namespace holding every Draw admission lock. */
export const DRAW_ADMISSION_LOCK_NAMESPACE = 117_000;

/**
 * How long a caller may wait for a pool connection, and how long the boundary
 * transaction may stay open while another writer holds the lock. The provider
 * is 2x the wall clock of the longest cancellation run; a caller that waits
 * longer than this fails its own request instead of blocking indefinitely.
 */
export const DRAW_ADMISSION_MAX_WAIT_MS = 120_000;
export const DRAW_ADMISSION_TIMEOUT_MS = 120_000;

@Injectable()
export class PrismaDrawAdmissionBoundary implements DrawAdmissionBoundary {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async admit<T>(drawId: string, work: () => Promise<T>): Promise<T> {
    const id = drawId?.trim();
    if (!id) {
      throw new Error("A Draw admission boundary requires a Draw id");
    }
    const key = drawAdmissionLockKey(id);

    return this.prisma.$transaction(
      async (tx) => {
        // `$executeRaw`, not `$queryRaw`: the lock function returns PostgreSQL
        // `void`, which the pg driver adapter cannot map to a column value, and
        // this call has no result to read anyway.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DRAW_ADMISSION_LOCK_NAMESPACE}::int, ${key}::int)`;
        return work();
      },
      {
        maxWait: DRAW_ADMISSION_MAX_WAIT_MS,
        timeout: DRAW_ADMISSION_TIMEOUT_MS,
      },
    );
  }
}

/** The int4 advisory-lock key of a Draw, stable across processes and versions. */
export function drawAdmissionLockKey(drawId: string): number {
  const digest = createHash("sha256")
    .update(`lottify:draw-admission:${drawId}`)
    .digest();
  return digest.readInt32BE(0);
}

export { DRAW_ADMISSION_BOUNDARY };
