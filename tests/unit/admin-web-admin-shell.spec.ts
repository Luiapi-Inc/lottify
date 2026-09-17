// Guards for the Admin UI shell defects reported on GH #146 (kanban t_efc28fc7,
// found by qa agent card t_f4daf732):
//   D2 sidebar links pointed at unrelated routes ("Approvals" -> "/",
//      "ระบบและตั้งค่า" -> "/lottery") and the app advertised a /settings
//      section that has no route;
//   D3 three different sidebars in one authenticated app;
//   D4 no per-route document titles;
//   D5 raw Next.js 404 with no Admin chrome and no Thai copy.
//
// These specs fail on the defective code and pin the fixed behaviour.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NAVIGATION_AREAS } from "../../apps/admin-web/app/control-plane/navigation";

const appDir = resolve(__dirname, "../../apps/admin-web/app");

/** Modules that must render their content inside the one shared Admin shell. */
const SHELL_CONSUMERS = [
  "control-plane/overview.tsx",
  "lottery/workspace.tsx",
  "accounting-period-workspace.tsx",
  "approvals/approvals-view.tsx",
];

/** Admin routes and the title their layout must declare. */
const ROUTE_TITLES = [
  { layout: "layout.tsx", title: "ภาพรวม" },
  { layout: "lottery/layout.tsx", title: "ตั้งค่าหวย" },
  { layout: "accounting-periods/layout.tsx", title: "Accounting Period" },
  { layout: "approvals/layout.tsx", title: "รอการอนุมัติ" },
];

function readAppFile(relative: string): string {
  return readFileSync(join(appDir, relative), "utf8");
}

function routePageFile(href: string): string {
  if (href === "/") return join(appDir, "page.tsx");
  return join(appDir, ...href.split("/").filter(Boolean), "page.tsx");
}

describe("Admin navigation targets (D2)", () => {
  it("resolves every area marked available to a route that exists", () => {
    for (const area of NAVIGATION_AREAS) {
      if (!area.serviceExposed || !area.uiExposed) continue;
      expect(area.href, `${area.key} is marked available but carries no route`).toBeTruthy();
      expect(
        existsSync(routePageFile(area.href as string)),
        `${area.key} points at ${area.href} which has no page.tsx`,
      ).toBe(true);
    }
  });

  it("never sends a non-overview area back to the overview route", () => {
    for (const area of NAVIGATION_AREAS) {
      if (area.key === "overview") continue;
      expect(area.href, `${area.key} resolves to the overview route`).not.toBe("/");
    }
    expect(NAVIGATION_AREAS.find((area) => area.key === "approvals")?.href).toBe("/approvals");
  });

  it("does not advertise a settings section that has no route", () => {
    expect(NAVIGATION_AREAS.find((area) => area.key === "system-config")).toMatchObject({
      serviceExposed: true,
      uiExposed: false,
    });
    const settingsArea = NAVIGATION_AREAS.find((area) => area.key === "system-config");
    expect(settingsArea?.href).toBeUndefined();
    expect(existsSync(join(appDir, "settings", "page.tsx"))).toBe(false);
  });
});

describe("Single Admin shell (D3)", () => {
  it("mounts the shared shell on every Admin route", () => {
    for (const file of SHELL_CONSUMERS) {
      expect(readAppFile(file), `${file} does not use the shared AdminShell`).toContain(
        "AdminShell",
      );
    }
  });

  it("keeps route-local sidebar markup out of every route module", () => {
    for (const file of SHELL_CONSUMERS) {
      const source = readAppFile(file);
      expect(source, `${file} renders its own sidebar`).not.toMatch(/<aside[^>]*cp-sidebar/);
      expect(source, `${file} renders the lottery sidebar`).not.toContain("lot-sidebar");
      expect(source, `${file} renders the accounting sidebar`).not.toContain('className="sidebar"');
      expect(source, `${file} renders its own nav items`).not.toContain("nav-item");
    }
    // The sidebar exists in exactly one module.
    const shell = readAppFile("control-plane/shell.tsx");
    expect(shell).toContain('className="cp-sidebar"');
    expect(shell).toContain("NAVIGATION_AREAS.map");
  });
});

describe("Per-route document titles (D4)", () => {
  it("declares a distinct title for every Admin route", () => {
    const seen = new Set<string>();
    for (const { layout, title } of ROUTE_TITLES) {
      expect(readAppFile(layout), `${layout} is missing`).toContain(title);
      expect(seen.has(title), `title "${title}" is used by more than one route`).toBe(false);
      seen.add(title);
    }
    expect(seen.size).toBe(ROUTE_TITLES.length);
  });

  it("applies the Admin brand through the root title template", () => {
    const root = readAppFile("layout.tsx");
    expect(root).toContain('template: "%s · Lottify Admin"');
    expect(root).toContain('default: "ภาพรวม"');
  });
});

describe("Branded Admin 404 (D5)", () => {
  it("replaces the raw Next.js page with Thai Admin copy", () => {
    const notFound = readAppFile("not-found.tsx");
    expect(notFound).toContain("ไม่พบหน้าที่ต้องการ");
    expect(notFound).toContain("Lottify Admin");
    expect(notFound).toContain('href="/accounting-periods"');
    expect(notFound).not.toContain("This page could not be found");
  });

  it("gives the 404 its own title", () => {
    expect(readAppFile("[...catchAll]/layout.tsx")).toContain('title: "ไม่พบหน้า"');
  });
});
