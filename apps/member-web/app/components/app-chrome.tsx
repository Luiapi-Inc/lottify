"use client";

import type { ReactNode } from "react";
import { MobileNavigation, Navigation } from "./navigation";
import { Topbar } from "./topbar";
import { isAuthPath } from "../lib/auth-paths";

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathnameSafe();
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

function usePathnameSafe(): string {
  // Kept as a tiny wrapper so AppChrome owns only shell decisions and the
  // navigation components remain the single owner of active-route styling.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return require("next/navigation").usePathname();
}
