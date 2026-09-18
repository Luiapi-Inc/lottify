import Link from "next/link";

/**
 * Branded Admin 404. Rendered for every unmatched URL, replacing the raw
 * Next.js default not-found page.
 */
export default function NotFound() {
  return (
    <main className="cp-not-found">
      <div className="cp-not-found-card">
        <div className="cp-not-found-brand">
          <span className="cp-brand-mark" aria-hidden="true">
            L
          </span>
          <span>Lottify Admin</span>
        </div>
        <p className="cp-not-found-code">404</p>
        <h1>ไม่พบหน้าที่ต้องการ</h1>
        <p>
          ที่อยู่นี้ไม่มีอยู่ในระบบ Admin หรือถูกย้ายไปแล้ว
          ตรวจสอบลิงก์อีกครั้งหรือกลับไปยังพื้นที่ปฏิบัติงานที่คุณมีสิทธิ์
        </p>
        <nav className="cp-not-found-links" aria-label="กลับไปยังพื้นที่ที่พร้อมใช้งาน">
          <Link href="/">ภาพรวม</Link>
          <Link href="/lottery">หวยและงวด</Link>
          <Link href="/accounting-periods">การเงิน</Link>
          <Link href="/approvals">Approvals</Link>
        </nav>
      </div>
    </main>
  );
}
