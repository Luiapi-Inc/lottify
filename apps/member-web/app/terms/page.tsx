"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "../components/auth-shell";
import { memberApi, type MemberTermsResponse } from "../lib/member-api";

export default function TermsPage() {
  const router = useRouter();
  const [fromAccount, setFromAccount] = useState(false);
  const [terms, setTerms] = useState<MemberTermsResponse | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const account = params.get("from") === "account";
    setFromAccount(account);
    memberApi.getTerms()
      .then((result) => {
        setTerms(result);
        setAccepted(result.satisfied);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "โหลดข้อตกลงไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!terms) return setError("ยังไม่มีข้อมูลข้อตกลงจากระบบ");
    const pending = terms.required.filter((entry) => !entry.accepted);
    if (pending.length > 0 && !accepted) return setError("กรุณาอ่านและยืนยันการยอมรับก่อนดำเนินการต่อ");
    if (pending.length === 0) {
      router.push(fromAccount ? "/account" : "/profile");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      for (const entry of pending) await memberApi.acceptTerms(entry.documentId);
      const refreshed = await memberApi.getTerms();
      setTerms(refreshed);
      if (!refreshed.satisfied) {
        setAccepted(false);
        setError("ยังมีข้อตกลงที่ต้องยอมรับ กรุณาตรวจรายการอีกครั้ง");
        return;
      }
      try { window.localStorage.setItem("lottify-onboarding-terms", "accepted"); } catch {}
      router.push(fromAccount ? "/account" : "/profile");
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "บันทึกการยอมรับไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  };
  const pendingCount = terms?.required.filter((entry) => !entry.accepted).length ?? 0;
  return <AuthShell title="อ่านก่อนใช้บริการ" copy="หลังยืนยันเบอร์ ระบบจะให้คุณตรวจและยอมรับข้อตกลงที่จำเป็นตามเวอร์ชันที่มีผล ก่อนกรอกข้อมูลพื้นฐานและประเมินสิทธิ์ของแต่ละบริการ" foot={fromAccount ? "ข้อตกลงของบัญชี" : "ขั้นตอน 3 จาก 5 · ข้อตกลง"}>
    <form className="auth-card onboarding-card" onSubmit={submit}><div className="onboarding-step">{fromAccount ? "ตรวจสถานะข้อตกลง" : "บัญชีถูกสร้างแล้ว"}</div><h2>ข้อตกลงและนโยบายที่จำเป็น</h2>{loading && <div className="notice info"><b>i</b><div><strong>กำลังโหลดข้อตกลง</strong>กำลังตรวจเวอร์ชันที่มีผลกับบัญชีนี้จากระบบ</div></div>}{terms?.required.map((entry) => <article className="terms-review-card" key={entry.documentId}><div><strong>{entry.title}</strong><span>เวอร์ชัน {entry.version} · Policy {entry.policyVersion}</span><p style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>{entry.body}</p></div><span className={`status ${entry.accepted ? "success" : "info"}`}>{entry.accepted ? "ยอมรับแล้ว" : "รอยอมรับ"}</span></article>)}{terms && terms.required.length === 0 && <div className="notice success"><b>✓</b><div><strong>ไม่มีข้อตกลงค้างยอมรับ</strong>บัญชีนี้ไม่มีเอกสารที่ต้องยอมรับเพิ่มเติมในขณะนี้</div></div>}
      {terms && pendingCount > 0 && <label className="terms-accept-row"><input type="checkbox" checked={accepted} disabled={submitting} onChange={(event) => { setAccepted(event.target.checked); setError(""); }} /><span>ฉันได้อ่านและยอมรับข้อตกลงทุกเวอร์ชันที่ระบบแสดงสำหรับบัญชีนี้</span></label>}<div className="notice info" style={{ marginTop: 14 }}><b>i</b><div><strong>การยอมรับถูกบันทึกแยกจาก KYC</strong>การยอมรับ Terms ไม่ได้หมายความว่าทุกบริการพร้อมใช้ และไม่ถือเป็นการยืนยันตัวตนระดับ KYC</div></div><div className="field-error">{error}</div><button className={`button lime block ${!loading && terms && (pendingCount === 0 || accepted) && !submitting ? "" : "disabled"}`} type="submit" disabled={loading || !terms || (pendingCount > 0 && !accepted) || submitting} style={{ marginTop: 8 }}>{submitting ? "กำลังบันทึก…" : pendingCount === 0 ? (fromAccount ? "กลับบัญชี" : "ดำเนินการต่อ →") : (fromAccount ? "บันทึกและกลับบัญชี" : "ยอมรับและดำเนินการต่อ →")}</button><p className="small muted" style={{ marginTop: 16, textAlign: "center" }}>{fromAccount ? <Link className="text-link" href="/account">กลับบัญชี</Link> : <Link className="text-link" href="/login">ออกจากขั้นตอนสมัคร</Link>}</p></form>
  </AuthShell>;
}
