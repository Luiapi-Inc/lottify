"use client";

import Link from "next/link";
import { useState } from "react";

const products = [
  { filter: "thai", icon: "th", code: "TH", title: "สลากกินแบ่งรัฐบาล", detail: "งวด 16 ก.ย. 2569 · ปิดรับ 15:15 น. · เวลาไทย", countdown: "02:00:34" },
  { filter: "laos", icon: "la", code: "LA", title: "หวยลาวพัฒนา", detail: "งวด 10 ก.ย. 2569 · ปิดรับ 20:00 น. · เวียงจันทน์", countdown: "05:14:00" },
  { filter: "vietnam", icon: "vn", code: "VN", title: "ฮานอยพิเศษ", detail: "งวด 10 ก.ย. 2569 · ปิดรับ 17:15 น. · ฮานอย", countdown: "02:21:00" },
  { filter: "vietnam", icon: "vn", code: "VN", title: "ฮานอยปกติ", detail: "งวด 10 ก.ย. 2569 · ปิดรับ 18:15 น. · ฮานอย", countdown: "03:21:00" },
];

export default function BuyPage() {
  const [filter, setFilter] = useState("all");
  return <main id="main">
    <div className="page-head"><div><div className="breadcrumb"><Link href="/">หน้าแรก</Link><span>/</span><span>ซื้อหวย</span></div><h1>เลือกหวยและงวด</h1><p>เลือกงวดที่ยังเปิดรับ ระบบจะแสดงเวลาปิดรับ อัตราจ่ายพื้นฐาน และข้อจำกัดก่อนเริ่มกรอกเลข</p></div></div>
    <div className="stepper"><div className="step active"><strong>1 · เลือกงวด</strong>Product และ Draw</div><div className="step"><strong>2 · ใส่เลข</strong>Bet Type และจำนวนเงิน</div><div className="step"><strong>3 · ตรวจ Quote</strong>ราคาและแหล่งเงิน</div><div className="step"><strong>4 · ยืนยัน</strong>รับใบรับรายการ</div></div>
    <div className="section-tabs">{([ ["all","ทั้งหมด"], ["thai","หวยไทย"], ["laos","หวยลาว"], ["vietnam","หวยเวียดนาม"] ] as const).map(([value,label]) => <button key={value} className={`tab ${filter === value ? "active" : ""}`} type="button" onClick={() => setFilter(value)} aria-pressed={filter === value}>{label}</button>)}</div>
    <section className="grid-2">
      <div className="panel"><div className="panel-title"><h2>งวดที่เปิดรับ</h2><span className="status success">เปิดรับ {products.filter((p) => filter === "all" || p.filter === filter).length} งวด</span></div><div className="product-list">
        {products.filter((product) => filter === "all" || product.filter === filter).map((product) => <Link className="product-card" href="/buy/bet" key={product.title}><div className={`lottery-icon ${product.icon}`}>{product.code}</div><div><h3>{product.title}</h3><p>{product.detail}</p></div><div className="product-meta"><div className="countdown">{product.countdown}</div><span className="button primary">เลือกงวด</span></div></Link>)}
      </div></div>
      <aside className="stack"><section className="panel"><div className="panel-title"><h2>ก่อนเลือกงวด</h2></div><div className="notice info"><b>i</b><div><strong>เวลาปิดรับเป็นเวลาที่ระบบยืนยัน</strong>เมื่อถึง cutoff จะไม่สามารถสร้าง Quote หรือยืนยันรายการใหม่ได้</div></div><div className="notice warning" style={{ marginTop: 10 }}><b>!</b><div><strong>อัตราจ่ายอาจเปลี่ยนก่อน Quote</strong>คุณจะเห็นอัตราจ่ายที่ยอมรับจริงอีกครั้งในหน้าตรวจ Quote</div></div></section><section className="panel"><div className="panel-title"><h2>โพยที่ทำค้างไว้</h2></div><div className="menu-row"><div className="menu-icon">S</div><div><strong>สลากกินแบ่งรัฐบาล</strong><span>6 รายการ · 450 บาท</span></div><Link className="text-link" href="/buy/bet">ทำต่อ →</Link></div></section></aside>
    </section>
  </main>;
}
