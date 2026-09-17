"use client";

import type { components } from "@lottify/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminApi } from "./admin-api";
import { AdminLogin, useAdminSession } from "./login";
import { ApprovalsSection, useApprovalsQueue } from "./approvals-queue";
import { NAVIGATION_AREAS, hasAnyCapability } from "./navigation";
import { AdminShell, adminLogout } from "./shell";

type AdminMe = components["schemas"]["AdminMeResponse"];

type Capability = AdminMe["capabilities"][number];

export default function OverviewPage() {
  const [api] = useState(() => new AdminApi());
  const { admin, booting, loadMe } = useAdminSession(api);
  const approvals = useApprovalsQueue(api, admin);

  useEffect(() => {
    void loadMe().catch(() => {
      api.clear();
    });
  }, [api, loadMe]);

  const can = useCallback(
    (capability: Capability) => admin?.capabilities.includes(capability) === true,
    [admin],
  );

  if (booting) {
    return (
      <main className="cp-center">
        <p role="status">กำลังตรวจสอบ Admin session…</p>
      </main>
    );
  }

  if (!admin) {
    return (
      <main className="cp-center">
        <AdminLogin api={api} onLogin={async () => void loadMe()} />
      </main>
    );
  }

  return (
    <AdminShell
      admin={admin}
      activeKey="overview"
      onLogout={() => void adminLogout(api, loadMe)()}
      breadcrumb="ภาพรวมปฏิบัติงาน"
      title="ภาพรวม"
      subtitle="งานที่รอการดำเนินการและจุดเข้าคิวของแต่ละพื้นที่ · ข้อมูลจากสัญญา API ที่มีจริงเท่านั้น ไม่มีการสร้างตัวเลขขึ้นเอง"
    >
      <ApprovalsSection queue={approvals} />

      <section aria-labelledby="areas-heading" className="cp-section">
        <div className="cp-section-heading">
          <div>
            <h2 id="areas-heading">พื้นที่ปฏิบัติงานตามความรับผิดชอบ</h2>
            <p>
              แต่ละพื้นที่แสดงสถานะของ service ที่แท้จริงบน checkpoint นี้
              ระบบที่ยังไม่มี API จะแสดงสถานะไม่พร้อมใช้งานโดยไม่สร้างข้อมูลแทน
            </p>
          </div>
        </div>
        <div className="cp-area-grid">
          {NAVIGATION_AREAS.filter((area) => area.key !== "overview").map((area) => {
            const permitted = hasAnyCapability(admin.capabilities, area.capabilities);
            return (
              <AreaCard
                key={area.key}
                label={area.label}
                description={area.description}
                href={area.href}
                exposed={area.serviceExposed}
                uiExposed={area.uiExposed}
                permitted={permitted}
                active={area.key === "approvals" && approvals.queue.length > 0}
              />
            );
          })}
        </div>
      </section>

      {!can("accounting-period.read") && !can("lottery-configuration.read") ? (
        <section aria-labelledby="ro-heading" className="cp-section">
          <div className="cp-section-heading">
            <h2 id="ro-heading">บทบาทของคุณ</h2>
          </div>
          <p className="cp-note">
            session นี้ไม่มีสิทธิ์อ่านพื้นที่ที่มีข้อมูลจริงใน checkpoint นี้ (Accounting Period /
            Lottery Configuration) หากต้องการเปิดข้อมูล ให้ติดต่อผู้ดูแลระบบเพื่อเพิ่ม capability
          </p>
        </section>
      ) : null}
    </AdminShell>
  );
}

function AreaCard({
  label,
  description,
  href,
  exposed,
  uiExposed,
  permitted,
  active,
}: {
  label: string;
  description: string;
  href?: string;
  exposed: boolean;
  uiExposed: boolean;
  permitted: boolean;
  active: boolean;
}) {
  const disabled = !exposed || !uiExposed || !permitted;
  const tag = !exposed
    ? "Service ยังไม่พร้อม"
    : !uiExposed
      ? "มี API แต่ยังไม่มีหน้าจอ"
      : !permitted
        ? "ไม่มีสิทธิ์"
        : active
          ? "มีงานรอ"
          : "พร้อมใช้งาน";
  const body = (
    <div className={disabled ? "cp-area-card cp-area-card-disabled" : "cp-area-card"}>
      <div className="cp-area-head">
        <h3>{label}</h3>
        <span
          className={
            !exposed || !uiExposed
              ? "cp-tag cp-tag-warn"
              : !permitted
                ? "cp-tag"
                : active
                  ? "cp-tag cp-tag-alert"
                  : "cp-tag cp-tag-ok"
          }
        >
          {tag}
        </span>
      </div>
      <p>{description}</p>
    </div>
  );
  if (disabled || !href) return body;
  return (
    <Link className="cp-area-link" href={href}>
      {body}
    </Link>
  );
}
