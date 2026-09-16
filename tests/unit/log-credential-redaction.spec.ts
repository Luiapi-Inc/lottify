import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ConsoleLogger } from "@nestjs/common";
import express from "express";
import pinoHttp from "pino-http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HTTP_ACCESS_LOG_REDACT_PATHS,
  REDACTED_VALUE,
  RedactingConsoleLogger,
  createHttpAccessLogger,
  httpAccessLoggerOptions,
  redactSensitiveText,
} from "../../src/platform/observability/log-redaction";

/**
 * Ticket 13 security release gate: "sensitive logs do not leak credentials,
 * tokens, secrets, or protected PII". The regression assertions below drive a
 * real HTTP request through the same access-logger factory the API installs in
 * `apps/api/src/main.ts` and through the same console logger the API and worker
 * bootstraps install, then assert the emitted records never contain the
 * supplied credential values.
 */

const ACCESS_TOKEN = "access-token-7c1f4a9e2b-ticket13-never-logged";
const REFRESH_TOKEN = "refresh-token-2d8b5e0a31-ticket13-never-logged";
const API_KEY = "api-key-9a4c6f2e80-ticket13-never-logged";
const OTP_CODE = "otp-4h7k2m-ticket13-never-logged";
const MEMBER_PHONE = "+66891234567";

interface CapturedAccessLog {
  records: string[];
  close(): Promise<void>;
  baseUrl: string;
}

function createCapturingStream(): { stream: { write: (chunk: string) => boolean }; records: string[] } {
  const records: string[] = [];
  return {
    records,
    stream: {
      write: (chunk: string): boolean => {
        records.push(chunk);
        return true;
      },
    },
  };
}

/**
 * Boots a real express app that installs the production access logger
 * (`createHttpAccessLogger`) with a capturing destination, plus a route that
 * both consumes credentials and returns a `Set-Cookie` carrying the refresh
 * token.
 */
async function startAccessLoggedApi(): Promise<CapturedAccessLog> {
  const captured = createCapturingStream();
  const app = express();
  app.use(createHttpAccessLogger("info", captured.stream));
  app.get("/api/v1/member/session", (_request, response) => {
    response.setHeader(
      "set-cookie",
      `lottify_refresh=${REFRESH_TOKEN}; HttpOnly; Path=/; SameSite=Strict`,
    );
    response.status(200).json({ authenticated: true });
  });

  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address() as AddressInfo;

  return {
    records: captured.records,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined || error === null ? resolve() : reject(error)));
      }),
  };
}

