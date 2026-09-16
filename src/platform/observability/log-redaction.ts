import { ConsoleLogger, type ConsoleLoggerOptions, type LogLevel } from "@nestjs/common";
import type { DestinationStream, LevelWithSilent } from "pino";
import pinoHttp, { type HttpLogger, type Options as PinoHttpOptions } from "pino-http";

/**
 * Credential/PII redaction for operational telemetry (Ticket 13 security gate:
 * "verification that sensitive logs do not leak credentials, tokens, secrets,
 * or protected PII").
 *
 * Two sinks exist in this platform:
 *  - the pino-http access logger installed by `apps/api/src/main.ts`, which
 *    serializes `req.headers` / `res.headers` (including `authorization`,
 *    `cookie` and `set-cookie`) into every request record;
 *  - the Nest `ConsoleLogger({ json: true })` used by the API and worker
 *    bootstraps for application logs, error stacks and operational alerts.
 *
 * Both must go through this module. Adding a new credential-bearing header or
 * log field means extending the lists below — never logging it raw.
 */

export const REDACTED_VALUE = "[REDACTED]";

/** Header names whose values are credential material and must never be logged. */
export const SENSITIVE_HEADER_NAMES = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-otp-code",
  "x-auth-token",
  "x-access-token",
  "x-refresh-token",
] as const;

/**
 * pino/fast-redact paths covering the request and response header bags that the
 * pino-std-serializers emit. `set-cookie` is emitted as an array, so both the
 * whole-array path and its element wildcard are registered.
 */
export const HTTP_ACCESS_LOG_REDACT_PATHS: readonly string[] = [
  ...SENSITIVE_HEADER_NAMES.flatMap((header) => [
    `req.headers["${header}"]`,
    `res.headers["${header}"]`,
  ]),
  'req.headers["set-cookie"][*]',
  'res.headers["set-cookie"][*]',
];

/**
 * Object keys that carry credentials, OTP codes or the phone identity used as
 * the Member login identity. Keys are compared after stripping non
 * alphanumerics and lowercasing (`set-cookie` === `setCookie`).
 */
export const SENSITIVE_LOG_KEY_NAMES: readonly string[] = [
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "apikey",
  "apisecret",
  "xapikey",
  "xotpcode",
  "otp",
  "otpcode",
  "otpsecret",
  "totpsecret",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "sessiontoken",
  "token",
  "password",
  "passwordhash",
  "secret",
  "clientsecret",
  "credential",
  "credentials",
  "phone",
  "phonenumber",
  "msisdn",
];

const SENSITIVE_LOG_KEY_SET = new Set(SENSITIVE_LOG_KEY_NAMES);

/** Free-text patterns that leak credentials inside messages, URLs or stacks. */
const SENSITIVE_TEXT_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=%-]{6,}/gi,
  /\bBasic\s+[A-Za-z0-9+/=]{8,}/gi,
  /\b(?:lottify_refresh|refresh_token|access_token|id_token|api_key|client_secret)=([^;,\s"'&]+)/gi,
  /"(?:authorization|cookie|set-cookie|refresh_token|access_token|id_token|otp_code|password|api_key)"\s*:\s*"[^"]*"/gi,
  // The Member login identity is the phone number; keep it out of free text.
  /(?:\+\d{9,15}|\b0\d{8,9})\b/g,
];

const MAX_REDACTION_DEPTH = 8;

export function isSensitiveLogKey(key: string): boolean {
  return SENSITIVE_LOG_KEY_SET.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

/**
 * Masks credential-looking substrings inside a free-text value. A string that
 * merely *contains* a secret (an error message echoing a `Cookie` header, a
 * serialized record, a URL with a token query parameter) cannot be fixed by
 * key-based redaction, so the value itself is rewritten.
 */
export function redactSensitiveText(value: string): string {
  return SENSITIVE_TEXT_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, REDACTED_VALUE),
    value,
  );
}

function redactError(error: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  seen.add(error);
  const redacted: Record<string, unknown> = {
    name: error.name,
    message: redactSensitiveText(error.message),
  };
  if (error.stack !== undefined) {
    redacted.stack = redactSensitiveText(error.stack);
  }
  for (const [key, item] of Object.entries(error)) {
    redacted[key] = isSensitiveLogKey(key) ? REDACTED_VALUE : redactLogValue(item, depth + 1, seen);
  }
  return redacted;
}

/**
 * Deep-redacts any log payload. Non-plain values that are not containers are
 * returned unchanged; containers are rebuilt so the emitted record never
 * carries a sensitive key or a credential-looking string.
 */
export function redactLogValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date || value instanceof RegExp) {
    return value;
  }
  if (value instanceof Error) {
    return redactError(value, depth, seen);
  }
  if (seen.has(value)) {
    return "[circular]";
  }
  if (depth >= MAX_REDACTION_DEPTH) {
    return "[truncated]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item, depth + 1, seen));
  }
  if (value instanceof Map) {
    return redactLogValue(Object.fromEntries(value), depth + 1, seen);
  }
  if (value instanceof Set) {
    return [...value].map((item) => redactLogValue(item, depth + 1, seen));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    redacted[key] = isSensitiveLogKey(key) ? REDACTED_VALUE : redactLogValue(item, depth + 1, seen);
  }
  return redacted;
}

/** pino-http options for the API access logger (redaction required, always on). */
export function httpAccessLoggerOptions(level: LevelWithSilent): PinoHttpOptions {
  return {
    level,
    redact: {
      paths: [...HTTP_ACCESS_LOG_REDACT_PATHS],
      censor: REDACTED_VALUE,
    },
  };
}

/**
 * The access logger installed by `apps/api/src/main.ts`. The optional
 * `destination` is the pino stream seam used by tests to capture records; in
 * production it is omitted and records go to stdout.
 */
export function createHttpAccessLogger(
  level: LevelWithSilent,
  destination?: DestinationStream,
): HttpLogger {
  return pinoHttp(httpAccessLoggerOptions(level), destination);
}

/**
 * Drop-in replacement for the `ConsoleLogger({ json: true })` used by the API
 * and worker bootstraps. Redaction happens in `printMessages`, the single sink
 * every log level funnels through, and in `printStackTrace` for the non-JSON
 * stderr path.
 */
export class RedactingConsoleLogger extends ConsoleLogger {
  constructor(options: ConsoleLoggerOptions = {}) {
    super(options);
  }

  protected override printMessages(
    messages: unknown[],
    context = "",
    logLevel: LogLevel = "log",
    writeStreamType?: "stdout" | "stderr",
    errorStack?: unknown,
  ): void {
    super.printMessages(
      messages.map((message) => redactLogValue(message)),
      context,
      logLevel,
      writeStreamType,
      errorStack === undefined ? undefined : redactLogValue(errorStack),
    );
  }

  protected override printStackTrace(stack: string): void {
    super.printStackTrace(typeof stack === "string" ? redactSensitiveText(stack) : stack);
  }
}
