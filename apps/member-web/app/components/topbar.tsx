"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellIcon } from "./navigation";
import { describeMemberStatus, formatMemberPhone, useMemberSession } from "../lib/member-session-client";

const titles: Record<string, [string, string]> = {
  "/": ["ภาพรวมวันนี้", "ยอดเงิน งวดที่เปิด และรายการล่าสุด"],
  "/buy": ["ซื้อหวย", "เลือก Product, Draw และตรวจ Quote ก่อนยืนยัน"],
  "/slips": ["โพยของฉัน", "สถานะ ใบรับรายการ และผล Settlement"],
  "/wallet": ["กระเป๋า", "CASH, BONUS, ยอดกันไว้ และธุรกรรม"],
  "/account": ["บัญชีของฉัน", "ข้อมูล ความพร้อม และความปลอดภัย"],
};

export function Topbar() {
  const pathname = usePathname();
  const session = useMemberSession();
  const base = Object.keys(titles).find((key) => key !== "/" && pathname.startsWith(key)) ?? "/";
  const [title, subtitle] = titles[base] ?? titles["/"]!;

  return <header className="topbar">
    <div className="topbar-title"><strong>{title}</strong><span>{subtitle}</span></div>
    <div className="topbar-actions">
      <Link className="icon-btn" href="/account/security" aria-label="ความปลอดภัยและการแจ้งเตือน"><BellIcon /></Link>
      {session.status === "authenticated"
        ? <Link className="member-chip" href="/account"><span className="avatar">ล</span><div><strong>{formatMemberPhone(session.session.phone)}</strong><small>{describeMemberStatus(session.session.status).label}</small></div></Link>
        : session.status === "loading"
          ? <span className="member-chip" aria-busy="true"><span className="avatar">…</span><div><strong>ตรวจสอบเซสชัน</strong><small>กำลังเชื่อมต่อ</small></div></span>
          : <Link className="button secondary" href="/login">เข้าสู่ระบบ</Link>}
    </div>
  </header>;
}
