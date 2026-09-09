"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const areas = [
  { href: "/", label: "หน้าแรก", icon: "⌂" },
  { href: "/buy", label: "ซื้อหวย", icon: "◇" },
  { href: "/slips", label: "โพยของฉัน", icon: "▤" },
  { href: "/wallet", label: "กระเป๋า", icon: "▱" },
  { href: "/account", label: "บัญชี", icon: "◎" },
];

export function Navigation() {
  const pathname = usePathname();
  return (
    <nav className="navigation" aria-label="เมนูหลัก">
      {areas.map(({ href, label, icon }) => (
        <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>
          <span className="nav-icon" aria-hidden="true">{icon}</span>
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
