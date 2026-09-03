import { Queue } from "bullmq";
import { getEnvironment } from "../config/env";

export function redisConnectionOptions(): { host: string; port: number; username?: string; password?: string } {
  const url = new URL(getEnvironment().REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
  };
}

export function createQueue(name: string): Queue {
  return new Queue(name, { connection: redisConnectionOptions() });
}
