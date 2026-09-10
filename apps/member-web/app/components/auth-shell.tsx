import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({ title, copy, foot, children }: { title: ReactNode; copy: string; foot: string; children: ReactNode }) {
  return <div className="auth-shell">
    <section className="auth-brand-side">
      <Link className="brand" href="/"><span className="brand-mark">L</span><span>Lottify</span></Link>
      <div className="auth-copy"><h1>{title}</h1><p>{copy}</p></div>
      <div className="small" style={{ color: "#a9cabd" }}>{foot}</div>
    </section>
    <section className="auth-form-side">{children}</section>
  </div>;
}
