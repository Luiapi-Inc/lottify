import { afterEach, describe, expect, it, vi } from "vitest";
import { MemberApiFailure, memberApi, normalizePhone } from "../../apps/member-web/app/lib/member-api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Member auth client contract (CR #141)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    memberApi.clearSession();
  });

  it("normalizes a local-format phone before every auth request", () => {
    expect(normalizePhone("081-234-5678")).toBe("0812345678");
    expect(normalizePhone("081 234 5678")).toBe("0812345678");
    expect(normalizePhone("66812345678")).toBe("66812345678");
    expect(normalizePhone("08-1 234-56-78")).toBe("0812345678");
  });

  it("POSTs phone + password to auth/login and accepts the issued session", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ accessToken: "login-access", memberId: "m-1", deviceId: "d-1" }),
    );
    await memberApi.login("081-234-5678", "correct-horse-battery");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/member/auth/login");
    expect(init?.method).toBe("POST");
    expect(JSON.parse((init?.body as string) ?? "{}")).toMatchObject({
      phone: "0812345678",
      password: "correct-horse-battery",
      deviceName: "Lottify Member Web",
    });

    // The issued token is used directly on the next authenticated call (no refresh).
    fetchMock.mockResolvedValue(jsonResponse({ memberId: "m-1" }));
    await memberApi.getProfile();
    const protectedCall = fetchMock.mock.calls[1] ?? [];
    expect(protectedCall[0]).toBe("/api/v1/member/profile");
    expect((protectedCall[1]?.headers as Record<string, string>)?.Authorization).toBe("Bearer login-access");
  });

  it("REGISTER verify posts the password and accepts the session", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ purpose: "REGISTER", accessToken: "register-access", memberId: "m-1", accountCreated: true, deviceId: "d-1" }),
    );
    await memberApi.verifyOtp("REGISTER", "0812345678", "123456", "register-password-1");
    const registerCall = fetchMock.mock.calls[0] ?? [];
    expect(registerCall[0]).toBe("/api/v1/member/auth/otp/verify");
    expect(JSON.parse((registerCall[1]?.body as string) ?? "{}")).toMatchObject({
      purpose: "REGISTER",
      code: "123456",
      password: "register-password-1",
    });

    // The issued token is used directly on the next authenticated call (no refresh).
    fetchMock.mockResolvedValue(jsonResponse({ memberId: "m-1" }));
    await memberApi.getProfile();
    const profileCall = fetchMock.mock.calls[1] ?? [];
    expect(profileCall[0]).toBe("/api/v1/member/profile");
    expect((profileCall[1]?.headers as Record<string, string>)?.Authorization).toBe("Bearer register-access");
  });

  it("PASSWORD_ENROLL verify sets no session; the Member must refresh or log in afterwards", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ purpose: "PASSWORD_ENROLL", memberId: "m-2", passwordSet: true, passwordUpdatedAt: "2026-09-17T00:00:00Z" }),
    );
    await memberApi.verifyOtp("PASSWORD_ENROLL", "0812345678", "654321", "enroll-password-1");
    const enrollCall = fetchMock.mock.calls[0] ?? [];
    expect(enrollCall[0]).toBe("/api/v1/member/auth/otp/verify");
    expect(JSON.parse((enrollCall[1]?.body as string) ?? "{}")).toMatchObject({ purpose: "PASSWORD_ENROLL" });
    // No session was accepted: the next authenticated call must refresh first.
    fetchMock.mockResolvedValue(jsonResponse({ accessToken: "refreshed" }));
    await memberApi.getProfile();
    const refreshCall = fetchMock.mock.calls[1] ?? [];
    expect(refreshCall[0]).toBe("/api/v1/member/auth/refresh");
  });

  it("requests a RECOVERY OTP and resets the password through the reset endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ purpose: "RECOVERY", deliveredTo: "0812345678", retryAfterSeconds: null }),
    );
    await memberApi.requestRecoveryOtp("081 234 5678");
    const requestCall = fetchMock.mock.calls[0] ?? [];
    expect(requestCall[0]).toBe("/api/v1/member/auth/recovery/otp/request");
    expect(JSON.parse((requestCall[1]?.body as string) ?? "{}")).toMatchObject({ phone: "0812345678" });

    fetchMock.mockResolvedValue(
      jsonResponse({ purpose: "RECOVERY", memberId: "m-1", passwordReset: true, passwordUpdatedAt: "2026-09-17T00:00:00Z" }),
    );
    await memberApi.resetPassword("0812345678", "112233", "reset-password-1");
    const resetCall = fetchMock.mock.calls[1] ?? [];
    expect(resetCall[0]).toBe("/api/v1/member/auth/password/reset");
    expect(JSON.parse((resetCall[1]?.body as string) ?? "{}")).toMatchObject({
      phone: "0812345678",
      code: "112233",
      password: "reset-password-1",
    });
  });

  it("surfaces actionable `details` on a locked-credential failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          code: "MEMBER_LOGIN_LOCKED",
          message: "Too many failed login attempts. Try again later.",
          details: { retryAfterSeconds: 42 },
        },
        401,
      ),
    );
    const failure = await memberApi.login("0812345678", "whatever").catch((error) => error);
    expect(failure).toBeInstanceOf(MemberApiFailure);
    expect((failure as MemberApiFailure).code).toBe("MEMBER_LOGIN_LOCKED");
    expect((failure as MemberApiFailure).status).toBe(401);
    expect((failure as MemberApiFailure).details?.retryAfterSeconds).toBe(42);
  });
});
