"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "../components/auth-shell";
import { saveAuthFlow } from "../lib/auth-flow";
import { memberApi } from "../lib/member-api";

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (phone.replace(/\D/g, "").length < 9) {
      setError("กรอกเบอร์โทรศัพท์ให้ถูกต้อง");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await memberApi.requestOtp("LOGIN", phone.trim());
      saveAuthFlow({
        purpose: "LOGIN",
        phone: phone.trim(),
        deliveredTo: result.deliveredTo,
        retryAfterSeconds: result.retryAfterSeconds,
      });
      router.push("/otp");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "ไม่สามารถขอรหัส OTP ได้");
    } finally {
      setSubmitting(false);
    }
  };
  return <AuthShell title={<>ทุกโพย<br />ตรวจสอบได้ทุกขั้นตอน</>} copy="เข้าถึงการซื้อหวย กระเป๋า ใบรับรายการ โปรโมชั่น และความปลอดภัยจากบัญชีเดียว" foot="Lottify Member">
    <form className="auth-card" onSubmit={submit}><h2>เข้าสู่ระบบ</h2><p>กรอกเบอร์โทรศัพท์ที่ใช้กับ Lottify เพื่อรับรหัส OTP</p><div className="field"><label htmlFor="phone">เบอร์โทรศัพท์</label><input id="phone" className="input" inputMode="tel" autoComplete="tel" placeholder="08X-XXX-XXXX" value={phone} onChange={(event) => { setPhone(event.target.value); setError(""); }} /></div><div className="field-error">{error}</div><button className={`button lime block ${submitting ? "disabled" : ""}`} type="submit" disabled={submitting} style={{ marginTop: 16 }}>{submitting ? "กำลังส่งรหัส…" : "รับรหัส OTP →"}</button><div className="divider">หรือ</div><Link className="button secondary block" href="/register">สร้างบัญชีใหม่</Link><p className="small muted" style={{ marginTop: 18, textAlign: "center" }}>การเข้าสู่ระบบจะตรวจเงื่อนไขที่มีผลกับบัญชีอีกครั้งเมื่อใช้บริการสำคัญ</p></form>
  </AuthShell>;
}
