import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_REFRESH_COOKIE,
  WEB_SESSION_COOKIE,
  buildClearedSessionCookie,
  buildSessionCookie,
  isMemberAreaPath,
  isSecureRequest,
  loginRedirectFor,
  readCookie,
  readRefreshCookieUpdate,
} from "../../apps/member-web/app/lib/member-session";
import { POST as proxyMemberRequest } from "../../apps/member-web/app/api/v1/[...path]/route";

describe("member-web session cookie contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("marks the web session cookie Secure only when the request itself is https", () => {
    expect(isSecureRequest({ protocol: "http:" })).toBe(false);
    expect(isSecureRequest({ protocol: "https:" })).toBe(true);
    expect(isSecureRequest({ protocol: "http:", forwardedProto: "https" })).toBe(true);
    expect(isSecureRequest({ protocol: "https:", forwardedProto: "http" })).toBe(false);
    expect(isSecureRequest({ forwardedProto: "https, http" })).toBe(true);
  });

  it("reads a single cookie value out of a raw Cookie header", () => {
    expect(readCookie(`${WEB_SESSION_COOKIE}=abc; other=1`, WEB_SESSION_COOKIE)).toBe("abc");
    expect(readCookie("other=1", WEB_SESSION_COOKIE)).toBeNull();
    expect(readCookie(null, WEB_SESSION_COOKIE)).toBeNull();
    expect(readCookie(`${WEB_SESSION_COOKIE}=`, WEB_SESSION_COOKIE)).toBeNull();
  });

  it("turns an API Set-Cookie into a session cookie without the API's Secure flag on http", () => {
    const header = buildSessionCookie("token-1", { secure: false, maxAgeSeconds: 60 });
    expect(header).toBe(`${WEB_SESSION_COOKIE}=token-1; Path=/; HttpOnly; SameSite=Lax; Max-Age=60`);
    expect(header).not.toContain("Secure");
    expect(buildSessionCookie("token-1", { secure: true, maxAgeSeconds: null })).toContain("; Secure");
    expect(buildClearedSessionCookie(false)).toContain("Max-Age=0");
    expect(buildClearedSessionCookie(false)).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  });

  it("interprets the API refresh cookie's set/clear/absent states", () => {
    expect(readRefreshCookieUpdate([])).toBeNull();
    expect(readRefreshCookieUpdate(["other=1; Path=/"])).toBeNull();
    expect(readRefreshCookieUpdate([`${API_REFRESH_COOKIE}=abc; Max-Age=3600; Path=/api/v1/member`])).toEqual({
      state: "set",
      value: "abc",
      maxAgeSeconds: 3600,
    });
    expect(readRefreshCookieUpdate([`${API_REFRESH_COOKIE}=abc`])).toEqual({
      state: "set",
      value: "abc",
      maxAgeSeconds: null,
    });
    expect(readRefreshCookieUpdate([`${API_REFRESH_COOKIE}=; Max-Age=0`])).toEqual({ state: "cleared" });
    expect(
      readRefreshCookieUpdate([`${API_REFRESH_COOKIE}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT`]),
    ).toEqual({ state: "cleared" });
  });

  it("guards the member areas but keeps the onboarding routes public", () => {
    for (const path of ["/", "/buy", "/buy/bet", "/slips", "/wallet/deposit", "/account", "/account/security", "/promotions"]) {
      expect(isMemberAreaPath(path)).toBe(true);
    }
    for (const path of ["/login", "/register", "/otp", "/enroll", "/forgot-password", "/terms", "/profile", "/eligibility"]) {
      expect(isMemberAreaPath(path)).toBe(false);
    }
    expect(loginRedirectFor("/account", "")).toBe("/login?next=%2Faccount");
    expect(loginRedirectFor("/wallet", "?tab=deposits")).toBe("/login?next=%2Fwallet%3Ftab%3Ddeposits");
  });
});

interface FakeRequest {
  method: string;
  headers: Headers;
  nextUrl: { search: string; protocol: string };
  arrayBuffer: () => Promise<ArrayBuffer>;
}

function fakeRequest(init: { method: string; cookie?: string; search?: string }): FakeRequest {
  const headers = new Headers(init.cookie ? { cookie: init.cookie } : {});
  return {
    method: init.method,
    headers,
    nextUrl: { search: init.search ?? "", protocol: "http:" },
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

async function callProxy(request: FakeRequest, path: string[]): Promise<{ response: Response; upstreamHeaders?: Headers }> {
  let upstreamHeaders: Headers | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: URL, init: RequestInit) => {
      upstreamHeaders = new Headers(init.headers as HeadersInit);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": `${API_REFRESH_COOKIE}=token-1; Path=/api/v1/member; HttpOnly; SameSite=Lax; Secure; Max-Age=3600`,
        },
      });
    }),
  );
  const response = await proxyMemberRequest(request as never, { params: Promise.resolve({ path }) });
  return { response, upstreamHeaders };
}

describe("member-web API proxy session bridge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("stores the API refresh credential as a web-origin session cookie (no Secure over http)", async () => {
    const { response } = await callProxy(fakeRequest({ method: "POST" }), ["member", "auth", "login"]);

    const setCookie = response.headers.getSetCookie();
    expect(setCookie).toHaveLength(1);
    expect(setCookie[0]).toContain(`${WEB_SESSION_COOKIE}=token-1`);
    expect(setCookie[0]).toContain("HttpOnly");
    expect(setCookie[0]).not.toContain("Secure");
    expect(response.headers.get("set-cookie")).not.toContain(API_REFRESH_COOKIE);
  });

  it("replays the web session cookie upstream as the API's own cookie after a reload", async () => {
    const { upstreamHeaders } = await callProxy(
      fakeRequest({ method: "GET", cookie: `${WEB_SESSION_COOKIE}=token-1` }),
      ["member", "auth", "me"],
    );

    expect(upstreamHeaders?.get("cookie")).toBe(`${API_REFRESH_COOKIE}=token-1`);
  });

  it("keeps an already-present API cookie and passes unrelated cookies through", async () => {
    const { upstreamHeaders, response } = await callProxy(
      fakeRequest({ method: "GET", cookie: `${WEB_SESSION_COOKIE}=stale; ${API_REFRESH_COOKIE}=fresh; locale=th` }),
      ["member", "auth", "me"],
    );

    // The API's own cookie wins; the web-tier cookie never leaves the web tier.
    expect(upstreamHeaders?.get("cookie")).toBe(`${API_REFRESH_COOKIE}=fresh; locale=th`);
    expect(response.headers.getSetCookie()[0]).toContain(`${WEB_SESSION_COOKIE}=token-1`);
  });
});
