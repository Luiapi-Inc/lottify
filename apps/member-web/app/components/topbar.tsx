"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellIcon } from "./navigation";
import { describeMemberStatus, formatMemberPhone, useMemberSession } from "../lib/member-session-client";

const titles: Record<string, [string, string]> = {
  "/": ["หน้าแรก", "ภาพรวมบัญชี งวดที่เปิดรับ และรายการล่าสุด"],
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

  return <header className="masthead">
    <Link className="masthead-brand" href="/" aria-label="Lottify หน้าแรก">
      <strong>Lottify</strong><span>Member</span>
    </Link>
    <div className="masthead-context"><strong>{title}</strong><span>{subtitle}</span></div>
    <div className="masthead-actions">
      <Link className="icon-btn" href="/#alerts" aria-label="การแจ้งเตือน"><BellIcon /><i className="notification-dot" /></Link>
      {session.status === "authenticated"
        ? <Link className="member-chip" href="/account"><span className="avatar">ล</span><div><strong>{formatMemberPhone(session.session.phone)}</strong><small>{describeMemberStatus(session.session.status).label}</small></div></Link>
        : session.status === "loading"
          ? <span className="member-chip" aria-busy="true"><span className="avatar">…</span><div><strong>กำลังตรวจสอบเซสชัน</strong><small>กรุณารอสักครู่</small></div></span>
          : <Link className="button secondary" href="/login">เข้าสู่ระบบ</Link>}
    </div>
  </header>;
}
