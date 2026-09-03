import { z } from "zod";

const environmentSchema = z.object({
  APP_ENV: z.enum(["local", "test", "staging", "production"]).default("local"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(3100),
  WORKER_GROUP: z
    .enum(["settlement", "payment-reconciliation", "notification", "scheduler-outbox"])
    .default("scheduler-outbox"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  OUTBOX_LOCK_TTL_SECONDS: z.coerce.number().int().positive().default(30),
  OTEL_SERVICE_NAME: z.string().min(1).default("lottify-api"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional().default(""),
  SENTRY_DSN: z.string().optional().default(""),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Environment = z.infer<typeof environmentSchema>;

let cached: Environment | undefined;

export function parseEnvironment(input: Record<string, string | undefined>): Environment {
  return environmentSchema.parse(input);
}

export function getEnvironment(): Environment {
  cached ??= parseEnvironment(process.env);
  return cached;
}

export function resetEnvironmentForTests(): void {
  cached = undefined;
}
