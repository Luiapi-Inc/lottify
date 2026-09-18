"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "../components/auth-shell";
import { AuthFormIntro, AuthorityCallout } from "../components/workflow";
import { MemberApiFailure, memberApi } from "../lib/member-api";
import { loginLandingTarget } from "../lib/login-landing";
import { MEMBER_PASSWORD_MIN_LENGTH } from "../lib/password-policy";

function describeLoginError(failure: MemberApiFailure): { message: string; route?: string } | null {
  switch (failure.code) {
    case "MEMBER_CREDENTIALS_INVALID":
      return { message: "เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง" };
    case "PHONE_INVALID":
      return { message: "กรอกเบอร์โทรศัพท์ให้ถูกต้อง" };
    case "PASSWORD_ENROLLMENT_REQUIRED":
      return { message: "บัญชีนี้ยังไม่มีรหัสผ่าน กรุณาตั้งรหัสผ่านก่อนเข้าใช้งาน", route: "/enroll" };
    case "MEMBER_LOGIN_LOCKED": {
      const seconds = typeof failure.details?.retryAfterSeconds === "number"
        ? failure.details.retryAfterSeconds
        : undefined;
      return {
        message: seconds
          ? `พยายามเข้าสู่ระบบผิดพลาดหลายครั้ง กรุณาลองใหม่ในอีกประมาณ ${seconds} วินาที`
          : "พยายามเข้าสู่ระบบผิดพลาดหลายครั้ง กรุณาลองใหม่ภายหลัง",
      };
    }
    case "ACCOUNT_DISABLED":
      return { message: "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อเจ้าหน้าที่" };
    default:
      return null;
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (phone.replace(/\D/g, "").length < 9) {
      setError("กรอกเบอร์โทรศัพท์ให้ถูกต้อง");
      return;
    }
    if (password.length < MEMBER_PASSWORD_MIN_LENGTH) {
      setError(`รหัสผ่านต้องมีอย่างน้อย ${MEMBER_PASSWORD_MIN_LENGTH} ตัวอักษร`);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await memberApi.login(phone, password);
      // Return the member to the member area they were denied by the session
      // guard (`/login?next=…`); anything that is not an in-app path falls back
      // to the home area.
      //
      // This MUST be a real document request, not `router.push`: while the
      // visitor was logged out the client router cached the guard's `307` for
      // the member areas (the auth shell prefetches `/`), so a client-side
      // navigation would replay that cached redirect — zero requests on the
      // wire, the session cookie login just issued never consulted, and the
      // member stranded on `/login?next=%2F`.
      window.location.assign(loginLandingTarget(window.location.search));
    } catch (requestError) {
      const mapped = requestError instanceof MemberApiFailure ? describeLoginError(requestError) : null;
      if (mapped?.route) {
        router.push(mapped.route);
        return;
      }
      setError(mapped?.message ?? (requestError instanceof Error ? requestError.message : "ไม่สามารถเข้าสู่ระบบได้"));
    } finally {
      setSubmitting(false);
    }
  };
  return <AuthShell title={<>ทุกโพย<br />ตรวจสอบได้ทุกขั้นตอน</>} copy="เข้าถึงการซื้อหวย กระเป๋า ใบรับรายการ โปรโมชั่น และความปลอดภัยจากบัญชีเดียว" foot="Lottify Member">
    <form className="auth-card" onSubmit={submit}><AuthFormIntro step="SECURE MEMBER ACCESS" title="เข้าสู่ระบบ" description="ใช้เบอร์โทรศัพท์และรหัสผ่านของบัญชี Lottify ระบบจะยืนยัน session จาก API ก่อนเปิดพื้นที่สมาชิก" /><AuthorityCallout>Access token อยู่ในหน่วยความจำของ Member API client และ session แบบ durable กู้คืนผ่าน secure refresh-cookie bridge ไม่เก็บ access token ใน localStorage</AuthorityCallout><div className="field" style={{ marginTop: 18 }}><label htmlFor="phone">เบอร์โทรศัพท์</label><input id="phone" className="input" inputMode="tel" autoComplete="tel" placeholder="08X-XXX-XXXX" value={phone} onChange={(event) => { setPhone(event.target.value); setError(""); }} /></div><div className="field" style={{ marginTop: 14 }}><label htmlFor="password">รหัสผ่าน</label><input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} /></div><div className="field-error">{error}</div><button className={`button lime block ${submitting ? "disabled" : ""}`} type="submit" disabled={submitting} style={{ marginTop: 16 }}>{submitting ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ →"}</button><div className="divider">หรือ</div><Link className="button secondary block" href="/register">สร้างบัญชีใหม่</Link><p className="small muted" style={{ marginTop: 16, textAlign: "center" }}><Link className="text-link" href="/forgot-password">ลืมรหัสผ่าน?</Link></p></form>
  </AuthShell>;
}
