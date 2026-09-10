"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "../components/auth-shell";
import { clearAuthFlow, readAuthFlow, type PendingAuthFlow } from "../lib/auth-flow";
import { memberApi } from "../lib/member-api";

export default function OtpPage() {
  const router = useRouter();
  const [otp, setOtp] = useState("");
  const [flow, setFlow] = useState<PendingAuthFlow | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setFlow(readAuthFlow());
    setReady(true);
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (otp.length !== 6) return setError("กรอกรหัส OTP ให้ครบ 6 หลัก");
    if (!flow) return setError("ไม่พบข้อมูลคำขอ OTP กรุณาขอรหัสใหม่");
    setSubmitting(true);
    setError("");
    try {
      await memberApi.verifyOtp(flow.purpose, flow.phone, otp);
      if (flow.purpose === "LOGIN") {
        clearAuthFlow();
        router.push("/");
        return;
      }
      try {
        window.localStorage.setItem("lottify-onboarding-phone", "verified");
        if (flow.ref) window.localStorage.setItem("lottify-referral-code", flow.ref);
      } catch {}
      clearAuthFlow();
      router.push("/terms");
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "ยืนยัน OTP ไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  };
  return <AuthShell title="ยืนยันว่าเป็นคุณ" copy="เราได้ส่งรหัส 6 หลักไปยังเบอร์โทรที่คุณระบุ รหัสมีอายุจำกัดและใช้ได้ครั้งเดียว" foot="หากไม่ได้เป็นผู้ร้องขอ ไม่ต้องกรอกรหัส">
    <form className="auth-card" onSubmit={submit}><h2>กรอกรหัส OTP</h2><p>{flow?.purpose === "LOGIN" ? "ยืนยันเพื่อเข้าสู่ระบบ" : "ขั้นตอน 2 จาก 5 · กรอกรหัส 6 หลักที่ได้รับทาง SMS"}</p>{ready && !flow && <div className="notice warning"><b>!</b><div><strong>ไม่พบคำขอ OTP</strong>กรุณากลับไปกรอกเบอร์โทรศัพท์และขอรหัสใหม่</div></div>}{flow?.deliveredTo && <p className="small muted">ส่งรหัสไปยัง {flow.deliveredTo}</p>}<div className="otp-grid">{Array.from({ length: 6 }, (_, index) => <input key={index} inputMode="numeric" autoComplete={index === 0 ? "one-time-code" : "off"} maxLength={1} value={otp[index] ?? ""} aria-label={`OTP หลักที่ ${index + 1}`} onChange={(event) => { const digit = event.target.value.replace(/\D/g, "").slice(0, 1); setOtp(`${otp.slice(0, index)}${digit}${otp.slice(index + 1)}`.slice(0, 6)); setError(""); }} />)}</div><div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }} className="small"><span className="muted">{flow?.retryAfterSeconds ? `ขอรหัสใหม่ได้ในประมาณ ${flow.retryAfterSeconds} วินาที` : "OTP ใช้ได้ครั้งเดียว"}</span><Link className="text-link" href={flow?.purpose === "LOGIN" ? "/login" : "/register"}>เปลี่ยนเบอร์</Link></div><div className="field-error">{error}</div><button className={`button lime block ${otp.length === 6 && flow && !submitting ? "" : "disabled"}`} type="submit" disabled={otp.length !== 6 || !flow || submitting} style={{ marginTop: 20 }}>{submitting ? "กำลังยืนยัน…" : "ยืนยัน OTP →"}</button></form>
  </AuthShell>;
}
