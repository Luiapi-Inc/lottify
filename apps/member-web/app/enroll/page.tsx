"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "../components/auth-shell";
import { saveAuthFlow } from "../lib/auth-flow";
import { MemberApiFailure, memberApi } from "../lib/member-api";

export default function EnrollPage() {
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
      const result = await memberApi.requestOtp("PASSWORD_ENROLL", phone);
      saveAuthFlow({
        purpose: "PASSWORD_ENROLL",
        phone,
        deliveredTo: result.deliveredTo,
        retryAfterSeconds: result.retryAfterSeconds,
      });
      router.push("/otp");
    } catch (requestError) {
      if (requestError instanceof MemberApiFailure && requestError.details?.retryAfterSeconds) {
        setError(`กรุณารออีกประมาณ ${requestError.details.retryAfterSeconds} วินาทีก่อนขอรหัสใหม่`);
        return;
      }
      setError(requestError instanceof Error ? requestError.message : "ไม่สามารถขอรหัส OTP ได้");
    } finally {
      setSubmitting(false);
    }
  };
  return <AuthShell title={<>บัญชีเดิม<br />ตั้งรหัสผ่านให้พร้อม</>} copy="บัญชีของคุณยังไม่มีรหัสผ่าน เราจะส่ง OTP เพื่อยืนยันว่าเป็นคุณ แล้วให้ตั้งรหัสผ่านใหม่เพื่อเข้าใช้งานครั้งต่อไป" foot="ขั้นตอนตั้งรหัสผ่านครั้งแรก">
    <form className="auth-card" onSubmit={submit}><h2>ตั้งรหัสผ่านครั้งแรก</h2><p>กรอกเบอร์โทรศัพท์ที่ใช้สมัครบัญชี Lottify เพื่อรับรหัส OTP</p><div className="field"><label htmlFor="phone">เบอร์โทรศัพท์</label><input id="phone" className="input" inputMode="tel" autoComplete="tel" placeholder="08X-XXX-XXXX" value={phone} onChange={(event) => { setPhone(event.target.value); setError(""); }} /></div><div className="notice info" style={{ marginTop: 14 }}><b>i</b><div><strong>หลังยืนยัน OTP</strong>ระบบจะให้ตั้งรหัสผ่านใหม่ จากนั้นกลับมาเข้าสู่ระบบด้วยเบอร์โทรและรหัสผ่าน</div></div><div className="field-error">{error}</div><button className={`button lime block ${submitting ? "disabled" : ""}`} type="submit" disabled={submitting} style={{ marginTop: 16 }}>{submitting ? "กำลังส่งรหัส…" : "รับรหัส OTP →"}</button><p className="small muted" style={{ marginTop: 18, textAlign: "center" }}>จำรหัสผ่านได้แล้ว? <Link className="text-link" href="/login">เข้าสู่ระบบ</Link></p></form>
  </AuthShell>;
}
