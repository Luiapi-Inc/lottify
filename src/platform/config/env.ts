import { z } from "zod";

const environmentSchema = z
  .object({
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
    QUOTE_TTL_SECONDS: z.coerce.number().int().positive().default(120),
    ADMIN_MFA_ENCRYPTION_KEY: z.string().min(32).optional(),
    ADMIN_MFA_SETUP_TTL_SECONDS: z.coerce.number().int().positive().default(600),
    ADMIN_MFA_CHALLENGE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    ADMIN_MFA_REAUTH_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    ADMIN_LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    ADMIN_LOGIN_LOCKOUT_SECONDS: z.coerce.number().int().positive().default(900),
    MEMBER_OTP_CODE_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
    MEMBER_OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    MEMBER_OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
    MEMBER_OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
    MEMBER_OTP_REQUEST_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
    MEMBER_OTP_REQUEST_MAX_PER_WINDOW: z.coerce.number().int().positive().default(5),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),
    OUTBOX_LOCK_TTL_SECONDS: z.coerce.number().int().positive().default(30),
    OTEL_SERVICE_NAME: z.string().min(1).default("lottify-api"),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional().default(""),
    SENTRY_DSN: z.string().optional().default(""),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  })
  .superRefine((env, ctx) => {
    if (
      (env.APP_ENV === "staging" || env.APP_ENV === "production") &&
      !env.ADMIN_MFA_ENCRYPTION_KEY
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["ADMIN_MFA_ENCRYPTION_KEY"],
        message: "ADMIN_MFA_ENCRYPTION_KEY is required in staging and production",
      });
    }
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

export function getAdminMfaEncryptionKey(): string {
  const env = getEnvironment();
  if (env.ADMIN_MFA_ENCRYPTION_KEY) return env.ADMIN_MFA_ENCRYPTION_KEY;
  if (env.APP_ENV === "local" || env.APP_ENV === "test") {
    return "lottify-local-admin-mfa-encryption-key";
  }
  throw new Error("ADMIN_MFA_ENCRYPTION_KEY is required");
}

export function resetEnvironmentForTests(): void {
  cached = undefined;
}
