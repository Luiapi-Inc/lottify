import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loginLandingTarget } from "../../apps/member-web/app/lib/login-landing";

const MEMBER_WEB_APP = join(__dirname, "..", "..", "apps", "member-web", "app");

describe("member-web post-login landing target", () => {
  it("falls back to the member home when no `next` was requested", () => {
    expect(loginLandingTarget("")).toBe("/");
    expect(loginLandingTarget("?utm_source=sms")).toBe("/");
    expect(loginLandingTarget("?next=")).toBe("/");
  });

  it("honours the guard's `next` member-area path", () => {
    expect(loginLandingTarget("?next=%2F")).toBe("/");
    expect(loginLandingTarget("?next=%2Faccount")).toBe("/account");
    expect(loginLandingTarget("?next=%2Faccount%2Fkyc")).toBe("/account/kyc");
    expect(loginLandingTarget("?next=/wallet")).toBe("/wallet");
  });

  it("refuses anything that is not an in-app absolute path (no open redirect)", () => {
    expect(loginLandingTarget("?next=//evil.example")).toBe("/");
    expect(loginLandingTarget("?next=https%3A%2F%2Fevil.example")).toBe("/");
    expect(loginLandingTarget("?next=javascript%3Aalert(1)")).toBe("/");
    expect(loginLandingTarget("?next=account")).toBe("/");
  });
});

describe("member-web login landing is a real document request (defect D1 regression)", () => {
  const source = readFileSync(join(MEMBER_WEB_APP, "login", "page.tsx"), "utf8");

  it("lands with window.location.assign, not a client-router push", () => {
    // The guard's 307 for a member area is cached in the client router for the
    // whole pre-login session; `router.push` replays it without a request and
    // leaves the member on /login even though the session cookie is set.
    expect(source).toContain("window.location.assign(loginLandingTarget(");
    expect(source).not.toContain("router.push(requested");
  });

  it("does not prefetch the guarded `/` from the auth shell", () => {
    const shell = readFileSync(join(MEMBER_WEB_APP, "components", "auth-shell.tsx"), "utf8");
    const brandLink = shell.split("\n").find((line) => line.includes('className="brand" href="/"')) ?? "";
    expect(brandLink, "auth-shell brand link must exist").not.toBe("");
    expect(brandLink, "auth-shell brand link must not prefetch the guarded /").toContain("prefetch={false}");
  });
});
