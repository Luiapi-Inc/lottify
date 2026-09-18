"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const areas = [
  { href: "/", label: "หน้าแรก", shortLabel: "หน้าแรก", icon: "home" },
  { href: "/buy", label: "ซื้อหวย", shortLabel: "ซื้อหวย", icon: "buy" },
  { href: "/slips", label: "โพยของฉัน", shortLabel: "โพย", icon: "slips" },
  { href: "/wallet", label: "กระเป๋า", shortLabel: "กระเป๋า", icon: "wallet" },
  { href: "/account", label: "บัญชี", shortLabel: "บัญชี", icon: "account" },
] as const;

function Icon({ name }: { name: (typeof areas)[number]["icon"] | "bell" }) {
  const paths: Record<string, ReactNode> = {
    home: <><path d="M3.5 10.5 12 3l8.5 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-4.5v-6h-5v6H5a1.5 1.5 0 0 1-1.5-1.5z" /></>,
    buy: <><path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h10a2.5 2.5 0 0 1 2.5 2.5v2.2a2.8 2.8 0 0 0 0 5.6v5.2A2.5 2.5 0 0 1 17 21H7a2.5 2.5 0 0 1-2.5-2.5v-5.2a2.8 2.8 0 0 0 0-5.6z" /><path d="M9 7.5h6M9 11h6M9 14.5h4" /></>,
    slips: <><path d="M6 3h12v18l-2.2-1.5-2 1.5-1.8-1.5-1.8 1.5-2-1.5L6 21z" /><path d="M9 7h6M9 11h6M9 15h4" /></>,
    wallet: <><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 17.5z" /><path d="M4 8h13.5A2.5 2.5 0 0 1 20 10.5V14h-5a3 3 0 0 1 0-6h5" /><circle cx="15" cy="11" r=".8" /></>,
    account: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
    bell: <><path d="M6.5 10a5.5 5.5 0 1 1 11 0c0 5 2 5.5 2 7h-15c0-1.5 2-2 2-7Z" /><path d="M9.5 20h5" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function AreaLinks({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  return <>{areas.map((area) => {
    const active = isActive(pathname, area.href);
    return <Link className={active ? "active" : undefined} key={area.href} href={area.href} aria-current={active ? "page" : undefined}>
      <span className="nav-icon"><Icon name={area.icon} /></span><span>{compact ? area.shortLabel : area.label}</span>
    </Link>;
  })}</>;
}

export function Navigation() { return <nav className="dock-nav" aria-label="เมนูหลัก"><AreaLinks /></nav>; }
export function MobileNavigation() { return <nav className="mobile-nav" aria-label="เมนูหลักมือถือ"><AreaLinks compact /></nav>; }
export function BellIcon() { return <Icon name="bell" />; }
