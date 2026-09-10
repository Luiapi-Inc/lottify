"use client";

import Link from "next/link";
import { useState } from "react";

export default function WithdrawPage() {
  const [amount, setAmount] = useState(3000);
  return <main id="main">
    <div className="breadcrumb"><Link href="/wallet">กระเป๋า</Link><span>/</span><span>ถอนเงิน</span></div>
    <div className="page-head"><div><h1>ถอนเงิน</h1><p>ตรวจยอดเงินสดที่ถอนได้ ปลายทาง ค่าธรรมเนียม และเงื่อนไขการยืนยันตัวตนก่อนส่งคำขอ</p></div></div>
    <section className="grid-2"><div className="stack">
      <section className="panel"><div className="panel-title"><h2>ปลายทางรับเงิน</h2><Link href="/account/bank-account">จัดการบัญชีธนาคาร →</Link></div><div className="method active"><strong>ธนาคารกสิกรไทย · •••• 4821</strong><span>ชื่อบัญชี: คุณสมาชิก · ยืนยันแล้ว</span></div></section>
      <section className="panel"><div className="panel-title"><h2>จำนวนเงินที่ต้องการถอน</h2></div><div className="field"><label htmlFor="withdraw-amount">จำนวนเงิน</label><input id="withdraw-amount" className="input large" type="number" value={amount} min={300} max={12330} onChange={(event) => setAmount(Number(event.target.value))} /><div className="amount-chips">{[500,1000,3000,5000].map((value) => <button className={`chip-btn ${amount === value ? "active" : ""}`} type="button" key={value} onClick={() => setAmount(value)}>{value.toLocaleString("th-TH")}</button>)}</div><div className="hint">ยอดเงินสดที่ถอนออกได้ 12,330.00 บาท · โบนัส 300.00 บาทไม่รวมในยอดที่ถอนได้</div></div></section>
      <div className="notice warning"><b>!</b><div><strong>ต้องยืนยันตัวตนก่อนถอนครั้งแรก</strong>ระบบจะพาคุณไปทำขั้นตอนที่จำเป็นโดยเก็บเฉพาะข้อมูลร่างที่ปลอดภัย</div></div>
    </div><aside className="stack"><section className="summary-box"><div className="summary-row"><span>ยอดถอน</span><strong>{amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท</strong></div><div className="summary-row"><span>ค่าธรรมเนียม</span><strong>0.00 บาท</strong></div><div className="summary-row"><span>ปลายทาง</span><strong>กสิกรไทย ••••4821</strong></div><div className="summary-row total"><span>จะได้รับ</span><strong>{amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท</strong></div><Link className={`button lime block ${amount >= 300 && amount <= 12330 ? "" : "disabled"}`} href={amount >= 300 && amount <= 12330 ? "/wallet/withdraw/status" : "#"} aria-disabled={amount < 300 || amount > 12330} style={{ marginTop: 12 }}>ตรวจเงื่อนไขและยืนยัน →</Link></section><div className="notice info"><b>i</b><div><strong>หลังยืนยัน ยอดจะถูกพักไว้</strong>หากผู้ให้บริการมีผลไม่ชัดเจน ระบบจะคงยอดพักไว้ระหว่างตรวจสอบและไม่คืนเงินอัตโนมัติจนทราบผลแน่นอน</div></div></aside></section>
  </main>;
}
