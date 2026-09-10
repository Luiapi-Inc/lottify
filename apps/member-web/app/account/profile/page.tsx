"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { memberApi } from "../../lib/member-api";

const defaultProfile = { name: "", birthdate: "", province: "กรุงเทพมหานคร" };

function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone;
  return `${phone.slice(0, Math.min(3, phone.length - 4))}••••${phone.slice(-4)}`;
}

export default function MemberProfilePage() {
  const [profile, setProfile] = useState(defaultProfile);
  const [phone, setPhone] = useState("");
  const [profileComplete, setProfileComplete] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    memberApi.getProfile()
      .then((currentProfile) => {
        setProfile({
          name: currentProfile.fullName ?? "",
          birthdate: currentProfile.dateOfBirth ?? "",
          province: currentProfile.province ?? "กรุงเทพมหานคร",
        });
        setPhone(currentProfile.phone);
        setProfileComplete(currentProfile.profileComplete);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "โหลดข้อมูลสมาชิกไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!profile.name.trim() || !profile.birthdate || !profile.province) {
      setError("กรอกข้อมูลที่จำเป็นให้ครบ");
      return;
    }
    setSubmitting(true);
    setSaved(false);
    setError("");
    try {
      const result = await memberApi.updateProfile({
        fullName: profile.name.trim(),
        dateOfBirth: profile.birthdate,
        province: profile.province,
      });
      setProfile({
        name: result.fullName ?? "",
        birthdate: result.dateOfBirth ?? "",
        province: result.province ?? "กรุงเทพมหานคร",
      });
      setPhone(result.phone);
      setProfileComplete(result.profileComplete);
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "บันทึกข้อมูลสมาชิกไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  };
  return <main id="main">
    <div className="breadcrumb"><Link href="/account">บัญชี</Link><span>/</span><span>ข้อมูลส่วนตัว</span></div>
    <div className="page-head"><div><h1>ข้อมูลสมาชิก</h1><p>ตรวจและแก้ไขข้อมูลพื้นฐานที่ใช้กับบัญชีและการประเมินความพร้อมของบริการ</p></div></div>
    <section className="grid-2 member-profile-layout"><div className="stack"><form className="panel" onSubmit={submit}><div className="panel-title"><h2>ข้อมูลส่วนตัว</h2><span className={`status ${profileComplete ? "success" : "warning"}`}>{loading ? "กำลังโหลด" : profileComplete ? "ข้อมูลครบ" : "ยังไม่ครบ"}</span></div><div className="form-grid"><div className="field full"><label htmlFor="member-name">ชื่อ-นามสกุล</label><input id="member-name" className="input" autoComplete="name" disabled={loading || submitting} value={profile.name} onChange={(event) => { setProfile({ ...profile, name: event.target.value }); setSaved(false); setError(""); }} /></div><div className="field"><label htmlFor="member-birthdate">วันเกิด</label><input id="member-birthdate" className="input" type="date" disabled={loading || submitting} value={profile.birthdate} onChange={(event) => { setProfile({ ...profile, birthdate: event.target.value }); setSaved(false); setError(""); }} /></div><div className="field"><label htmlFor="member-province">จังหวัด</label><select id="member-province" className="select" disabled={loading || submitting} value={profile.province} onChange={(event) => { setProfile({ ...profile, province: event.target.value }); setSaved(false); setError(""); }}><option>กรุงเทพมหานคร</option><option>ปทุมธานี</option><option>นนทบุรี</option>{profile.province && !["กรุงเทพมหานคร", "ปทุมธานี", "นนทบุรี"].includes(profile.province) && <option>{profile.province}</option>}</select></div></div><div className="field-error">{error}</div><div className="profile-save-bar"><Link className="button secondary" href="/account">ยกเลิก</Link><button className={`button primary ${loading || submitting ? "disabled" : ""}`} disabled={loading || submitting} type="submit">{submitting ? "กำลังบันทึก…" : "บันทึกข้อมูล"}</button></div>{saved && <div className="notice success profile-save-notice"><b>✓</b><div><strong>บันทึกข้อมูลแล้ว</strong>ข้อมูลสมาชิกถูกอัปเดตในบัญชีเรียบร้อยแล้ว</div></div>}</form></div>
      <aside className="stack"><section className="panel"><div className="panel-title"><h2>เบอร์โทรศัพท์</h2><span className="status success">ยืนยันแล้ว</span></div><div className="verified-profile-item"><div className="menu-icon">T</div><div><strong>{phone ? maskPhone(phone) : "กำลังโหลด…"}</strong><span>ใช้สำหรับเข้าสู่ระบบและการยืนยันตามนโยบายที่มีผล · แก้ไขจากหน้านี้ไม่ได้</span></div></div><div className="notice info" style={{ marginTop: 14 }}><b>i</b><div><strong>OTP เป็นหลักฐานการครอบครองเบอร์</strong>การยืนยันเบอร์โทรและ KYC เป็นคนละส่วนกัน</div></div></section><section className="panel"><div className="panel-title"><h2>ความพร้อมของข้อมูล</h2></div><div className="menu-row"><div className="menu-icon">P</div><div><strong>ข้อมูลพื้นฐาน</strong><span>{profileComplete ? "ชื่อ วันเกิด และจังหวัดครบแล้ว" : "ยังมีข้อมูลพื้นฐานที่ต้องกรอกให้ครบ"}</span></div><span className={`status ${profileComplete ? "success" : "warning"}`}>{profileComplete ? "ครบ" : "ยังไม่ครบ"}</span></div><div className="menu-row"><div className="menu-icon">K</div><div><strong>การยืนยันตัวตน</strong><span>ระบบจะขอเมื่อบริการนั้นต้องใช้</span></div><Link className="text-link" href="/account/kyc">ดูสถานะ →</Link></div></section></aside>
    </section>
  </main>;
}
