import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { AdminCapabilityGuard } from "../../apps/api/src/admin-capability.guard";
import type { AdminRequestContext } from "../../src/contexts/identity-access/application/admin-auth.service";

function executionContext(adminAuth?: AdminRequestContext) {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ adminAuth }) }),
  } as never;
}

const admin: AdminRequestContext = {
  adminId: "admin-1",
  sessionId: "session-1",
  email: "admin@example.com",
  name: "Admin",
  role: "ADMIN",
  capabilities: ["accounting-period.read"],
  mfaVerifiedAt: new Date(),
};

describe("AdminCapabilityGuard", () => {
  it("allows a server-derived capability required by the route", () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, "getAllAndOverride").mockReturnValue([
      "accounting-period.read",
    ]);
    const guard = new AdminCapabilityGuard(reflector);

    expect(guard.canActivate(executionContext(admin))).toBe(true);
  });

  it("rejects an authenticated Admin whose server context lacks the capability", () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, "getAllAndOverride").mockReturnValue([
      "accounting-period.read",
    ]);
    const guard = new AdminCapabilityGuard(reflector);

    expect(() =>
      guard.canActivate(
        executionContext({ ...admin, capabilities: [] }),
      ),
    ).toThrow(ForbiddenException);
  });

  it("rejects capability checks without an authenticated Admin context", () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, "getAllAndOverride").mockReturnValue([
      "accounting-period.read",
    ]);
    const guard = new AdminCapabilityGuard(reflector);

    expect(() => guard.canActivate(executionContext())).toThrow(
      UnauthorizedException,
    );
  });
});
