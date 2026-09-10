"use client";

import Link from "next/link";
import { useState } from "react";

type QuoteState = "normal" | "expired" | "closed" | "changed" | "funds" | "eligibility";

const states: Array<{ value: QuoteState; label: string }> = [
  { value: "normal", label: "ปกติ" },
  { value: "expired", label: "Quote หมดอายุ" },
  { value: "closed", label: "งวดปิดแล้ว" },
  { value: "changed", label: "อัตราจ่ายเปลี่ยน" },
  { value: "funds", label: "เงินไม่พอ" },
  { value: "eligibility", label: "ติดเงื่อนไข" },
];

const failures: Record<Exclude<QuoteState, "normal">, { tone: "warning" | "danger"; title: string; body: string; action: string; href: string }> = {
  expired: {
    tone: "warning",
    title: "Quote หมดอายุแล้ว",
    body: "ราคานี้ใช้ยืนยันต่อไม่ได้ กรุณาสร้าง Quote ใหม่จากรายการเดิมและตรวจข้อมูลอีกครั้งก่อน Confirm",
    action: "สร้าง Quote ใหม่",
    href: "/buy/bet",
  },
  closed: {
    tone: "danger",
    title: "งวดนี้ปิดรับแล้ว",
    body: "ระบบหยุดการยืนยันรายการใหม่แล้ว กรุณากลับไปเลือกงวดที่ยังเปิดรับ",
    action: "เลือกงวดใหม่",
    href: "/buy",
  },
  changed: {
    tone: "warning",
    title: "เงื่อนไขสำคัญเปลี่ยนแปลง",
    body: "อัตราจ่ายหรือข้อจำกัดเปลี่ยนจาก Quote เดิม ระบบต้องสร้างข้อเสนอใหม่และให้คุณตรวจอีกครั้งก่อนยืนยัน",
    action: "ตรวจข้อเสนอใหม่",
    href: "/buy/bet",
  },
  funds: {
    tone: "danger",
    title: "ยอดเงินที่ใช้ได้ไม่เพียงพอ",
    body: "ยอดที่ใช้ยืนยันรายการนี้ไม่พอ กรุณาปรับยอดซื้อหรือจัดการกระเป๋าก่อนสร้าง Quote ใหม่",
    action: "ไปที่กระเป๋า",
    href: "/wallet",
  },
  eligibility: {
    tone: "warning",
    title: "ต้องดำเนินการเงื่อนไขบัญชีก่อน",
    body: "ระบบไม่สามารถยืนยันรายการได้จนกว่าข้อกำหนดของสิทธิ์ BET ที่เกี่ยวข้องจะครบ",
    action: "ตรวจความพร้อมบัญชี",
    href: "/account",
  },
};

