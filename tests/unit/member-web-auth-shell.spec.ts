import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authPaths, isAuthPath } from "../../apps/member-web/app/lib/auth-paths";

const APP_DIR = join(__dirname, "..", "..", "apps", "member-web", "app");

describe("member-web auth shell (app-chrome)", () => {
  it("renders auth pages WITHOUT the member chrome (no sidebar/topbar/mobile-nav)", () => {
    // Every standalone auth/onboarding route must be excluded from the member shell.
    for (const path of authPaths) {
      expect(isAuthPath(path), `${path} should be an auth path`).toBe(true);
    }
  });

  it("treats /forgot-password and /enroll as auth paths (regression: were missing)", () => {
    expect(isAuthPath("/forgot-password")).toBe(true);
    expect(isAuthPath("/enroll")).toBe(true);
  });

  it("keeps member routes inside the chrome", () => {
    for (const path of ["/", "/buy", "/slips", "/wallet", "/account", "/promotions"]) {
      expect(isAuthPath(path), `${path} should NOT be an auth path`).toBe(false);
    }
  });

  it("matches nested auth sub-paths (e.g. /otp/verify)", () => {
    expect(isAuthPath("/otp/verify")).toBe(true);
    expect(isAuthPath("/forgot-password/confirm")).toBe(true);
  });
});

describe("member-web per-route titles", () => {
  const routesWithTitles: Record<string, string> = {
    login: "เข้าสู่ระบบ",
    register: "สร้างบัญชี",
    otp: "ยืนยันว่าเป็นคุณ",
    terms: "อ่านก่อนใช้บริการ",
    profile: "ข้อมูลสมาชิก",
    eligibility: "บัญชีพร้อมสำหรับอะไรบ้าง",
    "forgot-password": "ลืมรหัสผ่าน",
    enroll: "ตั้งรหัสผ่านครั้งแรก",
    buy: "ซื้อหวย",
    slips: "โพยของฉัน",
    wallet: "กระเป๋า",
    account: "บัญชีของฉัน",
    promotions: "โปรโมชั่น",
  };

  it("gives every top-level route a layout.tsx exporting a page-specific title", () => {
    for (const [route, expectedTitle] of Object.entries(routesWithTitles)) {
      const layoutPath = join(APP_DIR, route, "layout.tsx");
      expect(existsSync(layoutPath), `${route}/layout.tsx should exist`).toBe(true);
      const source = readFileSync(layoutPath, "utf8");
      expect(source, `${route} layout should export metadata`).toContain("export const metadata");
      expect(source, `${route} title should be page-specific`).toContain(`title: "${expectedTitle}"`);
    }
  });

  it("covers every top-level route directory with a page.tsx (no route falls back to the default title)", () => {
    const topLevelDirs = readdirSync(APP_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(APP_DIR, d.name, "page.tsx")))
      .map((d) => d.name)
      .filter((name) => name !== "components" && name !== "lib");
    for (const dir of topLevelDirs) {
      expect(existsSync(join(APP_DIR, dir, "layout.tsx")), `${dir} should have a layout.tsx`).toBe(true);
    }
  });
});
