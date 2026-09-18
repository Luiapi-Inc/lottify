"use client";

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
      <Topbar />
      <div className="workspace">
        <div className="workspace-body">{children}</div>
      </div>
      <Navigation />
    </div>
    <MobileNavigation />
  </>;
}