async function waitForAccessLogRecords(records: string[]): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (records.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const runningApis: CapturedAccessLog[] = [];

afterEach(async () => {
  while (runningApis.length > 0) {
    await runningApis.pop()?.close();
  }
  vi.restoreAllMocks();
});

describe("credential redaction in operational logs (Ticket 13)", () => {
  it("omits access-token, refresh-cookie, api-key and OTP values from the access log of an authenticated request", async () => {
    const api = await startAccessLoggedApi();
    runningApis.push(api);

    const response = await fetch(`${api.baseUrl}/api/v1/member/session`, {
      headers: {
        authorization: `Bearer ${ACCESS_TOKEN}`,
        cookie: `lottify_refresh=${REFRESH_TOKEN}`,
        "x-api-key": API_KEY,
        "x-otp-code": OTP_CODE,
      },
    });
    expect(response.status).toBe(200);
    await response.text();

    await waitForAccessLogRecords(api.records);

    const accessLog = api.records.join("\n");
    // The access logger must still be operational, not silenced.
    expect(accessLog).toContain("request completed");
    expect(accessLog).toContain("/api/v1/member/session");

    for (const secret of [ACCESS_TOKEN, REFRESH_TOKEN, API_KEY, OTP_CODE]) {
      expect(accessLog).not.toContain(secret);
    }
    expect(accessLog).toContain(REDACTED_VALUE);
  });

  /**
   * Control: proves the assertions above are meaningful — the same request
   * through an unconfigured `pinoHttp` (the pre-fix configuration) does emit the
   * raw credential values into the access-log record.
   */
  it("control: an unredacted pino-http access logger does emit the raw token (detects the pre-fix defect)", async () => {
    const captured = createCapturingStream();
    const app = express();
    app.use(pinoHttp({ level: "info" }, captured.stream));
    app.get("/api/v1/member/session", (_request, response) => {
      response.status(200).json({ authenticated: true });
    });
    const server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const address = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/member/session`, {
        headers: {
          authorization: `Bearer ${ACCESS_TOKEN}`,
          cookie: `lottify_refresh=${REFRESH_TOKEN}`,
        },
      });
      expect(response.status).toBe(200);
      await response.text();
      await waitForAccessLogRecords(captured.records);

      const accessLog = captured.records.join("\n");
      expect(accessLog).toContain(ACCESS_TOKEN);
      expect(accessLog).toContain(REFRESH_TOKEN);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined || error === null ? resolve() : reject(error)));
      });
    }
  });

  it("redacts the credential header paths required by the release gate", () => {
    for (const path of [
      'req.headers["authorization"]',
      'req.headers["cookie"]',
      'req.headers["set-cookie"]',
      'res.headers["set-cookie"]',
      'req.headers["x-api-key"]',
      'req.headers["x-otp-code"]',
    ]) {
      expect(HTTP_ACCESS_LOG_REDACT_PATHS).toContain(path);
    }

    const options = httpAccessLoggerOptions("info");
    expect(options.redact).toMatchObject({ censor: REDACTED_VALUE });
  });

  it("strips bearer tokens, basic credentials and refresh cookies from free-text and stack values", () => {
    const redacted = redactSensitiveText(
      `Authorization: Bearer ${ACCESS_TOKEN}\nCookie: lottify_refresh=${REFRESH_TOKEN}`,
    );

    expect(redacted).not.toContain(ACCESS_TOKEN);
    expect(redacted).not.toContain(REFRESH_TOKEN);
    expect(redacted).toContain(REDACTED_VALUE);
  });

  it("redacts credentials, OTP codes and phone identities from console logger output", () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown): boolean => {
      writes.push(String(chunk));
      return true;
    });

    const logger = new RedactingConsoleLogger({ json: true });
    logger.log({
      event: "session_refresh",
      authorization: `Bearer ${ACCESS_TOKEN}`,
      cookie: `lottify_refresh=${REFRESH_TOKEN}`,
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      otpCode: OTP_CODE,
      phone: MEMBER_PHONE,
      member: { phoneNumber: MEMBER_PHONE, memberId: "member-1" },
      note: `delivered to ${MEMBER_PHONE}`,
    });

    const output = writes.join("");
    expect(output).not.toBe("");
    // Non-sensitive operational fields must survive redaction.
    expect(output).toContain("session_refresh");
    expect(output).toContain("member-1");

    for (const secret of [ACCESS_TOKEN, REFRESH_TOKEN, OTP_CODE, MEMBER_PHONE]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain(REDACTED_VALUE);
  });

  it("redacts credentials carried in an error stack", () => {
    const writes: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown): boolean => {
      writes.push(String(chunk));
      return true;
    });

    const logger = new RedactingConsoleLogger({ json: true });
    logger.error(`refresh rejected for lottify_refresh=${REFRESH_TOKEN}`, {
      authorization: `Bearer ${ACCESS_TOKEN}`,
    });

    const output = writes.join("");
    expect(output).not.toContain(ACCESS_TOKEN);
    expect(output).not.toContain(REFRESH_TOKEN);
  });

  it("keeps the redacting console logger API-compatible with the logger it replaces", () => {
    expect(new RedactingConsoleLogger({ json: true })).toBeInstanceOf(ConsoleLogger);
  });
});
