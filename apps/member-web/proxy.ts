import { NextResponse, type NextRequest } from "next/server";
import {
  WEB_SESSION_COOKIE,
  isMemberAreaPath,
  loginRedirectFor,
} from "./app/lib/member-session";

/**
 * Session guard for the member areas.
 *
 * Next 16 renamed the `middleware` file convention to `proxy` (same API, Node
 * runtime); this is the only server-side gate that runs before a member page
 * is rendered. A visitor without the web session cookie never reaches `/`,
 * `/buy`, `/slips`, `/wallet`, `/account`, `/promotions` — the member chrome
 * (member chip, logout control, wallet tiles) is no longer rendered for a
 * logged-out visitor as though it were a logged-in one.
 *
 * This only checks that a session cookie is *present*; pages that render member
 * data still verify it against the API, which is the authority on whether the
 * session is still valid.
 */
export default function proxy(request: NextRequest) {
  if (request.cookies.get(WEB_SESSION_COOKIE)?.value) return NextResponse.next();
  if (!isMemberAreaPath(request.nextUrl.pathname)) return NextResponse.next();
  return NextResponse.redirect(
    new URL(loginRedirectFor(request.nextUrl.pathname, request.nextUrl.search), request.nextUrl.origin),
  );
}

export const config = {
  matcher: ["/", "/buy/:path*", "/slips/:path*", "/wallet/:path*", "/account/:path*", "/promotions/:path*"],
};
