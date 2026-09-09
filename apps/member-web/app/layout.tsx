import type { Metadata } from "next";
import Link from "next/link";
import { Navigation } from "./components/navigation";
import "./styles.css";

export const metadata: Metadata = { title: { default: "หน้าแรก | Lottify", template: "%s | Lottify" }, description: "พื้นที่สมาชิก Lottify — หน้าแรก ซื้อหวย โพยของฉัน กระเป๋า และบัญชี" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>
        <a className="skip-link" href="#main-content">ข้ามไปยังเนื้อหา</a>
        <div className="app-shell">
          <aside className="sidebar">
            <Link className="brand" href="/" aria-label="Lottify หน้าแรก"><span className="brand-mark" aria-hidden="true">L</span>lottify<span className="brand-dot">.</span></Link>
            <p className="sidebar-caption">พื้นที่สมาชิก</p>
            <Navigation />
            <p className="sidebar-note">ข้อมูลชัดเจน<br />ทุกขั้นตอนของคุณ</p>
          </aside>
          <div className="workspace">
            <div className="topbar"><span>ยินดีต้อนรับสู่ Lottify</span><span className="preview-label">ตัวอย่างหน้าจอ</span></div>
            <div className="preview-notice"><strong>ขณะนี้เปิดให้สำรวจหน้าจอเท่านั้น</strong><span>ยังไม่เปิดบริการสมาชิกและธุรกรรม ข้อมูลบัญชีและรายการจริงยังไม่พร้อมแสดง</span></div>
            <main id="main-content" tabIndex={-1}>{children}</main>
            <footer>LOTTIFY <span>พื้นที่สมาชิก · ภาษาไทย</span></footer>
          </div>
        </div>
      </body>
    </html>
  );
}
