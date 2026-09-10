"use client";

import Link from "next/link";
import { useState } from "react";

type HistoryEvent = {
  id: number;
  tone: string;
  meta: string;
  badge: string;
  badgeTone: string;
  title: string;
  body: string;
  fact?: readonly [string, string];
  current?: boolean;
};

const history: HistoryEvent[] = [
  { id: 1, tone: "info", meta: "ผลเดิม · 8 ก.ย. 20:31", badge: "ประวัติเดิม", badgeTone: "neutral", title: "ประกาศผลครั้งแรก", body: "เลข 3 ตัว: 641 · เลข 2 ตัว: 41 และระบบคำนวณ outcome แรกจากผลฉบับนี้", fact: ["Outcome เดิม", "ไม่ถูกรางวัล"] },
  { id: 2, tone: "warning", meta: "แจ้งแก้ไขผล · 8 ก.ย. 20:47", badge: "Correction notice", badgeTone: "warning", title: "มีผลฉบับแก้ไขที่ได้รับการยืนยัน", body: "ระบบหยุดใช้ผลเดิมสำหรับการคำนวณต่อไป แต่ยังเก็บผลเดิมไว้ในประวัติของโพยนี้" },
  { id: 3, tone: "info", meta: "ชดเชยผลเดิม · 8 ก.ย. 20:49", badge: "Reversal / compensation", badgeTone: "info", title: "ผลทางการเงินเดิมถูกชดเชย", body: "ระบบบันทึกผลชดเชยของ outcome เดิมก่อนคำนวณใหม่ โดย Member เห็นผลกระทบทางธุรกิจแต่ไม่เห็นรายละเอียด debit/credit ภายใน Ledger" },
  { id: 4, tone: "info", meta: "คำนวณใหม่ · 8 ก.ย. 20:50", badge: "Recalculation", badgeTone: "info", title: "ประเมินโพยด้วยผลฉบับใหม่", body: "ผลฉบับใหม่: เลข 3 ตัว 640 · เลข 2 ตัว 40 และระบบคำนวณ outcome ใหม่จากใบรับรายการเดิม" },
  { id: 5, tone: "success", meta: "ผลปัจจุบัน · 8 ก.ย. 20:51", badge: "Authoritative ปัจจุบัน", badgeTone: "success", title: "โพยนี้ถูกรางวัล 99,500.00 บาท", body: "นี่คือ outcome ที่มีผลใช้งานปัจจุบัน หลัง correction, compensation และ recalculation เสร็จสมบูรณ์", fact: ["อ้างอิงสำหรับช่วยเหลือ", "SET-20260908-R2"], current: true },
];

export default function SlipDetailPage() {
  const [filter, setFilter] = useState<"all" | "current">("all");
  return <main id="main">
    <div className="breadcrumb"><Link href="/slips">โพยของฉัน</Link><span>/</span><span>ORD-20260908-148220</span></div>
    <div className="page-head"><div><h1>ฮานอยปกติ · งวด 8 ก.ย. 2569</h1><p>ใบรับรายการเดิมยังคงอยู่ครบ และการแก้ไขผลจะแสดงเป็นลำดับเหตุการณ์ใหม่โดยไม่เขียนทับประวัติเดิม</p></div><span className="status warning">มีประวัติการแก้ไข</span></div>
    <section className="grid-2">
      <div className="stack">
        <section className="panel"><div className="panel-title"><h2>ใบรับรายการ</h2><span className="small muted">ORD-20260908-148220</span></div><div className="table-wrap"><table><thead><tr><th>ประเภท</th><th>เลข</th><th>ยอดซื้อ</th><th>อัตราจ่ายที่รับ</th></tr></thead><tbody><tr><td>3 ตัวตรง</td><td><strong>640</strong></td><td>100 บาท</td><td>x900</td></tr><tr><td>2 ตัวบน</td><td><strong>40</strong></td><td>100 บาท</td><td>x95</td></tr></tbody></table></div><div className="summary-box" style={{ marginTop: 14 }}><div className="summary-row"><span>ยอดซื้อรวม</span><strong>200.00 บาท</strong></div><div className="summary-row"><span>เงินสด</span><strong>200.00 บาท</strong></div><div className="summary-row"><span>ยืนยันเมื่อ</span><strong>8 ก.ย. 2569 18:02 น.</strong></div></div></section>
        <section className="panel" id="correction">
          <div className="panel-title"><div><h2>ประวัติผลและการแก้ไข</h2><p className="small muted">แสดงตามลำดับเวลา · ประวัติเดิมไม่ถูกลบ</p></div><div className="section-tabs correction-tabs"><button className={`tab ${filter === "all" ? "active" : ""}`} type="button" onClick={() => setFilter("all")} aria-pressed={filter === "all"}>ทั้งหมด</button><button className={`tab ${filter === "current" ? "active" : ""}`} type="button" onClick={() => setFilter("current")} aria-pressed={filter === "current"}>ผลปัจจุบัน</button></div></div>
          <div className="correction-timeline">{history.filter((event) => filter === "all" || event.current).map((event) => <article className={`correction-event ${event.current ? "current" : ""}`} key={event.id}><div className={`correction-marker ${event.tone}`}>{event.id}</div><div className="correction-card"><div className="correction-meta"><span>{event.meta}</span><span className={`status ${event.badgeTone}`}>{event.badge}</span></div><h3>{event.title}</h3><p>{event.body}</p>{event.fact && <div className="correction-fact"><span>{event.fact[0]}</span><strong>{event.fact[1]}</strong></div>}</div></article>)}</div>
          <div className="notice info correction-note"><b>i</b><div><strong>ข้อมูลเดิมยังคงตรวจสอบย้อนหลังได้</strong>ระบบไม่แก้ข้อความหรือยอดของ Receipt/Settlement เดิมเพื่อทำให้ดูเหมือนไม่เคยเกิด correction</div></div>
        </section>
      </div>
      <aside className="stack"><section className="summary-box"><div className="summary-row"><span>สถานะปัจจุบัน</span><strong>ถูกรางวัล</strong></div><div className="summary-row"><span>ยอดซื้อ</span><strong>200.00 บาท</strong></div><div className="summary-row total"><span>เงินรางวัลปัจจุบัน</span><strong>99,500.00 บาท</strong></div><div className="summary-row"><span>ผล revision</span><strong>ฉบับแก้ไขที่ยืนยันแล้ว</strong></div></section><Link className="button secondary block" href="/slips">← กลับรายการโพย</Link></aside>
    </section>
  </main>;
}
