import { createServer, type Server } from "node:http";
import Redis from "ioredis";
import { PrismaService } from "../../../src/platform/persistence/prisma.service";
import { getEnvironment } from "../../../src/platform/config/env";

export function startWorkerHealthServer(prisma: PrismaService, port: number): Server {
  let started = true;
  const server = createServer(async (request, response) => {
    if (request.url === "/internal/health/live") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.url === "/internal/health/startup") {
      response.writeHead(started ? 200 : 503, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: started }));
      return;
    }
    if (request.url === "/internal/health/ready") {
      let postgres = false;
      let redis = false;
      try {
        await prisma.$queryRaw`SELECT 1`;
        postgres = true;
      } catch {
        postgres = false;
      }
      const redisClient = new Redis(getEnvironment().REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 750,
        retryStrategy: () => null,
      });
      redisClient.on("error", () => undefined);
      try {
        await redisClient.connect();
        await redisClient.ping();
        redis = true;
      } catch {
        redis = false;
      } finally {
        redisClient.disconnect();
      }
      const ok = postgres && redis;
      response.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok, dependencies: { postgres, redis } }));
      return;
    }
    response.writeHead(404).end();
  });
  server.listen(port, "0.0.0.0");
  return server;
}
