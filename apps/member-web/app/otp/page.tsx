"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "../components/auth-shell";

export default function OtpPage() {
  const router = useRouter();
  const [otp, setOtp] = useState("1947");
  const [mode, setMode] = useState("register");
  const [ref, setRef] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setMode(params.get("mode") === "login" ? "login" : "register");
    setRef(params.get("ref")?.slice(0, 32) ?? "");
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (otp.length !== 6) return setError("กรอกรหัส OTP ให้ครบ 6 หลัก");
    setError("");
    if (mode === "login") { router.push("/"); return; }
    try { window.localStorage.setItem("lottify-onboarding-phone", "verified"); if (ref) window.localStorage.setItem("lottify-referral-code", ref); } catch {}
    router.push(`/terms${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`);
  };
  return <AuthShell title="ยืนยันว่าเป็นคุณ" copy="เราได้ส่งรหัส 6 หลักไปยังเบอร์โทรที่คุณระบุ รหัสมีอายุจำกัดและใช้ได้ครั้งเดียว" foot="หากไม่ได้เป็นผู้ร้องขอ ไม่ต้องกรอกรหัส">
    <form className="auth-card" onSubmit={submit}><h2>กรอกรหัส OTP</h2><p>{mode === "login" ? "ยืนยันเพื่อเข้าสู่ระบบ" : "ขั้นตอน 2 จาก 5 · กรอกรหัส 6 หลักที่ได้รับทาง SMS"}</p><div className="otp-grid">{Array.from({ length: 6 }, (_, index) => <input key={index} inputMode="numeric" maxLength={1} value={otp[index] ?? ""} aria-label={`OTP หลักที่ ${index + 1}`} onChange={(event) => { const digit = event.target.value.replace(/\D/g, "").slice(0, 1); setOtp(`${otp.slice(0, index)}${digit}${otp.slice(index + 1)}`.slice(0, 6)); setError(""); }} />)}</div><div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }} className="small"><span className="muted">ขอรหัสใหม่ได้ใน 00:42</span><Link className="text-link" href={mode === "login" ? "/login" : "/register"}>เปลี่ยนเบอร์</Link></div><div className="field-error">{error}</div><button className={`button lime block ${otp.length === 6 ? "" : "disabled"}`} type="submit" disabled={otp.length !== 6} style={{ marginTop: 20 }}>ยืนยัน OTP →</button></form>
  </AuthShell>;
}
