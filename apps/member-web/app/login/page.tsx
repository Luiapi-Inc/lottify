"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "../components/auth-shell";

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("0812348421");
  const submit = (event: FormEvent) => { event.preventDefault(); if (phone.replace(/\D/g, "").length >= 9) router.push("/otp?mode=login"); };
  return <AuthShell title={<>ทุกโพย<br />ตรวจสอบได้ทุกขั้นตอน</>} copy="เข้าถึงการซื้อหวย กระเป๋า ใบรับรายการ โปรโมชั่น และความปลอดภัยจากบัญชีเดียว" foot="Lottify Member">
    <form className="auth-card" onSubmit={submit}><h2>เข้าสู่ระบบ</h2><p>กรอกเบอร์โทรศัพท์ที่ใช้กับ Lottify เพื่อรับรหัส OTP</p><div className="field"><label htmlFor="phone">เบอร์โทรศัพท์</label><input id="phone" className="input" inputMode="tel" placeholder="08X-XXX-XXXX" value={phone} onChange={(event) => setPhone(event.target.value)} /></div><button className="button lime block" type="submit" style={{ marginTop: 16 }}>รับรหัส OTP →</button><div className="divider">หรือ</div><Link className="button secondary block" href="/register">สร้างบัญชีใหม่</Link><p className="small muted" style={{ marginTop: 18, textAlign: "center" }}>การเข้าสู่ระบบจะตรวจเงื่อนไขที่มีผลกับบัญชีอีกครั้งเมื่อใช้บริการสำคัญ</p></form>
  </AuthShell>;
}
