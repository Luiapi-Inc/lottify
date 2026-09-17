"use client";

import { useEffect, useState } from "react";
import { AdminApi } from "../control-plane/admin-api";
import { AdminLogin, useAdminSession } from "../control-plane/login";
import { ApprovalsSection, useApprovalsQueue } from "../control-plane/approvals-queue";
import { AdminShell, adminLogout } from "../control-plane/shell";

/**
 * Dedicated route for the maker-checker queue. The sidebar links here instead
 * of sending "Approvals" back to `/` where the overview already lives.
 */
export default function ApprovalsView() {
  const [api] = useState(() => new AdminApi());
  const { admin, booting, loadMe } = useAdminSession(api);
  const approvals = useApprovalsQueue(api, admin);

  useEffect(() => {
    void loadMe().catch(() => {
      api.clear();
    });
  }, [api, loadMe]);

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
      activeKey="approvals"
      onLogout={() => void adminLogout(api, loadMe)()}
      breadcrumb="Approvals / รอการอนุมัติและตรวจสอบ"
      title="Approvals"
      subtitle="คิว maker-checker ข้ามพื้นที่ที่ระบบรองรับ (Accounting Period / Lottery Configuration) · แสดงเฉพาะรายการจากสัญญา API จริง"
    >
      <ApprovalsSection queue={approvals} />
    </AdminShell>
  );
}
