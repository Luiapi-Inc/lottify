"use client";

import Link from "next/link";
import { useState } from "react";

type CancelState = "idle" | "review" | "pending" | "cancelled";

export default function ReceiptPage() {
  const [cancelState, setCancelState] = useState<CancelState>("idle");
  const cancelled = cancelState === "cancelled";

  return <main id="main">
    <section className="receipt panel">
      <div className="receipt-hero"><div className="success-check">✓</div><h1 style={{ margin: "0 0 7px" }}>ยืนยันรายการสำเร็จ</h1><p className="muted">ระบบยืนยันรายการแล้ว เก็บเลขอ้างอิงนี้ไว้สำหรับตรวจสอบภายหลัง</p><p className="receipt-ref">Order #ORD-20260910-843201 · ยืนยันเมื่อ 10 ก.ย. 2569 11:31:42 น.</p></div>
      <div className="receipt-grid">
        <div className="receipt-item"><span>หวย</span><strong>สลากกินแบ่งรัฐบาล</strong></div><div className="receipt-item"><span>งวด</span><strong>16 ก.ย. 2569</strong></div>
        <div className="receipt-item"><span>ประเภท / เลข</span><strong>3 ตัวตรง · 708</strong></div><div className="receipt-item"><span>ยอดซื้อ / อัตราจ่าย</span><strong>100 บาท · x900</strong></div>
        <div className="receipt-item"><span>ประเภท / เลข</span><strong>2 ตัวบน · 27</strong></div><div className="receipt-item"><span>ยอดซื้อ / อัตราจ่าย</span><strong>50 บาท · x95</strong></div>
        <div className="receipt-item"><span>เงินสดที่ใช้</span><strong>120.00 บาท</strong></div><div className="receipt-item"><span>โบนัสที่ใช้</span><strong>30.00 บาท</strong></div>
        <div className="receipt-item"><span>ปิดรับ</span><strong>16 ก.ย. 2569 · 15:15 น.</strong></div><div className="receipt-item"><span>สถานะ</span><span className={`status ${cancelled ? "neutral" : "info"}`}>{cancelled ? "ยกเลิกแล้ว" : "ยืนยันแล้ว · รอผล"}</span></div>
      </div>
      <div className="notice info" style={{ marginTop: 18 }}><b>i</b><div><strong>ใบรับรายการนี้เก็บเงื่อนไขที่ยอมรับไว้</strong>หากภายหลังมีการยกเลิก คืนเงิน หรือแก้ไขผล คุณจะเห็นประวัติเป็นลำดับโดยไม่ลบข้อมูลเดิม</div></div>
      {cancelled && <div className="cancel-history"><div className="panel-title"><h2>ประวัติการยกเลิก</h2></div><div className="stack"><div className="notice info"><b>1</b><div><strong>ยืนยันรายการ · 10 ก.ย. 11:31</strong>รับโพย ORD-20260910-843201 ยอดซื้อ 150.00 บาท</div></div><div className="notice warning"><b>2</b><div><strong>ขอยกเลิกโพย</strong>ระบบตรวจ cutoff และนโยบายการยกเลิกของงวดอีกครั้งก่อนคืนเงิน</div></div><div className="notice success"><b>3</b><div><strong>คืนเงินสำเร็จ · ยกเลิกแล้ว</strong>ยอดคืน 150.00 บาทถูกบันทึกแล้ว และโพยสิ้นสุดในสถานะยกเลิก</div></div></div></div>}
      <div className="receipt-actions">{!cancelled && <button className="button danger" type="button" onClick={() => setCancelState("review")}>ยกเลิกโพย</button>}<Link className="button secondary" href="/buy">ซื้อรายการใหม่</Link><Link className="button primary" href="/slips">ไปโพยของฉัน</Link><Link className="button secondary" href="/">กลับหน้าแรก</Link></div>
    </section>

    {cancelState !== "idle" && cancelState !== "cancelled" && <div className="cancel-overlay">
      <section className="cancel-sheet" role="dialog" aria-modal="true" aria-labelledby="cancel-title">
        {cancelState === "review" && <><button className="cancel-sheet-close" type="button" aria-label="ปิด" onClick={() => setCancelState("idle")}>×</button><span className="status warning">ก่อน cutoff</span><h2 id="cancel-title">ยกเลิกโพยนี้?</h2><p className="muted">ระบบจะตรวจนโยบายของหวย/งวดและเวลาปิดรับอีกครั้งก่อนรับคำขอ</p><div className="cancel-summary"><div><span>เลขอ้างอิง</span><strong>ORD-20260910-843201</strong></div><div><span>ยอดซื้อ</span><strong>150.00 บาท</strong></div><div><span>ปิดรับ</span><strong>16 ก.ย. 2569 · 15:15 น.</strong></div><div><span>ยอดคืนเมื่อสำเร็จ</span><strong>150.00 บาท</strong></div></div><div className="notice warning"><b>!</b><div><strong>การยกเลิกจะสมบูรณ์เมื่อคืนเงินสำเร็จ</strong>ระหว่างดำเนินการโพยจะแสดงสถานะ “กำลังยกเลิก” และยังไม่ถือว่ายกเลิกเสร็จ</div></div><div className="cancel-sheet-actions"><button className="button secondary" type="button" onClick={() => setCancelState("idle")}>ยังไม่ยกเลิก</button><button className="button danger" type="button" onClick={() => setCancelState("pending")}>ยืนยันยกเลิกโพย</button></div></>}
        {cancelState === "pending" && <div className="cancel-flow-state"><div className="cancel-state-icon pending">…</div><h2>กำลังยกเลิกโพย</h2><p>รับคำขอแล้ว กำลังยืนยันการคืนเงิน 150.00 บาท</p><div className="notice info"><b>i</b><div><strong>ยังไม่ถือว่ายกเลิกเสร็จ</strong>สถานะจะเปลี่ยนเป็น “ยกเลิกแล้ว” เมื่อยอดคืนถูกบันทึกสำเร็จ</div></div><div className="cancel-sheet-actions single"><button className="button primary" type="button" onClick={() => setCancelState("cancelled")}>จำลองคืนเงินสำเร็จ</button></div></div>}
      </section>
    </div>}
  </main>;
}
