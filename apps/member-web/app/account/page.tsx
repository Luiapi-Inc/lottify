"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { memberApi, type MemberReadinessResponse } from "../lib/member-api";
import { describeMemberStatus, formatMemberPhone, useMemberSession } from "../lib/member-session-client";
import { ErrorState, LoadingState, PageHeading, Section, StatusBadge } from "../components/presentation";

export default function AccountPage() {
  const router = useRouter();
  const sessionState = useMemberSession();
  const [readiness, setReadiness] = useState<MemberReadinessResponse | null>(null);
  const [readinessError, setReadinessError] = useState<unknown>(null);
  const [signingOut, setSigningOut] = useState(false);

  const loadReadiness = useCallback(async () => {
    setReadinessError(null);
    try {
      setReadiness(await memberApi.getReadiness());
    } catch (cause) {
      setReadinessError(cause);
    }
  }, []);

  useEffect(() => {
    if (sessionState.status === "authenticated") void loadReadiness();
  }, [sessionState.status, loadReadiness]);

  async function signOut() {
    setSigningOut(true);
    try {
      await memberApi.logout();
    } finally {
      window.location.assign("/login");
    }
  }

  return <main id="main">
    <PageHeading
      eyebrow="ACCOUNT"
      title="บัญชีของฉัน"
      description="ข้อมูล Member, Terms, readiness, KYC, Payout Destination และ Security แยกตาม authority ของแต่ละ resource"
      action={sessionState.status === "authenticated" ? <button className="button secondary" type="button" disabled={signingOut} onClick={() => void signOut()}>{signingOut ? "กำลังออกจากระบบ…" : "ออกจากระบบ"}</button> : undefined}
    />

    {sessionState.status === "loading" ? <LoadingState label="กำลังตรวจสอบ Member session…" /> : null}
    {sessionState.status === "unavailable" ? <ErrorState error={new Error(sessionState.message)} /> : null}
    {sessionState.status === "signed-out" ? <div className="state-card"><span className="state-symbol">!</span><div><strong>เซสชันหมดอายุหรือถูกยกเลิก</strong><p>เข้าสู่ระบบใหม่ก่อนเปิดข้อมูลบัญชี</p><Link className="text-link" href="/login">เข้าสู่ระบบ →</Link></div></div> : null}

    {sessionState.status === "authenticated" ? <section className="grid-2">
      <div className="stack">
        <Section title="Member identity" subtitle="GET /auth/me">
          <div className="profile-hero" style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div className="avatar" style={{ width: 54, height: 54, fontSize: 20 }}>ล</div>
            <div><h2 style={{ marginBottom: 4 }}>{formatMemberPhone(sessionState.session.phone)}</h2><StatusBadge tone={sessionState.session.status === "ACTIVE" ? "success" : "warning"}>{describeMemberStatus(sessionState.session.status).label}</StatusBadge></div>
          </div>
          <div className="data-list" style={{ marginTop: 14 }}>
            <Link className="data-row" href="/account/profile"><div className="data-main"><strong>ข้อมูลส่วนตัว</strong><span>ชื่อ วันเกิด จังหวัด และ mandatory fields</span></div><b>→</b></Link>
            <Link className="data-row" href="/terms?from=account"><div className="data-main"><strong>ข้อตกลงและเงื่อนไข</strong><span>เอกสารและเวอร์ชันที่ต้องยอมรับ</span></div><b>→</b></Link>
            <Link className="data-row" href="/account/kyc"><div className="data-main"><strong>KYC</strong><span>ดู canonical KYC/readiness state เท่านั้น</span></div><b>→</b></Link>
            <Link className="data-row" href="/account/bank-account"><div className="data-main"><strong>บัญชีรับเงิน</strong><span>Payout Destination และ verification</span></div><b>→</b></Link>
            <Link className="data-row" href="/account/security"><div className="data-main"><strong>ความปลอดภัย</strong><span>Sessions, Devices และ Notification preferences</span></div><b>→</b></Link>
            <Link className="data-row" href="/account/referral"><div className="data-main"><strong>แนะนำเพื่อน</strong><span>Route ถูกเก็บไว้ แต่ Member referral API ยังเป็น contract gap</span></div><StatusBadge tone="warning">GAP</StatusBadge></Link>
          </div>
        </Section>
      </div>

      <aside className="stack">
        <Section title="Capability readiness" subtitle={readiness ? `Policy ${readiness.policyVersion}` : "ผลล่าสุดจาก backend"} action={<button className="text-button" type="button" onClick={() => void loadReadiness()}>รีเฟรช</button>}>
          {readiness ? <div className="data-list">{readiness.capabilities.map((decision) => <div className="data-row" key={decision.capability}>
            <div className="data-main"><strong>{decision.capability}</strong><span>{decision.reasonCodes.length ? decision.reasonCodes.join(" · ") : "ไม่มีข้อกำหนดค้าง"}</span></div>
            <StatusBadge tone={decision.outcome === "ALLOW" ? "success" : decision.outcome === "DENY" ? "danger" : "warning"}>{decision.outcome}</StatusBadge>
          </div>)}</div> : readinessError ? <ErrorState error={readinessError} retry={() => void loadReadiness()} /> : <LoadingState label="กำลังอ่าน readiness…" />}
        </Section>

        <Section title="งานที่เกี่ยวข้อง">
          <div className="action-grid">
            <Link className="action-card" href="/eligibility"><b>✓</b><div><strong>Eligibility</strong><span>ดู requirement ราย capability</span></div></Link>
            <Link className="action-card" href="/wallet"><b>฿</b><div><strong>Wallet</strong><span>ยอดและธุรกรรมล่าสุด</span></div></Link>
            <Link className="action-card" href="/promotions"><b>✦</b><div><strong>Promotions</strong><span>สิทธิ์และ turnover</span></div></Link>
            <Link className="action-card" href="/account/security"><b>◎</b><div><strong>Security</strong><span>จัดการ session/device</span></div></Link>
          </div>
        </Section>
      </aside>
    </section> : null}
  </main>;
}
