import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({ title, copy, foot, children }: { title: ReactNode; copy: string; foot: string; children: ReactNode }) {
  return <div className="auth-shell">
    <section className="auth-brand-side">
      {/* `/` is a member area: the session guard answers a logged-out request
          for it with a `307 /login?next=%2F`, and the client router stores that
          redirect for the rest of the session (which then strands a just-logged
          -in member on the login page). Never prefetch a guarded route from the
          auth shell. */}
      <Link className="brand" href="/" prefetch={false}><span className="brand-mark">L</span><span>Lottify</span></Link>
      <div className="auth-copy"><h1>{title}</h1><p>{copy}</p></div>
      <div className="small" style={{ color: "#a9cabd" }}>{foot}</div>
    </section>
    <section className="auth-form-side">{children}</section>
  </div>;
}
