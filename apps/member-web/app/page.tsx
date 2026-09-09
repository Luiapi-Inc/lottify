import { AreaLink, PageHeading, Section, Unavailable, WalletSummary } from "./components/presentation";

export default function HomePage() {
  return <>
    <PageHeading title="ทุกอย่างของคุณ ในที่เดียว" description="สำรวจกระเป๋า โพย และข้อมูลบัญชีจากพื้นที่สมาชิกของคุณ" />
    <section className="welcome"><div><p className="eyebrow">ยินดีต้อนรับ</p><h2>เริ่มต้นอย่างเข้าใจ<br />ตรวจสอบได้ทุกขั้นตอน</h2><p>ดูพื้นที่ต่าง ๆ ผ่านเมนูด้านล่าง<br />บริการซื้อหวย ฝากเงิน และถอนเงินยังไม่เปิดใช้งาน</p></div><div className="welcome-art" aria-hidden="true"><span>L</span></div></section>
    <Section title="ภาพรวมกระเป๋า"><WalletSummary /><AreaLink href="/wallet" title="ดูกระเป๋า">รายละเอียดเงินสด โบนัส และประวัติรายการ</AreaLink></Section>
    <div className="two-columns"><Section title="หวยและงวดที่เปิดรับ"><Unavailable title="ยังแสดงงวดที่เปิดรับไม่ได้">ข้อมูลหวย งวด และเวลาปิดรับยังไม่พร้อม จึงยังเลือกเลขหรือซื้อหวยไม่ได้</Unavailable><AreaLink href="/buy" title="ดูพื้นที่ซื้อหวย">ทำความเข้าใจขั้นตอนก่อนซื้อ</AreaLink></Section>
    <Section title="โพยล่าสุด"><Unavailable title="ยังแสดงโพยของคุณไม่ได้">ประวัติการซื้อและโพยที่ต้องการทำต่อยังไม่พร้อมแสดง</Unavailable><AreaLink href="/slips" title="ดูพื้นที่โพยของฉัน">ใบรับรายการและประวัติผล</AreaLink></Section></div>
    <div className="two-columns"><Section title="โปรโมชั่นและโบนัส"><Unavailable title="ยังแสดงสิทธิ์โปรโมชั่นไม่ได้">สิทธิ์โบนัส เงื่อนไข และความคืบหน้ายอดเล่นยังไม่พร้อมแสดง</Unavailable></Section><Section title="การแจ้งเตือนสำคัญ"><Unavailable title="ยังแสดงการแจ้งเตือนไม่ได้">ข้อมูลการยืนยันบัญชี การชำระเงิน ผล และการแก้ไขผลยังไม่พร้อมแสดง</Unavailable></Section></div>
  </>;
}
