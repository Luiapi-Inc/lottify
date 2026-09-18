"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "../components/auth-shell";
import { clearAuthFlow, readAuthFlow, type PendingAuthFlow } from "../lib/auth-flow";
import { memberApi } from "../lib/member-api";
import { passwordViolation } from "../lib/password-policy";

const CHANGE_PHONE_LINK: Record<PendingAuthFlow["purpose"], string> = {
  REGISTER: "/register",
  PASSWORD_ENROLL: "/enroll",
  RECOVERY: "/forgot-password",
};

export default function OtpPage() {
  const router = useRouter();
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [flow, setFlow] = useState<PendingAuthFlow | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState("");
  useEffect(() => {
    setFlow(readAuthFlow());
    setReady(true);
  }, []);
  const needsPassword = flow?.purpose === "PASSWORD_ENROLL" || flow?.purpose === "RECOVERY";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (otp.length !== 6) return setError("กรอกรหัส OTP ให้ครบ 6 หลัก");
    if (!flow) return setError("ไม่พบข้อมูลคำขอ OTP กรุณาขอรหัสใหม่");
    if (needsPassword) {
      const violation = passwordViolation(password);
      if (violation) return setError(violation);
      if (password !== confirm) return setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
    }
    setSubmitting(true);
    setError("");
    try {
      if (flow.purpose === "REGISTER") {
        if (!flow.password) return setError("ไม่พบรหัสผ่านจากขั้นตอนสมัคร กรุณากลับไปสมัครใหม่");
        await memberApi.verifyOtp("REGISTER", flow.phone, otp, flow.password);
        clearAuthFlow();
        router.push("/terms");
        return;
      }
      if (flow.purpose === "PASSWORD_ENROLL") {
        await memberApi.verifyOtp("PASSWORD_ENROLL", flow.phone, otp, password);
        clearAuthFlow();
        setSuccess("ตั้งรหัสผ่านเรียบร้อยแล้ว");
        return;
      }
      await memberApi.resetPassword(flow.phone, otp, password);
      clearAuthFlow();
      setSuccess("รีเซ็ตรหัสผ่านเรียบร้อยแล้ว");
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "ยืนยัน OTP ไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  };
  if (success) {
    return <AuthShell title="เรียบร้อย" copy="คุณพร้อมเข้าใช้งานด้วยรหัสผ่านใหม่แล้ว" foot="Lottify Member">
      <form className="auth-card" onSubmit={(event) => { event.preventDefault(); router.push("/login"); }}><div className="security-success-icon" style={{ width: 48, height: 48, fontSize: 24 }}>✓</div><h2>{success}</h2><p className="small muted">กลับไปหน้าเข้าสู่ระบบและใช้เบอร์โทรกับรหัสผ่านใหม่ของคุณเพื่อเข้าใช้งาน</p><button className="button lime block" type="submit" style={{ marginTop: 18 }}>ไปหน้าเข้าสู่ระบบ →</button></form>
    </AuthShell>;
  }
  const heading = flow?.purpose === "REGISTER"
    ? "ขั้นตอน 2 จาก 5 · กรอกรหัส 6 หลักที่ได้รับทาง SMS"
    : flow?.purpose === "PASSWORD_ENROLL"
      ? "ตั้งรหัสผ่าน · กรอกรหัส OTP และตั้งรหัสผ่านใหม่"
      : flow?.purpose === "RECOVERY"
        ? "รีเซ็ตรหัสผ่าน · กรอกรหัส OTP และตั้งรหัสผ่านใหม่"
        : "กรอกรหัส 6 หลักที่ได้รับทาง SMS";
  return <AuthShell title="ยืนยันว่าเป็นคุณ" copy="เราได้ส่งรหัส 6 หลักไปยังเบอร์โทรที่คุณระบุ รหัสมีอายุจำกัดและใช้ได้ครั้งเดียว" foot="หากไม่ได้เป็นผู้ร้องขอ ไม่ต้องกรอกรหัส">
    <form className="auth-card" onSubmit={submit}><h2>กรอกรหัส OTP</h2><p>{heading}</p>{ready && !flow && <div className="notice warning"><b>!</b><div><strong>ไม่พบคำขอ OTP</strong>กรุณากลับไปกรอกเบอร์โทรศัพท์และขอรหัสใหม่</div></div>}{flow?.deliveredTo && <p className="small muted">ส่งรหัสไปยัง {flow.deliveredTo}</p>}<div className="otp-grid">{Array.from({ length: 6 }, (_, index) => <input key={index} inputMode="numeric" autoComplete={index === 0 ? "one-time-code" : "off"} maxLength={1} value={otp[index] ?? ""} aria-label={`OTP หลักที่ ${index + 1}`} onChange={(event) => { const digit = event.target.value.replace(/\D/g, "").slice(0, 1); setOtp(`${otp.slice(0, index)}${digit}${otp.slice(index + 1)}`.slice(0, 6)); setError(""); }} />)}</div>{needsPassword && <div className="field" style={{ marginTop: 16 }}><label htmlFor="otp-password">รหัสผ่านใหม่</label><input id="otp-password" className="input" type="password" autoComplete="new-password" value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} /></div>}{needsPassword && <div className="field" style={{ marginTop: 14 }}><label htmlFor="otp-confirm">ยืนยันรหัสผ่านใหม่</label><input id="otp-confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(event) => { setConfirm(event.target.value); setError(""); }} /></div>}<div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }} className="small"><span className="muted">{flow?.retryAfterSeconds ? `ขอรหัสใหม่ได้ในประมาณ ${flow.retryAfterSeconds} วินาที` : "OTP ใช้ได้ครั้งเดียว"}</span><Link className="text-link" href={flow ? CHANGE_PHONE_LINK[flow.purpose] : "/login"}>เปลี่ยนเบอร์</Link></div><div className="field-error">{error}</div><button className={`button lime block ${otp.length === 6 && flow && !submitting ? "" : "disabled"}`} type="submit" disabled={otp.length !== 6 || !flow || submitting} style={{ marginTop: 20 }}>{submitting ? "กำลังยืนยัน…" : "ยืนยัน OTP →"}</button></form>
  </AuthShell>;
}
