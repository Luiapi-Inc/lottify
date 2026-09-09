import { PageHeading, Section, Unavailable } from "../components/presentation";
export const metadata = { title: "โพยของฉัน" };
export default function SlipsPage() {
  return <><PageHeading title="โพยของฉัน" description="ตรวจสอบใบรับรายการ ผล และประวัติของแต่ละโพย" /><Section title="รายการโพย"><Unavailable title="ยังแสดงประวัติโพยไม่ได้">ข้อมูลรายการซื้อยังไม่พร้อมแสดง จึงยังตรวจสอบ ค้นหา หรือกรองโพยไม่ได้ สถานะนี้ไม่ได้หมายความว่าคุณไม่มีโพย</Unavailable></Section><Section title="ข้อมูลที่ใช้ตรวจสอบแต่ละโพย"><div className="detail-list"><div><h3>ใบรับรายการ</h3><p>เลขอ้างอิง หวย งวด เลขที่ยืนยัน ยอดซื้อ อัตราจ่ายที่รับ และแหล่งเงินที่ใช้</p></div><div><h3>ผลและการคืนเงิน</h3><p>สถานะผล การยกเลิก และการคืนเงินของรายการ</p></div><div><h3>ประวัติการแก้ไขผล</h3><p>ผลเดิม การแจ้งแก้ไข การปรับยอด และผลล่าสุด โดยยังคงตรวจสอบประวัติเดิมได้</p></div></div><p className="footnote">รายละเอียดเหล่านี้ยังไม่พร้อมแสดงในหน้าจอตัวอย่าง</p></Section></>;
}
