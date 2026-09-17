/**
 * Routes that render WITHOUT the member app chrome (sidebar/topbar/mobile-nav).
 * These are the standalone auth/onboarding pages that render their own <AuthShell>.
 * Keep this list in sync with the route directories under apps/member-web/app.
 */
export const authPaths = [
  "/login",
  "/register",
  "/otp",
  "/terms",
  "/profile",
  "/eligibility",
  "/forgot-password",
  "/enroll",
];

export function isAuthPath(pathname: string): boolean {
  return authPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
