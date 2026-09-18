import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({ title, copy, foot, children }: { title: ReactNode; copy: string; foot: string; children: ReactNode }) {
  return <div className="auth-stage">
    <div className="auth-scene">
      <section className="auth-story">
        {/* `/` is guarded. Keep prefetch disabled so an unauthenticated prefetch
            cannot cache the login redirect and strand a newly authenticated Member. */}
        <Link className="auth-home-link" href="/" prefetch={false}><strong>Lottify</strong><span>MEMBER</span></Link>
        <h1>{title}</h1>
        <p>{copy}</p>
        <div className="auth-footnote">{foot}</div>
      </section>
      <section className="auth-task">{children}</section>
    </div>
  </div>;
}