export default function QuotePage() {
  const [state, setState] = useState<QuoteState>("normal");
  const [accepted, setAccepted] = useState(false);
  const failure = state === "normal" ? null : failures[state];
  const canConfirm = state === "normal" && accepted;

  return <main id="main">
    <div className="breadcrumb"><Link href="/">หน้าแรก</Link><span>/</span><Link href="/buy">ซื้อหวย</Link><span>/</span><Link href="/buy/bet">ใส่เลข</Link><span>/</span><span>Quote</span></div>
    <div className="page-head"><div><h1>ตรวจสอบข้อเสนอก่อนยืนยัน</h1><p>ราคา รายการ และแหล่งเงินด้านล่างคือข้อมูลที่ระบบยอมรับ ณ เวลาที่สร้าง Quote หากมีการเปลี่ยนแปลงสำคัญ คุณจะต้องตรวจใหม่ก่อนยืนยัน</p></div></div>
    <div className="stepper"><div className="step done"><strong>1 · เลือกงวด</strong>เลือกแล้ว</div><div className="step done"><strong>2 · ใส่เลข</strong>2 รายการ</div><div className="step active"><strong>3 · ตรวจ Quote</strong>{state === "normal" ? "เหลือเวลาจำกัด" : "ต้องดำเนินการ"}</div><div className="step"><strong>4 · ยืนยัน</strong>ยังไม่ยืนยัน</div></div>

    <section className="quote-demo panel" aria-label="ตัวอย่างสถานะ Quote">
      <div className="panel-title"><div><h2>ทดสอบสถานะ Quote</h2><p className="muted small">เลือกสถานการณ์เพื่อดูข้อความและ action ที่ Member จะได้รับ</p></div><span className="status info">Preview</span></div>
      <div className="quote-demo-actions">
        {states.map((item) => <button key={item.value} className={`chip-btn ${state === item.value ? "active" : ""}`} type="button" aria-pressed={state === item.value} onClick={() => { setState(item.value); setAccepted(false); }}>{item.label}</button>)}
      </div>
    </section>

    {failure && <div className={`quote-failure quote-failure-${failure.tone}`} aria-live="polite">
      <div className="quote-failure-icon">!</div>
      <div className="quote-failure-copy"><strong>{failure.title}</strong><span>{failure.body}</span></div>
      <div className="quote-failure-actions"><Link className="button secondary" href={failure.href}>{failure.action}</Link></div>
    </div>}

    <section className="quote-box">
      <div className="quote-head"><div><strong>Quote #QT-20260910-001842</strong><div className="small" style={{ color: "#cde4da", marginTop: 4 }}>สลากกินแบ่งรัฐบาล · งวด 16 ก.ย. 2569</div></div><div><div className="small" style={{ color: "#cde4da" }}>Quote หมดอายุใน</div><div className="quote-timer">00:01:58</div></div></div>
      <div className="quote-body">
        <div className="table-wrap"><table className="quote-lines"><thead><tr><th>ประเภท</th><th>เลข</th><th>อัตราจ่าย</th><th>ยอดซื้อ</th><th>เงินรางวัลสูงสุด</th></tr></thead><tbody><tr><td>3 ตัวตรง</td><td><strong>708</strong></td><td className="payout">x900</td><td>100 บาท</td><td>90,000 บาท</td></tr><tr><td>2 ตัวบน</td><td><strong>27</strong></td><td className="payout">x95</td><td>50 บาท</td><td>4,750 บาท</td></tr></tbody></table></div>
        <div className="grid-equal" style={{ marginTop: 18 }}>
          <div className="summary-box"><div className="summary-row"><span>ยอดซื้อรวม</span><strong>150.00 บาท</strong></div><div className="summary-row"><span>ใช้เงินสด</span><strong>120.00 บาท</strong></div><div className="summary-row"><span>ใช้โบนัส</span><strong>30.00 บาท</strong></div><div className="summary-row total"><span>ชำระรวม</span><strong>150.00 บาท</strong></div></div>
          <div className="stack"><div className="notice success"><b>✓</b><div><strong>ตรวจข้อจำกัดแล้ว</strong>รายการนี้ผ่านข้อจำกัดเลขและวงเงิน ณ เวลาสร้าง Quote</div></div><div className="notice info"><b>i</b><div><strong>ก่อน Confirm ระบบจะตรวจซ้ำอีกครั้ง</strong>หาก payout, cutoff, restriction หรือยอดเงินเปลี่ยน คุณจะต้องตรวจข้อเสนอใหม่</div></div></div>
        </div>
        <label className="quote-accept-row"><input type="checkbox" checked={accepted} disabled={state !== "normal"} onChange={(event) => setAccepted(event.target.checked)} /><span>ฉันตรวจเลข จำนวนเงิน อัตราจ่าย และแหล่งเงินเรียบร้อยแล้ว และต้องการยืนยันรายการนี้</span></label>
        <div className="quote-confirm-actions"><Link className="button secondary" href="/buy/bet">← แก้ไขรายการ</Link><Link className={`button lime ${canConfirm ? "" : "disabled"}`} href={canConfirm ? "/buy/receipt" : "#"} aria-disabled={!canConfirm}>ยืนยันซื้อ 150.00 บาท</Link></div>
      </div>
    </section>
  </main>;
}
