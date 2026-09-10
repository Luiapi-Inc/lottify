"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type FlowState = "closed" | "reauth" | "details" | "review" | "verified";
type Destination = { bank: string; account: string };

const mask = ({ bank, account }: Destination) => `${bank} ••••${account.slice(-4)}`;

export default function BankAccountPage() {
  const [current, setCurrent] = useState<Destination>({ bank: "กสิกรไทย", account: "4821" });
  const [flow, setFlow] = useState<FlowState>("closed");
  const [otp, setOtp] = useState("");
  const [draft, setDraft] = useState<Destination>({ bank: "", account: "" });
  const [error, setError] = useState("");
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("lottify-bank-destination");
      if (stored) setCurrent(JSON.parse(stored));
    } catch {}
  }, []);
  const close = () => { setFlow("closed"); setError(""); setOtp(""); setDraft({ bank: "", account: "" }); };
  const nextFromReauth = () => {
    if (otp.length !== 6) return setError("กรอกรหัส OTP ให้ครบ 6 หลักเพื่อยืนยันซ้ำ");
    setError(""); setFlow("details");
  };
  const nextFromDetails = () => {
    if (!draft.bank.trim() || !draft.account.trim()) return setError("กรอกธนาคารและเลขบัญชีรับเงินก่อนส่งตรวจ");
    setError(""); setFlow("review");
  };
  const verify = () => {
    setCurrent(draft);
    try { window.localStorage.setItem("lottify-bank-destination", JSON.stringify(draft)); } catch {}
    setFlow("verified");
  };
  const badge = flow === "details" ? ["info", "กรอกปลายทางใหม่"] : flow === "review" ? ["warning", "กำลังตรวจสอบ"] : flow === "verified" ? ["success", "ยืนยันแล้ว"] : ["warning", "ต้องยืนยันซ้ำ"];

  return <main id="main">
    <div className="breadcrumb"><Link href="/account">บัญชี</Link><span>/</span><span>บัญชีรับเงิน</span></div>
    <div className="page-head"><div><h1>บัญชีรับเงิน</h1><p>จัดการปลายทางรับเงินที่ยืนยันแล้ว การเพิ่มหรือเปลี่ยนปลายทางเป็นรายการสำคัญและอาจต้องยืนยันซ้ำก่อนส่งตรวจ</p></div><span className="status success">ยืนยันแล้ว</span></div>
    <section className="grid-2 account-verification-layout"><div className="stack">
      <section className="panel"><div className="panel-title"><h2>ปลายทางปัจจุบัน</h2></div><div className="bank-destination-card"><div className="bank-mark">{current.bank.trim().charAt(0).toUpperCase() || "B"}</div><div><strong>{mask(current)}</strong><span>ปลายทางปัจจุบัน · ผ่านการตรวจสำหรับการใช้งานในตัวอย่างนี้</span></div><span className="status success">ใช้งานได้</span></div><button className="button secondary block" type="button" onClick={() => { setFlow("reauth"); setOtp(""); setDraft({ bank: "", account: "" }); setError(""); }} style={{ marginTop: 14 }}>เปลี่ยนบัญชีรับเงิน</button></section>
      {flow !== "closed" && <section className="panel"><div className="panel-title"><h2>เปลี่ยนบัญชีรับเงิน</h2><span className={`status ${badge[0]}`}>{badge[1]}</span></div>
        {flow === "reauth" && <><div className="bank-flow-steps"><div className="bank-flow-step"><strong>1 · ยืนยันว่าเป็นคุณ</strong><span>รายการเปลี่ยนปลายทางมีความอ่อนไหว ระบบอาจขอ re-auth/OTP ตาม policy</span></div></div><div className="reauth-code">{Array.from({ length: 6 }, (_, index) => <input key={index} inputMode="numeric" maxLength={1} aria-label={`OTP สำหรับยืนยันซ้ำหลักที่ ${index + 1}`} value={otp[index] ?? ""} onChange={(event) => { const digit = event.target.value.replace(/\D/g, "").slice(0, 1); setOtp(`${otp.slice(0, index)}${digit}${otp.slice(index + 1)}`.slice(0, 6)); }} />)}</div><div className="field-error">{error}</div><div className="verification-actions"><button className="button primary" type="button" onClick={nextFromReauth}>ยืนยัน OTP →</button><button className="button secondary" type="button" onClick={close}>ยกเลิก</button></div></>}
        {flow === "details" && <><div className="bank-flow-steps"><div className="bank-flow-step"><strong>2 · ระบุบัญชีรับเงินใหม่</strong><span>OTP เป็นเพียง re-auth ขั้นตอนนี้ยังต้องระบุปลายทางใหม่และส่งให้ระบบตรวจแยกต่างหาก</span></div></div><div className="form-grid" style={{ marginTop: 14 }}><div className="field"><label htmlFor="bank-name">ธนาคาร</label><input id="bank-name" className="input" value={draft.bank} onChange={(event) => setDraft({ ...draft, bank: event.target.value })} placeholder="ชื่อธนาคาร" /></div><div className="field"><label htmlFor="bank-account">เลขบัญชีรับเงิน</label><input id="bank-account" className="input" inputMode="numeric" autoComplete="off" value={draft.account} onChange={(event) => setDraft({ ...draft, account: event.target.value.replace(/\D/g, "") })} placeholder="กรอกเลขบัญชี" /></div></div><div className="field-error">{error}</div><div className="verification-actions"><button className="button primary" type="button" onClick={nextFromDetails}>ตรวจข้อมูลก่อนส่ง →</button><button className="button secondary" type="button" onClick={close}>ยกเลิก</button></div></>}
        {flow === "review" && <><div className="bank-flow-steps"><div className="bank-flow-step"><strong>3 · ส่งปลายทางใหม่เพื่อตรวจแล้ว</strong><span>{mask(draft)} · OTP ผ่านแล้ว แต่ยังไม่ถือว่าปลายทางใหม่ได้รับอนุมัติ ระบบต้องตรวจ verification/risk/eligibility แยกอีกครั้ง</span></div><div className="bank-flow-step"><strong>ปลายทางเดิมยังคงใช้ได้</strong><span>ตัวอย่างนี้ไม่สลับปลายทางจนกว่าผลตรวจของปลายทางใหม่จะยืนยันแล้ว</span></div></div><div className="verification-actions" style={{ marginTop: 14 }}><button className="button secondary" type="button" onClick={verify}>จำลองผลตรวจผ่าน</button></div></>}
        {flow === "verified" && <><div className="notice success"><b>✓</b><div><strong>ปลายทางใหม่ผ่านการตรวจแล้ว</strong>{mask(current)} เป็นปลายทางปัจจุบันใน frontend preview และยังต้องผ่าน Withdrawal eligibility ณ เวลาจ่าย</div></div><div className="verification-actions" style={{ marginTop: 14 }}><button className="button secondary" type="button" onClick={close}>ปิด</button></div></>}
      </section>}
    </div><aside className="stack"><section className="panel"><div className="panel-title"><h2>การตรวจแยกกัน</h2></div><div className="notice info"><b>i</b><div><strong>ยืนยันปลายทาง ≠ KYC</strong>สถานะของบัญชีรับเงินเป็นคนละ verification กับ Member/KYC และระบบจะตรวจ eligibility ของปลายทางอีกครั้งก่อนจ่ายเงินจริง</div></div><div className="notice warning" style={{ marginTop: 10 }}><b>!</b><div><strong>OTP เป็นเพียง re-auth</strong>การกรอก OTP สำเร็จไม่ได้แปลว่าปลายทางใหม่ได้รับอนุมัติ ระบบยังต้องตรวจสถานะและ policy ของปลายทาง</div></div></section><Link className="button secondary block" href="/account">← กลับบัญชี</Link></aside></section>
  </main>;
}
