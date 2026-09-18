import Link from "next/link";
import type { ReactNode } from "react";
import { MemberApiFailure } from "../lib/member-api";

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return <header className="page-heading">
    <div>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
    {action ? <div className="page-heading-action">{action}</div> : null}
  </header>;
}

export function Section({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return <section className={`surface ${className}`.trim()}>
    <div className="surface-head">
      <div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
      {action}
    </div>
    {children}
  </section>;
}

export function LoadingState({ label = "กำลังโหลดข้อมูลล่าสุด…" }: { label?: string }) {
  return <div className="state-card" aria-live="polite"><span className="spinner" /><div><strong>{label}</strong><p>ข้อมูลจะแสดงจากระบบเมื่อพร้อม</p></div></div>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="state-card"><span className="state-symbol">○</span><div><strong>{title}</strong><p>{description}</p></div></div>;
}

export function ErrorState({
  error,
  retry,
  title = "โหลดข้อมูลไม่สำเร็จ",
}: {
  error: unknown;
  retry?: () => void;
  title?: string;
}) {
  const failure = error instanceof MemberApiFailure ? error : null;
  const message = error instanceof Error ? error.message : "ไม่สามารถเชื่อมต่อบริการได้";
  return <div className="state-card error-state" role="alert">
    <span className="state-symbol">!</span>
    <div>
      <strong>{title}</strong>
      <p>{message}</p>
      {failure?.correlationId ? <small>อ้างอิง: {failure.correlationId}</small> : null}
      {retry ? <button className="text-button" type="button" onClick={retry}>ลองอีกครั้ง</button> : null}
    </div>
  </div>;
}

export function AreaLink({
  href,
  title,
  children,
  meta,
}: {
  href: string;
  title: string;
  children: ReactNode;
  meta?: string;
}) {
  return <Link className="area-link" href={href}>
    <div><h3>{title}</h3><p>{children}</p>{meta ? <span>{meta}</span> : null}</div>
    <b aria-hidden="true">↗</b>
  </Link>;
}

export function Money({ minor, currency = "THB" }: { minor: string | number; currency?: string }) {
  const value = Number(minor) / 100;
  return <>{Number.isFinite(value) ? value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"} <small>{currency === "THB" ? "บาท" : currency}</small></>;
}

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "success" | "warning" | "danger" | "info" | "neutral" }) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}

export function Unavailable({ title, children }: { title: string; children: ReactNode }) {
  return <div className="state-card"><span className="state-symbol">—</span><div><strong>{title}</strong><p>{children}</p></div></div>;
}

export function WalletSummary() {
  return <div className="state-card"><span className="state-symbol">฿</span><div><strong>ยอดเงินจะแสดงจาก Wallet API</strong><p>ไม่มีการใช้ยอดตัวอย่างหรือยอดที่คำนวณเองใน client</p></div></div>;
}
