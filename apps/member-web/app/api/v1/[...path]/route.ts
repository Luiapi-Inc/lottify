import type { NextRequest } from "next/server";
import {
  API_REFRESH_COOKIE,
  WEB_SESSION_COOKIE,
  buildClearedSessionCookie,
  buildSessionCookie,
  isSecureRequest,
  omitCookie,
  readCookie,
  readRefreshCookieUpdate,
} from "../../../lib/member-session";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

async function proxy(request: NextRequest, context: RouteContext): Promise<Response> {
  const apiOrigin = process.env.LOTTIFY_API_ORIGIN ?? "http://127.0.0.1:3000";
  const { path } = await context.params;
  const upstreamUrl = new URL(`/api/v1/${path.map(encodeURIComponent).join("/")}`, apiOrigin);
  upstreamUrl.search = request.nextUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  // Session bridge: the API's own refresh cookie is `Secure` on this
  // environment while the surface is plain HTTP, so the browser never stored
  // it. Replay the web-tier cookie upstream as the API's own cookie instead,
  // and never forward the web-tier cookie itself upstream.
  const requestCookies = request.headers.get("cookie");
  const upstreamCookies = omitCookie(requestCookies, WEB_SESSION_COOKIE);
  const apiSession = readCookie(requestCookies, API_REFRESH_COOKIE);
  const webSession = readCookie(requestCookies, WEB_SESSION_COOKIE);
  const bridgedCookies = apiSession || !webSession
    ? upstreamCookies
    : [upstreamCookies, `${API_REFRESH_COOKIE}=${webSession}`].filter(Boolean).join("; ");
  if (bridgedCookies !== (requestCookies ?? "")) headers.set("cookie", bridgedCookies);

  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  const upstream = await fetch(upstreamUrl, {
    method,
    headers,
    body,
    redirect: "manual",
  });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-length");
  responseHeaders.delete("content-encoding");

  // Replace the API's own refresh cookie with the web-origin one; pass any
  // other upstream cookie through untouched.
  const setCookies =
    typeof upstream.headers.getSetCookie === "function" ? upstream.headers.getSetCookie() : [];
  responseHeaders.delete("set-cookie");
  for (const setCookie of setCookies) {
    const name = setCookie.split(";", 1)[0]?.split("=", 1)[0]?.trim();
    if (name !== API_REFRESH_COOKIE) responseHeaders.append("set-cookie", setCookie);
  }

  const update = readRefreshCookieUpdate(setCookies);
  if (update) {
    const secure = isSecureRequest({
      protocol: request.nextUrl.protocol,
      forwardedProto: request.headers.get("x-forwarded-proto"),
    });
    responseHeaders.append(
      "set-cookie",
      update.state === "cleared"
        ? buildClearedSessionCookie(secure)
        : buildSessionCookie(update.value, { secure, maxAgeSeconds: update.maxAgeSeconds }),
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
