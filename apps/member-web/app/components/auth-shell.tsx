import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({ title, copy, foot, children }: { title: ReactNode; copy: string; foot: string; children: ReactNode }) {
  return <main className="auth-shell">
    <section className="auth-brand-side">
      <Link className="brand" href="/" prefetch={false}><span className="brand-mark">L</span><span className="brand-copy"><strong>Lottify</strong><small>MEMBER</small></span></Link>
      <div className="auth-copy">
        <span className="auth-kicker">THAI-FIRST MEMBER EXPERIENCE</span>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
      <div className="auth-foot">{foot}</div>
    </section>
    <section className="auth-form-side"><div className="auth-form-wrap">{children}</div></section>
  </main>;
}
