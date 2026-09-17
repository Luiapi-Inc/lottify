import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpsAuthGuard } from "../../apps/api/src/ops-auth.guard";
import { resetEnvironmentForTests } from "../../src/platform/config/env";

function makeContext(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;
}

describe("OpsAuthGuard (W5-F4 ops surface auth)", () => {
  const original = process.env.OPS_AUTH_TOKEN;

  beforeEach(() => {
    process.env.OPS_AUTH_TOKEN = "";
    resetEnvironmentForTests();
  });

  afterEach(() => {
    process.env.OPS_AUTH_TOKEN = original;
    resetEnvironmentForTests();
  });

  it("allows requests when no token is configured (dev/test)", () => {
    const guard = new OpsAuthGuard();
    expect(guard.canActivate(makeContext())).toBe(true);
  });

  it("rejects requests without the bearer token when a token is configured", () => {
    process.env.OPS_AUTH_TOKEN = "s3cret";
    resetEnvironmentForTests();
    const guard = new OpsAuthGuard();
    expect(() => guard.canActivate(makeContext())).toThrow(UnauthorizedException);
  });

  it("rejects requests with a wrong token", () => {
    process.env.OPS_AUTH_TOKEN = "s3cret";
    resetEnvironmentForTests();
    const guard = new OpsAuthGuard();
    expect(() => guard.canActivate(makeContext("Bearer wrong"))).toThrow(UnauthorizedException);
  });

  it("allows requests with the correct bearer token", () => {
    process.env.OPS_AUTH_TOKEN = "s3cret";
    resetEnvironmentForTests();
    const guard = new OpsAuthGuard();
    expect(guard.canActivate(makeContext("Bearer s3cret"))).toBe(true);
  });
});
