"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { MobileNavigation, Navigation } from "./navigation";
import { Topbar } from "./topbar";

const authPaths = ["/login", "/register", "/otp", "/terms", "/profile", "/eligibility"];

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAuth = authPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  if (isAuth) return <>{children}</>;

  return <>
    <a className="skip-link" href="#main">ข้ามไปเนื้อหา</a>
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Lottify หน้าแรก"><span className="brand-mark">L</span><span>Lottify</span><small>Member</small></Link>
        <Navigation />
        <Link className="sidebar-promo" href="/promotions"><strong>สิทธิ์โบนัสของคุณ</strong><span>ดูเงื่อนไขและความคืบหน้ายอดเล่น</span></Link>
        <div className="sidebar-foot">Lottify Member</div>
      </aside>
      <div className="workspace"><Topbar />{children}</div>
    </div>
    <MobileNavigation />
  </>;
}
