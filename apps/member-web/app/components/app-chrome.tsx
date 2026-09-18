"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { MobileNavigation, Navigation } from "./navigation";
import { Topbar } from "./topbar";
import { isAuthPath } from "../lib/auth-paths";

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAuth = isAuthPath(pathname);

  if (isAuth) return <>{children}</>;

  return <>
    <a className="skip-link" href="#main">ข้ามไปเนื้อหา</a>
    <div className="member-shell">
      <Topbar />
      <div className="member-canvas">{children}</div>
      <div className="desktop-dock" aria-label="เมนูหลักเดสก์ท็อป"><Navigation /></div>
    </div>
    <MobileNavigation />
  </>;
}
