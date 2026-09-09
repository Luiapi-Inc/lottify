import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeading({ title, description }: { title: string; description: string }) {
  return <header className="page-heading"><p className="eyebrow">พื้นที่สมาชิก / LOTTIFY</p><h1>{title}</h1><p>{description}</p></header>;
}

export function Unavailable({ title, children }: { title: string; children: ReactNode }) {
  return <div className="unavailable"><span className="state-icon" aria-hidden="true">—</span><div><p className="status-label">ยังไม่พร้อมใช้งาน</p><h3>{title}</h3><p>{children}</p></div></div>;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel"><h2>{title}</h2>{children}</section>;
}

export function WalletSummary() {
  return <dl className="balances">{[
    ["เงินสด (CASH)", "ยอดเงินสดในกระเป๋า"],
    ["โบนัส (BONUS)", "ไม่สามารถถอนได้โดยตรง"],
    ["ยอดที่กันไว้", "เงินที่กันไว้สำหรับรายการ"],
    ["ยอดที่ถอนได้", "เงินสดที่พร้อมถอน"],
  ].map(([label, description]) => <div key={label}><dt>{label}</dt><dd><strong>ยังไม่พร้อมแสดง</strong><span>{description} · บาท</span></dd></div>)}</dl>;
}

export function AreaLink({ href, title, children }: { href: string; title: string; children: ReactNode }) {
  return <Link className="area-link" href={href}><div><h3>{title}</h3><p>{children}</p></div><span aria-hidden="true">↗</span></Link>;
}
