import { Injectable } from "@nestjs/common";
import Redis from "ioredis";
import { getEnvironment } from "../../../src/platform/config/env";
import { PrismaService } from "../../../src/platform/persistence/prisma.service";

@Injectable()
export class HealthService {
  private started = false;

  constructor(private readonly prisma: PrismaService) {}

  markStarted(): void {
    this.started = true;
  }

  startup(): { ok: boolean } {
    return { ok: this.started };
  }

  liveness(): { ok: true } {
    return { ok: true };
  }

  async readiness(): Promise<{
    ok: boolean;
    dependencies: { postgres: "up" | "down"; redis: "up" | "degraded" };
  }> {
    let postgres: "up" | "down" = "down";
    let redis: "up" | "degraded" = "degraded";

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      postgres = "up";
    } catch {
      postgres = "down";
    }

    const client = new Redis(getEnvironment().REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 750,
      retryStrategy: () => null,
    });
    client.on("error", () => undefined);
    try {
      await client.connect();
      await client.ping();
      redis = "up";
    } catch {
      redis = "degraded";
    } finally {
      client.disconnect();
    }

    return { ok: postgres === "up", dependencies: { postgres, redis } };
  }
}
