import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { MemberAuthGuard } from "../../apps/api/src/member-auth.guard";
import type { SessionService } from "../../src/contexts/identity-access/application/session.service";

function executionContext(header?: string) {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: () => ({ header: (name: string) => (name === "authorization" ? header : undefined) }),
    }),
  } as never;
}

/** SessionService stub: authenticateAccess throws the given error. */
function sessionsStub(authenticateAccess: (...args: unknown[]) => Promise<never>) {
  return { authenticateAccess } as unknown as SessionService;
}

describe("MemberAuthGuard", () => {
  it("collapses non-capability authentication failures to AUTHENTICATION_REQUIRED", async () => {
    const guard = new MemberAuthGuard(
      sessionsStub(() =>
        Promise.reject(new UnauthorizedException("Member session expired or revoked")),
      ),
    );

    await expect(
      guard.canActivate(executionContext("Bearer abc.def.ghi")),
    ).rejects.toMatchObject({ response: { code: "AUTHENTICATION_REQUIRED" } });
  });

  it("preserves a CAPABILITY_BLOCKED denial from the session engine", async () => {
    const guard = new MemberAuthGuard(
      sessionsStub(() =>
        Promise.reject(
          new UnauthorizedException({
            code: "CAPABILITY_BLOCKED",
            message: "This Member is not permitted to use their session",
            details: {},
          }),
        ),
      ),
    );

    await expect(
      guard.canActivate(executionContext("Bearer abc.def.ghi")),
    ).rejects.toMatchObject({ response: { code: "CAPABILITY_BLOCKED" } });
  });

  it("preserves a SELF_EXCLUSION denial from the session engine", async () => {
    const guard = new MemberAuthGuard(
      sessionsStub(() =>
        Promise.reject(
          new UnauthorizedException({
            code: "SELF_EXCLUSION",
            message: "This Member is not permitted to use their session",
            details: {},
          }),
        ),
      ),
    );

    await expect(
      guard.canActivate(executionContext("Bearer abc.def.ghi")),
    ).rejects.toMatchObject({ response: { code: "SELF_EXCLUSION" } });
  });

  it("requires a Bearer authorization header", async () => {
    const guard = new MemberAuthGuard(
      sessionsStub(() => Promise.reject(new Error("unreachable"))),
    );

    await expect(guard.canActivate(executionContext())).rejects.toMatchObject({
      response: { code: "AUTHENTICATION_REQUIRED" },
    });
  });
});
