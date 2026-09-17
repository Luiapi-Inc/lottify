"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "../components/auth-shell";
import { saveAuthFlow } from "../lib/auth-flow";
import { MemberApiFailure, memberApi } from "../lib/member-api";

export default function ForgotPasswordPage() {
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
      const result = await memberApi.requestRecoveryOtp(phone);
      saveAuthFlow({
        purpose: "RECOVERY",
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
  return <AuthShell title={<>ลืมรหัสผ่าน?<br />เราช่วยคุณได้</>} copy="เราจะส่งรหัส OTP ไปยังเบอร์โทรที่ยืนยันไว้ เพื่อยืนยันว่าเป็นคุณ แล้วให้ตั้งรหัสผ่านใหม่ การรีเซ็ตจะออกจากระบบทุกอุปกรณ์" foot="การกู้คืนผ่านเบอร์โทรที่ยืนยัน">
    <form className="auth-card" onSubmit={submit}><h2>ลืมรหัสผ่าน</h2><p>กรอกเบอร์โทรศัพท์ที่ใช้กับบัญชี Lottify เพื่อรับรหัส OTP</p><div className="field"><label htmlFor="phone">เบอร์โทรศัพท์</label><input id="phone" className="input" inputMode="tel" autoComplete="tel" placeholder="08X-XXX-XXXX" value={phone} onChange={(event) => { setPhone(event.target.value); setError(""); }} /></div><div className="notice warning" style={{ marginTop: 14 }}><b>!</b><div><strong>หลังรีเซ็ตจะออกจากระบบทุกอุปกรณ์</strong>คุณต้องเข้าสู่ระบบใหม่ด้วยรหัสผ่านที่ตั้งใหม่</div></div><div className="field-error">{error}</div><button className={`button lime block ${submitting ? "disabled" : ""}`} type="submit" disabled={submitting} style={{ marginTop: 16 }}>{submitting ? "กำลังส่งรหัส…" : "ส่งรหัส OTP →"}</button><p className="small muted" style={{ marginTop: 18, textAlign: "center" }}>จำรหัสได้แล้ว? <Link className="text-link" href="/login">เข้าสู่ระบบ</Link></p></form>
  </AuthShell>;
}
