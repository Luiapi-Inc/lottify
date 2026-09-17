"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellIcon } from "./navigation";
import { describeMemberStatus, formatMemberPhone, useMemberSession } from "../lib/member-session-client";

const titles: Record<string, [string, string]> = {
  "/": ["สวัสดีครับ", "ขอให้วันนี้เป็นวันที่ดี"],
  "/buy": ["ซื้อหวย", "เลือกงวด ตรวจราคา แล้วค่อยยืนยัน"],
  "/slips": ["โพยของฉัน", "ใบรับรายการ ผล และประวัติ"],
  "/wallet": ["กระเป๋า", "เงินสด โบนัส และรายการทั้งหมด"],
  "/account": ["บัญชีของฉัน", "ข้อมูลสมาชิกและความปลอดภัย"],
};

export function Topbar() {
  const pathname = usePathname();
  const session = useMemberSession();
  const base = Object.keys(titles).find((key) => key !== "/" && pathname.startsWith(key)) ?? "/";
  const [title, subtitle] = titles[base] ?? titles["/"]!;
  return <header className="topbar">
    <div className="topbar-title"><strong>{title}</strong><span>{subtitle}</span></div>
    <div className="topbar-actions">
      <input className="search" aria-label="ค้นหา" placeholder="ค้นหาหวย งวด หรือเมนู..." />
      <Link className="icon-btn" href="/#alerts" aria-label="การแจ้งเตือน"><BellIcon /><i className="notification-dot" /></Link>
      {/* The chip reflects the server-authoritative session: a visitor whose
          session is gone gets a login entry, never a member identity. */}
      {session.status === "authenticated"
        ? <Link className="member-chip" href="/account"><span className="avatar">ล</span><div><strong>{formatMemberPhone(session.session.phone)}</strong><small>{describeMemberStatus(session.session.status).label}</small></div></Link>
        : session.status === "loading"
          ? <span className="member-chip" aria-busy="true"><span className="avatar">…</span><div><strong>กำลังตรวจสอบเซสชัน</strong><small>กรุณารอสักครู่</small></div></span>
          : <Link className="button secondary" href="/login">เข้าสู่ระบบ</Link>}
    </div>
  </header>;
}
