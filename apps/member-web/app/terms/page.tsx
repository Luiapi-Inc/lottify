"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "../components/auth-shell";

export default function TermsPage() {
  const router = useRouter();
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [fromAccount, setFromAccount] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const account = params.get("from") === "account";
    setFromAccount(account);
    try {
      setPhoneVerified(window.localStorage.getItem("lottify-onboarding-phone") === "verified" || account);
      setAccepted(window.localStorage.getItem("lottify-onboarding-terms") === "accepted" && account);
    } catch { setPhoneVerified(account); }
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!phoneVerified) return setError("ต้องยืนยันเบอร์โทรศัพท์ก่อนยอมรับข้อตกลง");
    if (!accepted) return setError("กรุณาอ่านและยืนยันการยอมรับก่อนดำเนินการต่อ");
    try { window.localStorage.setItem("lottify-onboarding-terms", "accepted"); } catch {}
    router.push(fromAccount ? "/account" : "/profile");
  };
  return <AuthShell title="อ่านก่อนใช้บริการ" copy="หลังยืนยันเบอร์ ระบบจะให้คุณตรวจและยอมรับข้อตกลงที่จำเป็นตามเวอร์ชันที่มีผล ก่อนกรอกข้อมูลพื้นฐานและประเมินสิทธิ์ของแต่ละบริการ" foot={fromAccount ? "ข้อตกลงของบัญชี" : "ขั้นตอน 3 จาก 5 · ข้อตกลง"}>
    <form className="auth-card onboarding-card" onSubmit={submit}><div className="onboarding-step">{fromAccount ? "ตรวจสถานะข้อตกลง" : "บัญชีถูกสร้างแล้ว"}</div><h2>ข้อตกลงและนโยบายที่จำเป็น</h2><p>หน้าจอนี้แสดงรูปแบบการยอมรับเท่านั้น เนื้อหาและเวอร์ชันจริงต้องมาจาก contract/policy ที่มีผลในระบบ</p><div className="terms-review-card"><div><strong>ข้อตกลงที่มีผลกับบัญชีนี้</strong><span>ระบบต้องแสดงเนื้อหาและเวอร์ชันที่ใช้อ้างอิงได้ก่อนยอมรับ</span></div><span className="status info">ต้องมี contract จริง</span></div>
      {!phoneVerified && <div className="notice warning" style={{ marginTop: 14 }}><b>!</b><div><strong>ยังยอมรับไม่ได้</strong>ยืนยันเบอร์โทรศัพท์ก่อน แล้วกลับมาหน้านี้เพื่อดำเนินการต่อ</div></div>}
      <label className="terms-accept-row"><input type="checkbox" checked={accepted} disabled={!phoneVerified} onChange={(event) => { setAccepted(event.target.checked); setError(""); }} /><span>ฉันได้อ่านและยอมรับข้อตกลงเวอร์ชันที่ระบบแสดงสำหรับบัญชีนี้</span></label><div className="notice info" style={{ marginTop: 14 }}><b>i</b><div><strong>การยอมรับถูกบันทึกแยกจาก KYC</strong>การยอมรับ Terms ไม่ได้หมายความว่าทุกบริการพร้อมใช้ และไม่ถือเป็นการยืนยันตัวตนระดับ KYC</div></div><div className="field-error">{error}</div><button className={`button lime block ${phoneVerified && accepted ? "" : "disabled"}`} type="submit" disabled={!phoneVerified || !accepted} style={{ marginTop: 8 }}>{fromAccount ? "บันทึกและกลับบัญชี" : "ยอมรับและดำเนินการต่อ →"}</button><p className="small muted" style={{ marginTop: 16, textAlign: "center" }}>{fromAccount ? <Link className="text-link" href="/account">กลับบัญชี</Link> : <Link className="text-link" href="/login">ออกจากขั้นตอนสมัคร</Link>}</p></form>
  </AuthShell>;
}
