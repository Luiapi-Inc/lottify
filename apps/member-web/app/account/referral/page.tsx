import Link from "next/link";
import { PageHeading, Section, StatusBadge } from "../../components/presentation";

export default function ReferralPage() {
  return <main id="main">
    <PageHeading
      eyebrow="REFERRAL · CONTRACT GAP"
      title="แนะนำเพื่อน"
      description="Lottify v1 มี referral semantics ใน domain แต่ Member OpenAPI ปัจจุบันยังไม่มี endpoint สำหรับออก referral code, ผูก referrer, อ่าน milestone หรือประวัติ referral"
      action={<StatusBadge tone="warning">API ยังไม่พร้อม</StatusBadge>}
    />
    <section className="grid-2">
      <Section title="สถานะการเชื่อมต่อ" subtitle="Route นี้คงไว้ตาม approved information architecture">
        <div className="state-card"><span className="state-symbol">!</span><div><strong>ยังไม่สามารถสร้างหรือแสดง Referral จริงได้</strong><p>หน้าเว็บจะไม่สร้างรหัส LTF, ลิงก์เชิญ, สมาชิกที่ถูกแนะนำ หรือสถานะ milestone จาก fixture/localStorage เพราะข้อมูลเหล่านี้ต้องมาจาก authoritative API</p></div></div>
        <div className="notice warning" style={{ marginTop: 14 }}><b>!</b><div><strong>Gap ที่ต้องปิดใน backend/API contract</strong>ต้องมี contract สำหรับ referral identity/link, relationship, milestones และ Member-facing status ก่อนเปิด interaction นี้</div></div>
      </Section>
      <aside className="stack">
        <Section title="สิ่งที่ใช้งานได้แล้ว" subtitle="Promotion API มีสิทธิ์และ Turnover แต่ไม่ใช่ Referral API">
          <div className="data-list">
            <Link className="data-row" href="/promotions"><div className="data-main"><strong>โปรโมชั่นและ Entitlements</strong><span>ดูสิทธิ์ reward/turnover ที่ backend เปิดเผยแล้ว</span></div><b>→</b></Link>
            <Link className="data-row" href="/account"><div className="data-main"><strong>กลับบัญชี</strong><span>จัดการข้อมูลสมาชิกและความปลอดภัย</span></div><b>→</b></Link>
          </div>
        </Section>
        <div className="notice info"><b>i</b><div><strong>ไม่ลด scope</strong>Referral ยังคงเป็น requirement แต่ถูกระบุเป็น implementation gap แทนการจำลองว่าทำงานแล้ว</div></div>
      </aside>
    </section>
  </main>;
}
