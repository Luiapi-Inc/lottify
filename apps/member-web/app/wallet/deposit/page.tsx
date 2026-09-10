"use client";

import Link from "next/link";
import { useState } from "react";

const methods = ["PromptPay QR", "โอนผ่านธนาคาร", "Mobile Banking"] as const;

export default function DepositPage() {
  const [method, setMethod] = useState<(typeof methods)[number]>("PromptPay QR");
  const [amount, setAmount] = useState(1000);
  return <main id="main">
    <div className="breadcrumb"><Link href="/wallet">กระเป๋า</Link><span>/</span><span>ฝากเงิน</span></div>
    <div className="page-head"><div><h1>ฝากเงิน</h1><p>เลือกช่องทางและจำนวนเงิน ตรวจค่าธรรมเนียมก่อนยืนยัน แล้วติดตามสถานะรายการเดิมจนเสร็จ</p></div></div>
    <section className="grid-2"><div className="stack">
      <section className="panel"><div className="panel-title"><h2>1. เลือกช่องทาง</h2></div><div className="payment-methods">{methods.map((item) => <button className={`method ${method === item ? "active" : ""}`} type="button" key={item} onClick={() => setMethod(item)}><strong>{item}</strong><span>{item === "PromptPay QR" ? "สแกนด้วยแอปธนาคาร · ปกติ 1–2 นาที" : item === "โอนผ่านธนาคาร" ? "บัญชีเฉพาะรายการ · ตรวจอัตโนมัติ" : "เปิดแอปธนาคารที่รองรับ"}</span></button>)}</div></section>
      <section className="panel"><div className="panel-title"><h2>2. ระบุจำนวนเงิน</h2></div><div className="field"><label htmlFor="deposit-amount">จำนวนเงิน</label><input id="deposit-amount" className="input large" type="number" value={amount} min={100} onChange={(event) => setAmount(Number(event.target.value))} /><div className="amount-chips">{[300,500,1000,3000,5000].map((value) => <button className={`chip-btn ${amount === value ? "active" : ""}`} type="button" key={value} onClick={() => setAmount(value)}>{value.toLocaleString("th-TH")}</button>)}</div></div></section>
    </div><aside className="stack"><section className="summary-box"><div className="summary-row"><span>ช่องทาง</span><strong>{method}</strong></div><div className="summary-row"><span>จำนวนฝาก</span><strong>{amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท</strong></div><div className="summary-row"><span>ค่าธรรมเนียม</span><strong>0.00 บาท</strong></div><div className="summary-row total"><span>ยอดชำระ</span><strong>{amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท</strong></div><Link className={`button lime block ${amount >= 100 ? "" : "disabled"}`} href={amount >= 100 ? "/wallet/deposit/status" : "#"} aria-disabled={amount < 100} style={{ marginTop: 12 }}>ยืนยันและรับคำแนะนำ →</Link></section><div className="notice info"><b>i</b><div><strong>อย่าสร้างรายการซ้ำหากยังรอตรวจสอบ</strong>สถานะ Pending จะอัปเดตรายการเดิมเมื่อผู้ให้บริการยืนยัน</div></div></aside></section>
  </main>;
}
