import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({ title, copy, foot, children }: { title: ReactNode; copy: string; foot: string; children: ReactNode }) {
  return <main className="auth-stage">
    <section className="auth-atmosphere" aria-label="Lottify Member">
      {/* `/` is guarded; never prefetch it from the logged-out shell. */}
      <Link className="auth-brand" href="/" prefetch={false}>
        <span className="brand-mark" aria-hidden="true">✦</span>
        <span className="brand-copy"><strong>Lottify</strong><small>MEMBER</small></span>
      </Link>
      <div className="auth-copy"><h1>{title}</h1><p>{copy}</p></div>
      <div className="auth-foot">{foot}</div>
    </section>
    <section className="auth-panel"><div className="auth-panel-inner">{children}</div></section>
  </main>;
}
