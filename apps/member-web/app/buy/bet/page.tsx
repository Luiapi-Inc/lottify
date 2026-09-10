"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type BetLine = { number: string; amount: number; mergedCount: number };

function permutations(value: string) {
  const result = new Set<string>();
  const walk = (prefix: string, rest: string) => {
    if (!rest.length) return void result.add(prefix);
    [...rest].forEach((digit, index) => walk(prefix + digit, rest.slice(0, index) + rest.slice(index + 1)));
  };
  walk("", value);
  return [...result];
}

export default function BetPage() {
  const [betType, setBetType] = useState("3 ตัวตรง · จ่าย x900");
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState(100);
  const [bulk, setBulk] = useState("");
  const [lines, setLines] = useState<BetLine[]>([]);
  const [feedback, setFeedback] = useState("ตัวช่วยจะแตกเป็นเลขจริงและแสดงใน “รายการของคุณ” ก่อน Quote");
  const [error, setError] = useState("");
  const digits = betType.includes("2 ตัว") ? 2 : 3;
  const total = useMemo(() => lines.reduce((sum, line) => sum + line.amount, 0), [lines]);

  const addNumbers = (numbers: string[]) => {
    setLines((current) => {
      const next = current.map((line) => ({ ...line }));
      let merged = 0;
      for (const item of numbers) {
        const existing = next.find((line) => line.number === item);
        if (existing) { existing.amount += amount; existing.mergedCount += 1; merged += 1; }
        else next.push({ number: item, amount, mergedCount: 1 });
      }
      setFeedback(merged ? `เพิ่ม ${numbers.length} เลข · รวมเลขซ้ำ ${merged} รายการ` : `เพิ่ม ${numbers.length} เลขลงรายการแล้ว`);
      return next;
    });
  };

  const validate = (value: string) => new RegExp(`^\\d{${digits}}$`).test(value);
  const addSingle = () => {
    if (!validate(number)) return setError(`กรอกเลข ${digits} หลักให้ตรงกับประเภทที่เลือก`);
    if (!Number.isFinite(amount) || amount < 10) return setError("จำนวนเงินขั้นต่ำ 10 บาทต่อรายการ");
    setError(""); addNumbers([number]); setNumber("");
  };
  const runHelper = (action: "reverse" | "permute" | "run-front" | "run-back") => {
    if (amount < 10) return setError("จำนวนเงินขั้นต่ำ 10 บาทต่อรายการ");
    let generated: string[] = [];
    if (action === "reverse" || action === "permute") {
      if (!validate(number)) return setError(`กรอกเลข ${digits} หลักก่อนใช้ตัวช่วยนี้`);
      generated = action === "reverse" ? [number.split("").reverse().join("")] : permutations(number);
    } else {
      if (digits !== 2) return setError("รูดหน้า/รูดหลังใช้กับประเภท 2 ตัว");
      if (!/^\d{1,2}$/.test(number)) return setError("กรอกอย่างน้อย 1 หลักก่อนใช้รูดหน้า/รูดหลัง");
      const fixed = action === "run-front" ? number[0] : number[number.length - 1];
      generated = Array.from({ length: 10 }, (_, index) => action === "run-front" ? `${fixed}${index}` : `${index}${fixed}`);
    }
    setError(""); addNumbers([...new Set(generated)]);
  };
  const addBulk = () => {
    const tokens = bulk.split(/[\s,]+/).map((token) => token.trim()).filter(Boolean);
    const valid = tokens.filter(validate);
    if (!valid.length) return setError(`ไม่พบเลข ${digits} หลักที่เพิ่มได้`);
    setError(tokens.length === valid.length ? "" : `ข้าม ${tokens.length - valid.length} รายการที่รูปแบบไม่ถูกต้อง`);
    addNumbers(valid); setBulk("");
  };

  return <main id="main">
    <div className="breadcrumb"><Link href="/">หน้าแรก</Link><span>/</span><Link href="/buy">ซื้อหวย</Link><span>/</span><span>ใส่เลข</span></div>
    <div className="page-head"><div><h1>สลากกินแบ่งรัฐบาล · งวด 16 ก.ย. 2569</h1><p>เลือกประเภท ใส่เลขและจำนวนเงิน ระบบจะรวมรายการที่ซ้ำกันก่อนสร้าง Quote</p></div><div className="countdown"><small>ปิดรับใน</small><span>02:00:34</span></div></div>
    <div className="stepper"><div className="step done"><strong>1 · เลือกงวด</strong>เลือกแล้ว</div><div className="step active"><strong>2 · ใส่เลข</strong>กำลังกรอก</div><div className="step"><strong>3 · ตรวจ Quote</strong>รอสร้าง</div><div className="step"><strong>4 · ยืนยัน</strong>รับใบรับรายการ</div></div>
    <section className="grid-2"><div className="stack">
      <section className="panel"><div className="panel-title"><h2>เพิ่มรายการ</h2><span className="status success">เปิดรับ</span></div>
        <div className="form-grid">
          <div className="field"><label htmlFor="bet-type">ประเภท</label><select id="bet-type" className="select" value={betType} onChange={(event) => { setBetType(event.target.value); setNumber(""); setError(""); }}><option>3 ตัวตรง · จ่าย x900</option><option>3 ตัวโต๊ด · จ่าย x150</option><option>2 ตัวบน · จ่าย x95</option><option>2 ตัวล่าง · จ่าย x95</option></select><div className="hint">อัตราจ่ายสุดท้ายจะยืนยันอีกครั้งตอน Quote · รูดหน้า/หลังใช้กับประเภท 2 ตัว</div></div>
          <div className="field number-entry"><label htmlFor="bet-number">เลข</label><input id="bet-number" className="input large" inputMode="numeric" maxLength={digits} value={number} onChange={(event) => setNumber(event.target.value.replace(/\D/g, "").slice(0, digits))} autoComplete="off" /><div className="number-keypad" aria-label="แป้นตัวเลขสำหรับกรอกเลข">{[1,2,3,4,5,6,7,8,9].map((key) => <button type="button" key={key} onClick={() => setNumber((value) => `${value}${key}`.slice(0, digits))}>{key}</button>)}<button type="button" className="keypad-action" onClick={() => setNumber("")}>ล้าง</button><button type="button" onClick={() => setNumber((value) => `${value}0`.slice(0, digits))}>0</button><button type="button" className="keypad-action keypad-delete" aria-label="ลบตัวเลขล่าสุด" onClick={() => setNumber((value) => value.slice(0, -1))}>⌫</button></div><div className="hint keypad-hint">แตะตัวเลขเพื่อกรอกได้ทันที หรือพิมพ์จากคีย์บอร์ดตามปกติ</div><div className="field-error">{error}</div></div>
          <div className="field"><label htmlFor="bet-amount">จำนวนเงินต่อรายการ</label><input id="bet-amount" className="input" type="number" min="10" value={amount} onChange={(event) => setAmount(Number(event.target.value))} /><div className="amount-chips">{[20,50,100,500].map((value) => <button className={`chip-btn ${amount === value ? "active" : ""}`} key={value} type="button" onClick={() => setAmount(value)}>{value}</button>)}</div><button className="button secondary block apply-all-button" type="button" onClick={() => setLines((current) => current.map((line) => ({ ...line, amount })))}>ใช้จำนวนนี้กับทุกเลข</button></div>
          <div className="field"><label>ตัวช่วย</label><div className="amount-chips helper-actions"><button className="chip-btn" type="button" onClick={() => runHelper("reverse")}>กลับเลข</button><button className="chip-btn" type="button" onClick={() => runHelper("permute")}>สลับเลข</button><button className="chip-btn" type="button" disabled={digits !== 2} onClick={() => runHelper("run-front")}>รูดหน้า</button><button className="chip-btn" type="button" disabled={digits !== 2} onClick={() => runHelper("run-back")}>รูดหลัง</button></div><div className="hint">{feedback}</div></div>
          <div className="field full bulk-entry"><label htmlFor="bet-bulk">เพิ่มหลายเลข</label><textarea id="bet-bulk" className="input bulk-input" rows={3} value={bulk} onChange={(event) => setBulk(event.target.value)} placeholder="วางเลขคั่นด้วยเว้นวรรค จุลภาค หรือขึ้นบรรทัดใหม่ เช่น 007 125 908" /><div className="bulk-entry-actions"><div className="hint">ระบบเก็บเลขศูนย์นำหน้า เช่น 007 และรวมเลขซ้ำให้เห็นเป็นรายการเดียว</div><button className="button secondary" type="button" onClick={addBulk}>เพิ่มหลายเลข</button></div></div>
          <div className="field full"><button className="button primary block" type="button" onClick={addSingle}>+ เพิ่มลงโพย</button></div>
        </div>
      </section>
      <section className="panel"><div className="panel-title"><h2>รายการของคุณ</h2><span className="status neutral">{lines.length} รายการ</span></div><div className="bet-lines">{lines.map((line, index) => <div className="bet-line" key={line.number}><div><span className="muted small">เลข</span><div className="bet-number">{line.number}</div>{line.mergedCount > 1 && <span className="merge-badge">รวม {line.mergedCount} รายการซ้ำ</span>}</div><div><span className="muted small">จำนวนเงิน</span><div><strong>{line.amount.toLocaleString("th-TH")} บาท</strong></div></div><div><span className="muted small">อัตราจ่าย</span><div className="payout">x{line.number.length === 3 ? 900 : 95}</div></div><button className="button secondary" type="button" onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>ลบ</button></div>)}</div></section>
    </div>
    <aside className="stack"><section className="summary-box"><div className="summary-row"><span>ยอดรายการ</span><strong>{total.toLocaleString("th-TH")} บาท</strong></div><div className="summary-row"><span>เงินสดที่ใช้ได้</span><strong>12,450.00 บาท</strong></div><div className="summary-row"><span>โบนัสที่ใช้ได้กับงวดนี้</span><strong>80.00 บาท</strong></div><div className="summary-row total"><span>ประมาณการยอดซื้อ</span><span>{total.toLocaleString("th-TH")} บาท</span></div><Link className={`button lime block ${lines.length ? "" : "disabled"}`} href={lines.length ? "/buy/quote" : "#"} aria-disabled={!lines.length} style={{ marginTop: 12 }}>สร้าง Quote และตรวจรายการ →</Link></section><section className="notice warning"><b>!</b><div><strong>เลขอั้นและข้อจำกัด</strong>ระบบจะตรวจ restriction และ exposure ล่าสุดตอนสร้าง Quote และตรวจซ้ำก่อน Confirm</div></section></aside>
    </section>
  </main>;
}
