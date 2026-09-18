"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { MobileNavigation, Navigation } from "./navigation";
import { Topbar } from "./topbar";
import { isAuthPath } from "../lib/auth-paths";

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (isAuthPath(pathname)) return <>{children}</>;

  return <>
    <a className="skip-link" href="#main">ข้ามไปเนื้อหา</a>
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Lottify หน้าแรก">
          <span className="brand-mark">L</span>
          <span className="brand-copy"><strong>Lottify</strong><small>MEMBER</small></span>
        </Link>
        <Navigation />
        <Link className="sidebar-promo" href="/promotions">
          <span>สิทธิ์และโบนัส</span>
          <strong>ดูโปรโมชั่นที่ใช้ได้ →</strong>
        </Link>
        <div className="sidebar-foot"><span className="live-dot" /> เชื่อมต่อ API จริง</div>
      </aside>
      <div className="workspace">
        <Topbar />
        <div className="workspace-body">{children}</div>
      </div>
    </div>
    <MobileNavigation />
  </>;
}
