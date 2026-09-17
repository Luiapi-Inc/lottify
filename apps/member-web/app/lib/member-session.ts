/**
 * Web-tier Member session contract (member-web).
 *
 * Why this exists: the API issues its refresh credential as an httpOnly cookie
 * (`member-auth.controller.ts` -> `setRefreshCookie`), and marks it `Secure`
 * whenever `APP_ENV` is `staging`/`production`. This surface is served over
 * plain HTTP (`http://<host>:3003`), and browsers refuse to store a `Secure`
 * cookie that arrives over an insecure origin — so the API cookie never reaches
 * the browser, the client's in-memory access token dies on the first
 * navigation, and `/`+`/account` fall back to static placeholder data.
 *
 * The web tier therefore keeps its own httpOnly cookie on the web origin
 * (`lottify_member_session`), whose `Secure` attribute follows the scheme of
 * the request that produced it, and replays the value to the API as the API's
 * own cookie (`lottify_member_refresh`) on every proxied request. The API
 * session/token contract is untouched — one writer on the auth boundary.
 */

/** The cookie name the API sets and reads (`member-auth.controller.ts`). */
export const API_REFRESH_COOKIE = "lottify_member_refresh";

/** The cookie the web tier stores for the browser (httpOnly, web origin). */
export const WEB_SESSION_COOKIE = "lottify_member_session";

/** Login landing page used by the route guard. */
export const LOGIN_PATH = "/login";

export interface RequestScheme {
  /** `request.nextUrl.protocol` — `"https:"` on a TLS listener. */
  protocol?: string | null;
  /** `x-forwarded-proto`, set by a TLS terminator in front of the app. */
  forwardedProto?: string | null;
}

/**
 * Decide whether the web session cookie must be `Secure`. Derived from the
 * request the browser actually made, never from the app environment: marking a
 * cookie `Secure` on an http surface silently drops it (this defect).
 */
export function isSecureRequest(scheme: RequestScheme): boolean {
  const forwarded = scheme.forwardedProto?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  return scheme.protocol?.toLowerCase() === "https:";
}

/** Read one cookie value out of a raw `Cookie` request header. */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    if (entry.slice(0, separator).trim() !== name) continue;
    const value = entry.slice(separator + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

/** Drop one cookie from a raw `Cookie` header value. */
export function omitCookie(cookieHeader: string | null | undefined, name: string): string {
  if (!cookieHeader) return "";
  return cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => {
      if (!entry) return false;
      const separator = entry.indexOf("=");
      return (separator < 0 ? entry : entry.slice(0, separator).trim()) !== name;
    })
    .join("; ");
}

export type RefreshCookieUpdate =
  | { state: "set"; value: string; maxAgeSeconds: number | null }
  | { state: "cleared" };

/**
 * Extract what an API response said about the refresh cookie.
 *
 * `null` means the response said nothing about it (leave the browser session
 * alone); `cleared` covers both logout (`Expires` in the past) and an explicit
 * `Max-Age=0`. This is the only place the upstream `Set-Cookie` semantics are
 * interpreted.
 */
export function readRefreshCookieUpdate(setCookieHeaders: readonly string[]): RefreshCookieUpdate | null {
  for (const header of setCookieHeaders) {
    const [pair = "", ...attributes] = header.split(";");
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() !== API_REFRESH_COOKIE) continue;

    const value = pair.slice(separator + 1).trim();
    const maxAge = attributes
      .map((attribute) => attribute.trim())
      .find((attribute) => attribute.toLowerCase().startsWith("max-age="));
    const maxAgeSeconds = maxAge ? Number.parseInt(maxAge.slice("max-age=".length), 10) : Number.NaN;
    const expires = attributes
      .map((attribute) => attribute.trim())
      .find((attribute) => attribute.toLowerCase().startsWith("expires="));
    const expiresAt = expires ? Date.parse(expires.slice("expires=".length)) : Number.NaN;

    if (value.length === 0) return { state: "cleared" };
    if (Number.isFinite(maxAgeSeconds) && maxAgeSeconds <= 0) return { state: "cleared" };
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return { state: "cleared" };
    return {
      state: "set",
      value,
      maxAgeSeconds: Number.isFinite(maxAgeSeconds) ? maxAgeSeconds : null,
    };
  }
  return null;
}

/** Serialize the web session cookie the browser stores. */
export function buildSessionCookie(
  value: string,
  options: { secure: boolean; maxAgeSeconds: number | null },
): string {
  const parts = [
    `${WEB_SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (options.secure) parts.push("Secure");
  if (options.maxAgeSeconds !== null) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  return parts.join("; ");
}

/** Serialize the deletion of the web session cookie. */
export function buildClearedSessionCookie(secure: boolean): string {
  const parts = [`${WEB_SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (secure) parts.push("Secure");
  parts.push("Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  return parts.join("; ");
}

/**
 * Member-only areas of the app: every route that renders the member chrome
 * (sidebar / topbar / member chip). Onboarding + credential routes
 * (`/login`, `/register`, `/otp`, `/enroll`, `/forgot-password`, `/terms`,
 * `/profile`, `/eligibility`) render their own shell and stay public.
 */
export const MEMBER_AREA_PREFIXES = ["/buy", "/slips", "/wallet", "/account", "/promotions"] as const;

export function isMemberAreaPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return MEMBER_AREA_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Where an unauthenticated visitor asking for a member area is sent. */
export function loginRedirectFor(pathname: string, search: string): string {
  const target = `${pathname}${search}`;
  return `${LOGIN_PATH}?next=${encodeURIComponent(target)}`;
}
