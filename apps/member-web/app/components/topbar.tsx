"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellIcon } from "./navigation";
import { describeMemberStatus, formatMemberPhone, useMemberSession } from "../lib/member-session-client";

const titles: Record<string, [string, string]> = {
  "/": ["หน้าแรก", "ภาพรวมเงิน งวดที่เปิด และรายการล่าสุด"],
  "/buy": ["ซื้อหวย", "เลือก Product และ Draw ก่อนตรวจ Quote"],
  "/slips": ["โพยของฉัน", "ติดตาม Order, Receipt และ Settlement"],
  "/wallet": ["กระเป๋า", "เงินสด โบนัส ยอดกันไว้ และธุรกรรม"],
  "/account": ["บัญชี", "ข้อมูลสมาชิก ความพร้อม และความปลอดภัย"],
};

export function Topbar() {
  const pathname = usePathname();
  const session = useMemberSession();
  const base = Object.keys(titles).find((key) => key !== "/" && pathname.startsWith(key)) ?? "/";
  const [title, subtitle] = titles[base] ?? titles["/"]!;

  return <header className="member-masthead">
    <Link className="masthead-brand" href="/" aria-label="Lottify หน้าแรก">
      <span className="brand-mark" aria-hidden="true">✦</span>
      <span className="brand-copy"><strong>Lottify</strong><small>MEMBER</small></span>
    </Link>
    <div className="masthead-context" aria-label="หน้าปัจจุบัน">
      <strong>{title}</strong>
      <span>{subtitle}</span>
    </div>
    <div className="masthead-actions">
      <Link className="icon-btn masthead-icon" href="/account/security" aria-label="ความปลอดภัยและการแจ้งเตือน"><BellIcon /></Link>
      {session.status === "authenticated"
        ? <Link className="member-chip" href="/account"><span className="avatar">ล</span><div><strong>{formatMemberPhone(session.session.phone)}</strong><small>{describeMemberStatus(session.session.status).label}</small></div></Link>
        : session.status === "loading"
          ? <span className="member-chip" aria-busy="true"><span className="avatar">…</span><div><strong>ตรวจสอบเซสชัน</strong><small>กำลังเชื่อมต่อ</small></div></span>
          : <Link className="button secondary masthead-login" href="/login">เข้าสู่ระบบ</Link>}
    </div>
  </header>;
}
