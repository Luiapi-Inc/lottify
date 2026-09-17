"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { memberApi } from "../lib/member-api";
import { describeMemberStatus, formatMemberPhone, useMemberSession } from "../lib/member-session-client";

export default function AccountPage() {
  const router = useRouter();
  const state = useMemberSession();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await memberApi.logout();
    } catch {
      // The session is being dropped locally either way; a failed revoke must
      // not leave the member stuck on a page that claims they are signed in.
    } finally {
      setSigningOut(false);
      router.replace("/login");
    }
  };

  return <main id="main">
    <div className="page-head"><div><h1>บัญชีของฉัน</h1><p>ข้อมูลสมาชิก ความพร้อมของบริการ การยืนยันตัวตน บัญชีรับเงิน และความปลอดภัย</p></div>
      {state.status === "authenticated" && <button className="button secondary" type="button" onClick={signOut} disabled={signingOut}>{signingOut ? "กำลังออกจากระบบ…" : "ออกจากระบบ"}</button>}
    </div>

    {state.status === "loading" && <section className="panel"><div className="panel-title"><h2>กำลังตรวจสอบเซสชัน</h2></div><p className="muted small">กำลังยืนยันเซสชันกับเซิร์ฟเวอร์…</p></section>}

    {state.status === "signed-out" && <section className="panel"><div className="panel-title"><h2>ยังไม่ได้เข้าสู่ระบบ</h2></div><p className="muted small">เซสชันของบราวเซอร์นี้หมดอายุหรือถูกยกเลิก จึงยังแสดงข้อมูลบัญชีไม่ได้</p><Link className="button lime" href="/login" style={{ marginTop: 12 }}>เข้าสู่ระบบ →</Link></section>}

    {state.status === "unavailable" && <section className="panel"><div className="panel-title"><h2>ตรวจสอบเซสชันไม่สำเร็จ</h2></div><p className="muted small">{state.message}</p></section>}

    {state.status === "authenticated" && <section className="grid-2">
      <div className="stack">
        <section className="panel"><div className="profile-hero"><div className="profile-avatar">ล</div><div><h2>{formatMemberPhone(state.session.phone)}</h2><p>สถานะบัญชี: {describeMemberStatus(state.session.status).label}{state.session.passwordEnrolled ? "" : " · ยังไม่ได้ตั้งรหัสผ่าน"}</p></div></div><div className="menu-list">
          <Link className="menu-row" href="/account/profile"><div className="menu-icon">P</div><div><strong>ข้อมูลส่วนตัว</strong><span>ชื่อ วันเกิด และข้อมูลที่จำเป็น</span></div><span>→</span></Link>
          <Link className="menu-row" href="/terms?from=account"><div className="menu-icon">T</div><div><strong>ข้อตกลงและเงื่อนไข</strong><span>ตรวจเวอร์ชันและสถานะการยอมรับ</span></div><span>→</span></Link>
          <Link className="menu-row" href="/account/kyc"><div className="menu-icon">K</div><div><strong>การยืนยันตัวตน</strong><span>จำเป็นก่อนถอนเงินครั้งแรกในตัวอย่างนี้</span></div><span>→</span></Link>
          <Link className="menu-row" href="/account/bank-account"><div className="menu-icon">B</div><div><strong>บัญชีธนาคาร</strong><span>จัดการบัญชีรับเงินสำหรับการถอน</span></div><span>→</span></Link>
          <Link className="menu-row" href="/account/referral"><div className="menu-icon">ช</div><div><strong>แนะนำเพื่อน</strong><span>แชร์ลิงก์สมัครสมาชิกและดูสถานะการแนะนำ</span></div><span>→</span></Link>
        </div></section>
        <section className="panel"><div className="panel-title"><h2>ความพร้อมของบริการ</h2></div><div className="menu-row"><div className="menu-icon">B</div><div><strong>ซื้อหวย</strong><span>ตรวจสถานะล่าสุดได้จากหน้าซื้อหวย</span></div><Link href="/buy">ไปที่หน้าซื้อหวย →</Link></div><div className="menu-row"><div className="menu-icon">D</div><div><strong>ฝากเงิน</strong><span>ตรวจสถานะล่าสุดได้จากหน้ากระเป๋า</span></div><Link href="/wallet/deposit">ไปที่หน้าฝากเงิน →</Link></div><div className="menu-row"><div className="menu-icon">W</div><div><strong>ถอนเงิน</strong><span>ต้องยืนยันตัวตนก่อน</span></div><Link href="/account/kyc">ไปที่การยืนยันตัวตน →</Link></div></section>
      </div>
      <aside className="stack">
        <section className="panel"><div className="panel-title"><h2>ความปลอดภัย</h2><Link href="/account/security">จัดการ →</Link></div><div className="notice warning"><b>!</b><div><strong>ตรวจสอบอุปกรณ์และเซสชันของคุณ</strong>ดูรายการอุปกรณ์ที่เข้าใช้งานล่าสุดได้ที่หน้าความปลอดภัย</div></div><div className="menu-list" style={{ marginTop: 10 }}><Link className="menu-row" href="/account/security"><div className="menu-icon">S</div><div><strong>อุปกรณ์และเซสชัน</strong><span>ตรวจและออกจากระบบรายอุปกรณ์</span></div><span>→</span></Link><Link className="menu-row" href="/account/security#recovery"><div className="menu-icon">R</div><div><strong>กู้คืนบัญชี</strong><span>เริ่มคำขอและตรวจสถานะ</span></div><span>→</span></Link></div></section>
        <section className="panel"><div className="panel-title"><h2>ช่วยเหลือ</h2></div><div className="menu-row"><div className="menu-icon">?</div><div><strong>ศูนย์ช่วยเหลือ</strong><span>คำถามเกี่ยวกับรายการและบัญชี</span></div><span>→</span></div><div className="menu-row"><div className="menu-icon">C</div><div><strong>ติดต่อเจ้าหน้าที่</strong><span>ใช้เลขอ้างอิงของรายการเพื่อให้ตรวจสอบเร็วขึ้น</span></div><span>→</span></div></section>
      </aside>
    </section>}
  </main>;
}
