import Link from "next/link";

export default function AccountPage() {
  return <main id="main">
    <div className="page-head"><div><h1>บัญชีของฉัน</h1><p>ข้อมูลสมาชิก ความพร้อมของบริการ การยืนยันตัวตน บัญชีรับเงิน และความปลอดภัย</p></div><Link className="button secondary" href="/login">ออกจากระบบ</Link></div>
    <section className="grid-2">
      <div className="stack">
        <section className="panel"><div className="profile-hero"><div className="profile-avatar">ล</div><div><h2>คุณ สมาชิก</h2><p>08X-XXX-8421 · สมาชิกตั้งแต่ 8 ก.ย. 2569</p></div></div><div className="menu-list">
          <Link className="menu-row" href="/account/profile"><div className="menu-icon">P</div><div><strong>ข้อมูลส่วนตัว</strong><span>ชื่อ วันเกิด และข้อมูลที่จำเป็น</span></div><span>→</span></Link>
          <Link className="menu-row" href="/terms?from=account"><div className="menu-icon">T</div><div><strong>ข้อตกลงและเงื่อนไข</strong><span>ตรวจเวอร์ชันและสถานะการยอมรับ</span></div><span className="status success">ครบแล้ว</span></Link>
          <Link className="menu-row" href="/account/kyc"><div className="menu-icon">K</div><div><strong>การยืนยันตัวตน</strong><span>จำเป็นก่อนถอนเงินครั้งแรกในตัวอย่างนี้</span></div><span className="status warning">ต้องดำเนินการ</span></Link>
          <Link className="menu-row" href="/account/bank-account"><div className="menu-icon">B</div><div><strong>บัญชีธนาคาร</strong><span>กสิกรไทย ••••4821 · ยืนยันแล้ว</span></div><span>→</span></Link>
          <Link className="menu-row" href="/account/referral"><div className="menu-icon">ช</div><div><strong>แนะนำเพื่อน</strong><span>แชร์ลิงก์สมัครสมาชิกและดูสถานะการแนะนำ</span></div><span>→</span></Link>
        </div></section>
        <section className="panel"><div className="panel-title"><h2>ความพร้อมของบริการ</h2></div><div className="menu-row"><div className="menu-icon">B</div><div><strong>ซื้อหวย</strong><span>พร้อมใช้งาน</span></div><span className="status success">ใช้งานได้</span></div><div className="menu-row"><div className="menu-icon">D</div><div><strong>ฝากเงิน</strong><span>พร้อมใช้งาน</span></div><span className="status success">ใช้งานได้</span></div><div className="menu-row"><div className="menu-icon">W</div><div><strong>ถอนเงิน</strong><span>ต้องยืนยันตัวตนก่อน</span></div><span className="status warning">มีเงื่อนไข</span></div></section>
      </div>
      <aside className="stack">
        <section className="panel"><div className="panel-title"><h2>ความปลอดภัย</h2><Link href="/account/security">จัดการ →</Link></div><div className="notice success"><b>✓</b><div><strong>ไม่มีเหตุการณ์ผิดปกติที่ต้องดำเนินการ</strong>อุปกรณ์ปัจจุบัน: Hermes Desktop · กรุงเทพฯ</div></div><div className="menu-list" style={{ marginTop: 10 }}><Link className="menu-row" href="/account/security"><div className="menu-icon">S</div><div><strong>อุปกรณ์และเซสชัน</strong><span>ตรวจและออกจากระบบรายอุปกรณ์</span></div><span>→</span></Link><Link className="menu-row" href="/account/security#recovery"><div className="menu-icon">R</div><div><strong>กู้คืนบัญชี</strong><span>เริ่มคำขอและตรวจสถานะ</span></div><span>→</span></Link></div></section>
        <section className="panel"><div className="panel-title"><h2>ช่วยเหลือ</h2></div><div className="menu-row"><div className="menu-icon">?</div><div><strong>ศูนย์ช่วยเหลือ</strong><span>คำถามเกี่ยวกับรายการและบัญชี</span></div><span>→</span></div><div className="menu-row"><div className="menu-icon">C</div><div><strong>ติดต่อเจ้าหน้าที่</strong><span>ใช้เลขอ้างอิงของรายการเพื่อให้ตรวจสอบเร็วขึ้น</span></div><span>→</span></div></section>
      </aside>
    </section>
  </main>;
}
