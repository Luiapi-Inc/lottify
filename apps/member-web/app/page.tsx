import Link from "next/link";

const draws = [
  ["th", "TH", "สลากกินแบ่งรัฐบาล", "งวดวันที่ 16 ก.ย. 2569 · ปิดรับ 15:15 น.", "02:00:34"],
  ["la", "LA", "หวยลาวพัฒนา", "งวดวันนี้ · ปิดรับ 20:00 น.", "05:14:00"],
  ["vn", "VN", "ฮานอยพิเศษ", "งวดวันนี้ · ปิดรับ 17:15 น.", "02:21:00"],
];

export default function HomePage() {
  return <main id="main">
    <div className="wallet-hero">
      <div className="wallet-hero-top"><h2>ยอดเงินในกระเป๋า</h2><Link className="button ghost" href="/wallet">จัดการกระเป๋า →</Link></div>
      <div className="wallet-grid">
        <div className="wallet-cell"><div className="wallet-label">เงินสด</div><div className="wallet-amount">12,450.00<small>บาท</small></div><div className="wallet-actions"><Link className="button secondary" href="/wallet/deposit">เติมเงิน</Link></div></div>
        <div className="wallet-cell"><div className="wallet-label">โบนัส</div><div className="wallet-amount">300.00<small>บาท</small></div><div className="wallet-actions"><Link className="button secondary" href="/promotions">ดูเงื่อนไข</Link></div></div>
        <div className="wallet-cell"><div className="wallet-label">ยอดที่พักไว้</div><div className="wallet-amount">120.00<small>บาท</small></div><div className="wallet-actions"><Link className="button secondary" href="/wallet">ดูรายละเอียด</Link></div></div>
        <div className="wallet-cell"><div className="wallet-label">ถอนออกได้</div><div className="wallet-amount">12,330.00<small>บาท</small></div><div className="wallet-actions"><Link className="button lime" href="/wallet/withdraw">ถอนเงิน</Link></div></div>
      </div>
    </div>

    <section className="grid-2" style={{ marginTop: 18 }}>
      <div className="stack">
        <section className="panel"><div className="panel-title"><h2>งวดที่เปิดรับ</h2><Link href="/buy">ดูทั้งหมด →</Link></div><div className="draw-list">
          {draws.map(([kind, code, name, detail, countdown]) => <div className="draw-row" key={name}><div className={`lottery-icon ${kind}`}>{code}</div><div className="draw-name"><strong>{name}</strong><span>{detail}</span></div><div className="countdown"><small>ปิดรับใน</small><span>{countdown}</span></div><Link className="button primary" href="/buy/bet">ซื้อเลย</Link></div>)}
        </div></section>
        <section className="panel"><div className="panel-title"><h2>โพยล่าสุดของฉัน</h2><Link href="/slips">ดูทั้งหมด →</Link></div><div className="activity-list">
          <div className="activity-row"><span>10 ก.ย. 11:08</span><div><strong>สลากกินแบ่งรัฐบาล</strong><span className="small muted">708 · 2 รายการ</span></div><strong>200.00 บาท</strong><span className="status info">รอผล</span></div>
          <div className="activity-row"><span>10 ก.ย. 09:42</span><div><strong>หวยลาวพัฒนา</strong><span className="small muted">27 · 1 รายการ</span></div><strong>100.00 บาท</strong><span className="status info">รอผล</span></div>
          <div className="activity-row"><span>9 ก.ย. 20:15</span><div><strong>ฮานอยพิเศษ</strong><span className="small muted">640 · 3 รายการ</span></div><strong>300.00 บาท</strong><span className="status success">ถูกรางวัล</span></div>
        </div></section>
      </div>
      <div className="stack">
        <section className="promo-card"><div className="panel-title"><h2>โปรโมชั่น</h2><Link href="/promotions">ดูทั้งหมด →</Link></div><strong>สมาชิกใหม่ รับโบนัส 100 บาท</strong><p className="muted small">โบนัสคงเหลือ 80 บาท · หมดอายุ 30 ก.ย. 2569</p><div className="progress"><span style={{ width: "50%" }} /></div><div className="progress-meta"><span>ทำยอดแล้ว 2,500 บาท</span><strong>50%</strong></div></section>
        <section className="panel"><div className="panel-title"><h2>ทำรายการต่อ</h2></div><div className="menu-row"><div className="menu-icon">S</div><div><strong>สลากกินแบ่งรัฐบาล</strong><span>1 โพย · 6 รายการที่เตรียมไว้</span></div><Link className="button primary" href="/buy/bet">ทำรายการต่อ</Link></div></section>
        <section className="panel" id="alerts"><div className="panel-title"><h2>การแจ้งเตือนสำคัญ</h2></div><div className="alert-list">
          <div className="alert-row"><div className="alert-icon danger">!</div><div><strong>ใกล้ปิดรับสลากกินแบ่งรัฐบาล</strong><span>งวด 16 ก.ย. ปิดรับในอีกประมาณ 2 ชั่วโมง</span></div><span className="small muted">วันนี้</span></div>
          <div className="alert-row"><div className="alert-icon">i</div><div><strong>ยืนยันตัวตนเพื่อใช้งานการถอนเงิน</strong><span>ทำให้เรียบร้อยก่อนส่งคำขอถอนครั้งถัดไป</span></div><Link className="text-link" href="/account/kyc">ไปยืนยันตัวตน</Link></div>
          <div className="alert-row"><div className="alert-icon success">✓</div><div><strong>ผลฮานอยพิเศษได้รับการยืนยันแล้ว</strong><span>โพยของคุณได้รับเงินรางวัล 1,350 บาท</span></div><Link className="text-link" href="/slips">ดูโพย</Link></div>
        </div></section>
      </div>
    </section>
  </main>;
}
