import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvironmentForTests } from "../../src/platform/config/env";
import { PrismaService } from "../../src/platform/persistence/prisma.service";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";

describe.runIf(runIntegration)("Prisma connection timezone (Tickets 04/14/16)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvironmentForTests();
  });

  it.each(["PGOPTIONS", "DATABASE_URL"] as const)(
    "pins every pooled connection to UTC despite %s, preserving other startup options",
    async (source) => {
      const url = new URL(process.env.DATABASE_URL!);
      const options = "-c timezone=Asia/Bangkok -c statement_timeout=12345";
      url.searchParams.delete("options");
      vi.stubEnv("PGOPTIONS", options);
      if (source === "DATABASE_URL") {
        url.searchParams.set("options", options);
        // The URL must retain its precedence for unrelated options.
        vi.stubEnv("PGOPTIONS", "-c timezone=Asia/Tokyo -c statement_timeout=23456");
      }
      vi.stubEnv("DATABASE_URL", url.toString());
      resetEnvironmentForTests();

      const control = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url.toString() }),
      });
      const prisma = new PrismaService();
      try {
        const [unconfigured] = await control.$queryRaw<Array<{ timezone: string }>>`
          SELECT current_setting('TimeZone') AS timezone
        `;
        expect(unconfigured?.timezone).toBe("Asia/Bangkok");

        // Hold three transactions until all have acquired a connection. A SET
        // issued once on an arbitrary pooled connection cannot satisfy this.
        let arrived = 0;
        let release!: () => void;
        const ready = new Promise<void>((resolve) => { release = resolve; });
        const clocks = await Promise.all(Array.from({ length: 3 }, () =>
          prisma.$transaction(async (tx) => {
            const [clock] = await tx.$queryRaw<Array<{
              pid: number;
              timezone: string;
              statementTimeout: string;
              instant: Date;
              epochMs: number;
            }>>(Prisma.sql`
              SELECT pg_backend_pid() AS pid,
                current_setting('TimeZone') AS timezone,
                current_setting('statement_timeout') AS "statementTimeout",
                transaction_timestamp() AS instant,
                (extract(epoch FROM transaction_timestamp()) * 1000)::double precision AS "epochMs"
            `);
            if (++arrived === 3) release();
            await ready;

            // Exercise the existing TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP
            // column through SQL so Prisma cannot supply a client-side value.
            const id = randomUUID();
            const [account] = await tx.$queryRaw<Array<{ createdAt: Date }>>(Prisma.sql`
              INSERT INTO ledger_accounts (id, kind, system_code, currency)
              VALUES (${id}::uuid, 'SYSTEM', ${`timezone-test:${id}`}, 'THB')
              RETURNING created_at AS "createdAt"
            `);
            await tx.ledgerAccount.delete({ where: { id } });
            return { ...clock!, createdAt: account!.createdAt };
          }),
        ));
        expect(new Set(clocks.map((clock) => clock.pid)).size).toBe(3);
        for (const clock of clocks) {
          expect(clock.timezone).toBe("UTC");
          expect(clock.statementTimeout).toBe("12345ms");
          expect(Math.abs(clock.instant.getTime() - clock.epochMs)).toBeLessThan(1);
          expect(Math.abs(clock.createdAt.getTime() - clock.epochMs)).toBeLessThan(1);
        }
      } finally {
        await Promise.all([control.$disconnect(), prisma.$disconnect()]);
      }
    },
  );
});
