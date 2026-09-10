"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

const defaultProfile = { name: "คุณ สมาชิก", birthdate: "1990-01-01", province: "กรุงเทพมหานคร" };

export default function MemberProfilePage() {
  const [profile, setProfile] = useState(defaultProfile);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("lottify-member-profile");
      if (stored) setProfile({ ...defaultProfile, ...JSON.parse(stored) });
    } catch {}
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try { window.localStorage.setItem("lottify-member-profile", JSON.stringify(profile)); } catch {}
    setSaved(true);
  };
  return <main id="main">
    <div className="breadcrumb"><Link href="/account">บัญชี</Link><span>/</span><span>ข้อมูลส่วนตัว</span></div>
    <div className="page-head"><div><h1>ข้อมูลสมาชิก</h1><p>ตรวจและแก้ไขข้อมูลพื้นฐานที่ใช้กับบัญชีและการประเมินความพร้อมของบริการ</p></div></div>
    <section className="grid-2 member-profile-layout"><div className="stack"><form className="panel" onSubmit={submit}><div className="panel-title"><h2>ข้อมูลส่วนตัว</h2><span className="status success">ข้อมูลครบ</span></div><div className="form-grid"><div className="field full"><label htmlFor="member-name">ชื่อ-นามสกุล</label><input id="member-name" className="input" autoComplete="name" value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></div><div className="field"><label htmlFor="member-birthdate">วันเกิด</label><input id="member-birthdate" className="input" type="date" value={profile.birthdate} onChange={(event) => setProfile({ ...profile, birthdate: event.target.value })} /></div><div className="field"><label htmlFor="member-province">จังหวัด</label><select id="member-province" className="select" value={profile.province} onChange={(event) => setProfile({ ...profile, province: event.target.value })}><option>กรุงเทพมหานคร</option><option>ปทุมธานี</option><option>นนทบุรี</option></select></div></div><div className="profile-save-bar"><Link className="button secondary" href="/account">ยกเลิก</Link><button className="button primary" type="submit">บันทึกข้อมูล</button></div>{saved && <div className="notice success profile-save-notice"><b>✓</b><div><strong>บันทึกข้อมูลแล้ว</strong>ข้อมูลสมาชิกใน frontend preview ถูกอัปเดตแล้ว</div></div>}</form></div>
      <aside className="stack"><section className="panel"><div className="panel-title"><h2>เบอร์โทรศัพท์</h2><span className="status success">ยืนยันแล้ว</span></div><div className="verified-profile-item"><div className="menu-icon">T</div><div><strong>08X-XXX-8421</strong><span>ใช้สำหรับเข้าสู่ระบบและการยืนยันตามนโยบายที่มีผล</span></div></div><div className="notice info" style={{ marginTop: 14 }}><b>i</b><div><strong>OTP เป็นหลักฐานการครอบครองเบอร์</strong>การยืนยันเบอร์โทรและ KYC เป็นคนละส่วนกัน</div></div></section><section className="panel"><div className="panel-title"><h2>ความพร้อมของข้อมูล</h2></div><div className="menu-row"><div className="menu-icon">P</div><div><strong>ข้อมูลพื้นฐาน</strong><span>ชื่อ วันเกิด และจังหวัดครบแล้ว</span></div><span className="status success">ครบ</span></div><div className="menu-row"><div className="menu-icon">K</div><div><strong>การยืนยันตัวตน</strong><span>ระบบจะขอเมื่อบริการนั้นต้องใช้</span></div><Link className="text-link" href="/account/kyc">ดูสถานะ →</Link></div></section></aside>
    </section>
  </main>;
}
