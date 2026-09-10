"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "../components/auth-shell";

export default function RegisterPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [ref, setRef] = useState("");
  useEffect(() => setRef(new URLSearchParams(window.location.search).get("ref")?.slice(0, 32) ?? ""), []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (phone.replace(/\D/g, "").length < 9) return;
    router.push(`/otp?mode=register${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`);
  };
  return <AuthShell title={<>เริ่มต้นง่าย<br />ค่อยยืนยันเมื่อจำเป็น</>} copy="การสมัครเริ่มจากเบอร์โทรและ OTP จากนั้นยอมรับเงื่อนไขและกรอกข้อมูลที่จำเป็น การยืนยันตัวตนจะขอเมื่อบริการนั้นต้องใช้" foot="Thai-first · Mobile-first">
    <form className="auth-card" onSubmit={submit}><h2>สร้างบัญชี</h2><p>ขั้นตอน 1 จาก 5 · ยืนยันเบอร์โทรศัพท์</p>{ref && <div className="notice success referral-register-notice"><b>✓</b><div><strong>ได้รับลิงก์แนะนำแล้ว</strong><span>รหัสแนะนำ: {ref}</span></div></div>}<div className="field"><label htmlFor="phone">เบอร์โทรศัพท์</label><input id="phone" className="input" inputMode="tel" placeholder="08X-XXX-XXXX" value={phone} onChange={(event) => setPhone(event.target.value)} /></div><div className="notice info" style={{ marginTop: 14 }}><b>i</b><div><strong>Terms จะอยู่หลัง OTP</strong>ยืนยันเบอร์ก่อน จากนั้นระบบจะแสดงข้อตกลงเวอร์ชันที่มีผลให้ตรวจและยอมรับอย่างชัดเจน</div></div><button className="button lime block" type="submit" style={{ marginTop: 16 }}>รับรหัส OTP →</button><p className="small muted" style={{ marginTop: 18, textAlign: "center" }}>มีบัญชีแล้ว? <Link className="text-link" href="/login">เข้าสู่ระบบ</Link></p></form>
  </AuthShell>;
}
