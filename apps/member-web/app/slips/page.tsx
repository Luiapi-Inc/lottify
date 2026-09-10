"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

const rows = [
  { date: "10 ก.ย. 11:31", lottery: "สลากกินแบ่งรัฐบาล", draw: "16 ก.ย. 2569", lines: 2, amount: "150.00 บาท", state: "รอผล", tone: "info", href: "/buy/receipt" },
  { date: "10 ก.ย. 09:42", lottery: "หวยลาวพัฒนา", draw: "10 ก.ย. 2569", lines: 1, amount: "100.00 บาท", state: "รอผล", tone: "info", href: "/slips/detail" },
  { date: "9 ก.ย. 20:15", lottery: "ฮานอยพิเศษ", draw: "9 ก.ย. 2569", lines: 3, amount: "300.00 บาท", state: "ถูกรางวัล", tone: "success", href: "/slips/detail" },
  { date: "8 ก.ย. 18:02", lottery: "ฮานอยปกติ", draw: "8 ก.ย. 2569", lines: 2, amount: "200.00 บาท", state: "แก้ไขผลแล้ว", tone: "warning", href: "/slips/detail#correction" },
] as const;

export default function SlipsPage() {
  const [lottery, setLottery] = useState("ทั้งหมด");
  const [status, setStatus] = useState("ทั้งหมด");
  const filtered = useMemo(
    () => rows.filter((row) => (lottery === "ทั้งหมด" || row.lottery === lottery) && (status === "ทั้งหมด" || row.state === status)),
    [lottery, status],
  );

  return <main id="main">
    <div className="page-head">
      <div><h1>โพยของฉัน</h1><p>ค้นหาและตรวจสอบใบรับรายการ ผล การคืนเงิน การยกเลิก และประวัติการแก้ไขผลของแต่ละโพย</p></div>
      <Link className="button primary" href="/buy">+ ซื้อหวย</Link>
    </div>
    <section className="panel">
      <div className="filters">
        <div className="field"><label htmlFor="slip-period">ช่วงเวลา</label><select id="slip-period" className="select"><option>30 วันล่าสุด</option><option>7 วันล่าสุด</option><option>เดือนนี้</option></select></div>
        <div className="field"><label htmlFor="slip-lottery">หวย</label><select id="slip-lottery" className="select" value={lottery} onChange={(event) => setLottery(event.target.value)}><option>ทั้งหมด</option><option>สลากกินแบ่งรัฐบาล</option><option>หวยลาวพัฒนา</option><option>ฮานอยพิเศษ</option><option>ฮานอยปกติ</option></select></div>
        <div className="field"><label htmlFor="slip-status">สถานะ</label><select id="slip-status" className="select" value={status} onChange={(event) => setStatus(event.target.value)}><option>ทั้งหมด</option><option>รอผล</option><option>ถูกรางวัล</option><option>แก้ไขผลแล้ว</option></select></div>
        <button className="button secondary" type="button" onClick={() => { setLottery("ทั้งหมด"); setStatus("ทั้งหมด"); }}>ล้างตัวกรอง</button>
      </div>
    </section>
    <section className="panel" style={{ marginTop: 18 }}>
      <div className="panel-title"><h2>รายการล่าสุด</h2><span className="muted small">แสดง {filtered.length} โพย</span></div>
      <div className="table-wrap"><table><thead><tr><th>วัน / เวลา</th><th>หวย / งวด</th><th>รายการ</th><th>ยอดซื้อ</th><th>สถานะ</th><th /></tr></thead><tbody>
        {filtered.map((row) => <tr key={`${row.date}-${row.lottery}`}><td>{row.date}</td><td><strong>{row.lottery}</strong><br /><span className="muted">{row.draw}</span></td><td>{row.lines} รายการ</td><td>{row.amount}</td><td><span className={`status ${row.tone}`}>{row.state}</span></td><td><Link className="text-link" href={row.href}>ดูรายละเอียด →</Link></td></tr>)}
      </tbody></table></div>
    </section>
  </main>;
}
