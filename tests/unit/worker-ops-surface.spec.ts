import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { startWorkerHealthServer } from "../../apps/workers/src/health-server";
import "../../src/platform/observability/operational-metrics";
import { PrismaService } from "../../src/platform/persistence/prisma.service";
import { resetEnvironmentForTests } from "../../src/platform/config/env";

const ENV_KEYS = [
  "APP_ENV",
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_ACCESS_SECRET",
  "OPS_AUTH_TOKEN",
  "WORKER_HEALTH_PORT",
] as const;

const originalEnv: Record<string, string | undefined> = {};

let server: Server | undefined;

async function start(): Promise<string> {
  resetEnvironmentForTests();
  server = startWorkerHealthServer({} as unknown as PrismaService, 0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const { port } = server!.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.APP_ENV = "test";
  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/lottify";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.JWT_ACCESS_SECRET = "01234567890123456789012345678901";
  delete process.env.OPS_AUTH_TOKEN;
});

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  resetEnvironmentForTests();
});

describe("worker ops surface (F1/F4/F6 metrics scrape target)", () => {
  it("serves the operational metric registry on /metrics", async () => {
    const base = await start();

    const response = await fetch(`${base}/metrics`);

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("# TYPE lottify_outbox_lag gauge");
    expect(body).toContain("# TYPE lottify_withdrawals_stuck_reconciling gauge");
    expect(body).toContain("# TYPE lottify_reconciliation_discrepancies gauge");
  });

  it("requires the bearer token on /metrics whenever OPS_AUTH_TOKEN is set", async () => {
    process.env.OPS_AUTH_TOKEN = "w5-ops-token";
    const base = await start();

    const unauthorized = await fetch(`${base}/metrics`);
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${base}/metrics`, {
      headers: { authorization: "Bearer w5-ops-token" },
    });
    expect(authorized.status).toBe(200);
  });

  it("keeps the health probes unauthenticated so liveness/readiness still work", async () => {
    process.env.OPS_AUTH_TOKEN = "w5-ops-token";
    const base = await start();

    const live = await fetch(`${base}/internal/health/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ ok: true });
  });
});
