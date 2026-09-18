/**
 * Post-login landing contract (member-web).
 *
 * What happened without it: `apps/member-web/app/login/page.tsx` landed the
 * member with `router.push(target)`, i.e. a CLIENT navigation. The session guard
 * (`apps/member-web/proxy.ts`) answers a logged-out request for a member area
 * with a `307` to `/login?next=…`, and the auth shell's brand link prefetches
 * the guarded `/`. The Next client router cache therefore holds that redirect
 * for `/` for the whole pre-login session, and the post-login `push("/")`
 * replayed it — no request on the wire, the freshly issued session cookie never
 * consulted, and the member stayed on `/login?next=%2F` (defect D1, candidate
 * `84df852c`).
 */

/**
 * Where a successful login must land, resolved from the current query string.
 *
 * Only an in-app absolute path is accepted: anything else (a protocol-relative
 * `//host`, an absolute URL, a missing/empty value) falls back to the member
 * home. This is the open-redirect guard, kept as a pure function so it is
 * testable without a browser.
 */
export function loginLandingTarget(search: string): string {
  const requested = new URLSearchParams(search).get("next");
  return requested && requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";
}
