"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "../components/auth-shell";
import { saveAuthFlow } from "../lib/auth-flow";
import { MemberApiFailure, memberApi } from "../lib/member-api";
import { passwordViolation } from "../lib/password-policy";

export default function RegisterPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ref, setRef] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => setRef(new URLSearchParams(window.location.search).get("ref")?.slice(0, 32) ?? ""), []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (phone.replace(/\D/g, "").length < 9) {
      setError("กรอกเบอร์โทรศัพท์ให้ถูกต้อง");
      return;
    }
    const violation = passwordViolation(password);
    if (violation) return setError(violation);
    if (password !== confirm) return setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
    setSubmitting(true);
    setError("");
    try {
      const result = await memberApi.requestOtp("REGISTER", phone);
      saveAuthFlow({
        purpose: "REGISTER",
        phone,
        password,
        deliveredTo: result.deliveredTo,
        retryAfterSeconds: result.retryAfterSeconds,
      });
      router.push("/otp");
    } catch (requestError) {
      if (requestError instanceof MemberApiFailure && requestError.code === "MEMBER_ALREADY_REGISTERED") {
        setError("เบอร์โทรนี้มีบัญชีอยู่แล้ว ลองเข้าสู่ระบบ หรือใช้ลิงก์ลืมรหัสผ่านหากจำรหัสไม่ได้");
        return;
      }
      setError(requestError instanceof Error ? requestError.message : "ไม่สามารถขอรหัส OTP ได้");
    } finally {
      setSubmitting(false);
    }
  };
  return <AuthShell title={<>เริ่มต้นง่าย<br />ค่อยยืนยันเมื่อจำเป็น</>} copy="การสมัครเริ่มจากเบอร์โทร รหัสผ่าน และ OTP จากนั้นยอมรับเงื่อนไขและกรอกข้อมูลที่จำเป็น การยืนยันตัวตนจะขอเมื่อบริการนั้นต้องใช้" foot="Thai-first · Mobile-first">
    <form className="auth-card" onSubmit={submit}><h2>สร้างบัญชี</h2><p>ขั้นตอน 1 จาก 5 · เบอร์โทรและรหัสผ่าน</p>{ref && <div className="notice warning referral-register-notice"><b>!</b><div><strong>พบ referral code แต่ API สมัครสมาชิกยังไม่รองรับ</strong><span>รหัส {ref} จะไม่ถูกส่งหรืออ้างว่าเชื่อมสำเร็จจนกว่า Member API contract จะเพิ่ม field นี้</span></div></div>}<div className="field"><label htmlFor="phone">เบอร์โทรศัพท์</label><input id="phone" className="input" inputMode="tel" autoComplete="tel" placeholder="08X-XXX-XXXX" value={phone} onChange={(event) => { setPhone(event.target.value); setError(""); }} /></div><div className="field" style={{ marginTop: 14 }}><label htmlFor="password">รหัสผ่าน</label><input id="password" className="input" type="password" autoComplete="new-password" value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} /></div><div className="field" style={{ marginTop: 14 }}><label htmlFor="confirm">ยืนยันรหัสผ่าน</label><input id="confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(event) => { setConfirm(event.target.value); setError(""); }} /></div><div className="notice info" style={{ marginTop: 14 }}><b>i</b><div><strong>Terms จะอยู่หลัง OTP</strong>ยืนยันเบอร์ก่อน จากนั้นระบบจะแสดงข้อตกลงเวอร์ชันที่มีผลให้ตรวจและยอมรับอย่างชัดเจน</div></div><div className="field-error">{error}</div><button className={`button lime block ${submitting ? "disabled" : ""}`} type="submit" disabled={submitting} style={{ marginTop: 16 }}>{submitting ? "กำลังส่งรหัส…" : "รับรหัส OTP →"}</button><p className="small muted" style={{ marginTop: 18, textAlign: "center" }}>มีบัญชีแล้ว? <Link className="text-link" href="/login">เข้าสู่ระบบ</Link></p></form>
  </AuthShell>;
}
