import Link from "next/link";
import type { ReactNode } from "react";

export function WorkflowHero({
  eyebrow,
  title,
  description,
  backHref,
  backLabel,
  status,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  backHref?: string;
  backLabel?: string;
  status?: ReactNode;
  children?: ReactNode;
}) {
  return <header className="workflow-hero">
    <div className="workflow-hero-copy">
      {backHref ? <Link className="workflow-back" href={backHref}>← {backLabel ?? "กลับ"}</Link> : null}
      <p className="workflow-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{description}</p>
      {children ? <div className="workflow-hero-meta">{children}</div> : null}
    </div>
    {status ? <div className="workflow-hero-status">{status}</div> : null}
  </header>;
}

export function WorkflowRail({
  steps,
  active,
}: {
  steps: Array<{ key: string; label: string; hint: string }>;
  active: string;
}) {
  const activeIndex = Math.max(0, steps.findIndex((step) => step.key === active));
  return <ol className="workflow-rail" aria-label="ขั้นตอนการทำรายการ">
    {steps.map((step, index) => {
      const tone = index < activeIndex ? "done" : index === activeIndex ? "active" : "future";
      return <li className={tone} key={step.key}>
        <span>{index < activeIndex ? "✓" : index + 1}</span>
        <div><strong>{step.label}</strong><small>{step.hint}</small></div>
      </li>;
    })}
  </ol>;
}

export function AuthorityCallout({
  title = "Server เป็นผู้ตัดสินผลสุดท้าย",
  children,
  tone = "info",
}: {
  title?: string;
  children: ReactNode;
  tone?: "info" | "warning" | "success";
}) {
  return <aside className={`authority-callout ${tone}`}>
    <span aria-hidden="true">{tone === "warning" ? "!" : tone === "success" ? "✓" : "i"}</span>
    <div><strong>{title}</strong><p>{children}</p></div>
  </aside>;
}

export function AuthFormIntro({
  step,
  title,
  description,
}: {
  step: string;
  title: string;
  description: string;
}) {
  return <div className="auth-form-intro">
    <span>{step}</span>
    <h2>{title}</h2>
    <p>{description}</p>
  </div>;
}
