"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  createIdempotencyKey,
  memberApi,
  type PromotionDiscoveryItem,
  type PromotionEntitlement,
} from "../lib/member-api";
import {
  describeMemberApiFailure,
  formatBaht,
  formatDateTime,
  formatPayoutMultiplier,
  parseFixedPayout,
} from "../lib/member-display";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; campaigns: PromotionDiscoveryItem[]; entitlements: PromotionEntitlement[]; asOf: string }
  | { status: "failed"; message: string; code: string; correlationId?: string };

type ActionState =
  | { status: "idle" }
  | { status: "working"; label: string }
  | { status: "failed"; code: string; message: string; correlationId?: string };

/** Entitlement state -> Member-facing label; unknown states stay verbatim. */
function describeEntitlementState(state: string): { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" } {
  switch (state) {
    case "ACTIVE": return { label: "กำลังใช้งาน", tone: "success" };
    case "RELEASE_PENDING": return { label: "รอการเปลี่ยนเป็นเงินสด", tone: "warning" };
    case "COMPLETED": return { label: "เสร็จสมบูรณ์", tone: "success" };
    case "EXPIRED": return { label: "หมดอายุ", tone: "danger" };
    case "REVOKED": return { label: "ถูกเพิกถอน", tone: "danger" };
    default: return { label: state, tone: "neutral" };
  }
}

/** Turnover entry state -> Member-facing label (provisional vs finalized). */
function describeTurnoverEntry(state: string): { label: string; tone: "success" | "warning" | "neutral" } {
  switch (state) {
    case "PROVISIONAL": return { label: "ยอดชั่วคราว", tone: "warning" };
    case "FINALIZED": return { label: "ยอดยืนยันแล้ว", tone: "success" };
    case "REMOVED": return { label: "นำยอดออกแล้ว", tone: "neutral" };
    default: return { label: state, tone: "neutral" };
  }
}

/** Basis points -> percent. Exact for the integer values the API publishes. */
function contributionBpsLabel(bps: number): string {
  return `${bps / 100}%`;
}

export default function PromotionsPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [action, setAction] = useState<ActionState>({ status: "idle" });
  const [openEntitlement, setOpenEntitlement] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [discovery, page] = await Promise.all([
      memberApi.listPromotions(),
      memberApi.listPromotionEntitlements({ limit: 20 }),
    ]);
    return { campaigns: discovery.items, entitlements: page.items, asOf: discovery.asOf };
  }, []);

  useEffect(() => {
    let active = true;
    load()
      .then((data) => {
        if (active) setState({ status: "ready", ...data });
      })
      .catch((loadError) => {
        if (!active) return;
        const failure = describeMemberApiFailure(loadError);
        setState({ status: "failed", message: failure.message, code: failure.code, correlationId: failure.correlationId });
      });
    return () => {
      active = false;
    };
  }, [load]);

  const claim = async (item: PromotionDiscoveryItem) => {
    setAction({ status: "working", label: `กำลังรับสิทธิ์ ${item.campaignCode}` });
    try {
      const entitlement = await memberApi.claimPromotion(item.campaignVersionId, createIdempotencyKey());
      setState((current) => current.status === "ready"
        ? { ...current, entitlements: [entitlement, ...current.entitlements.filter((existing) => existing.id !== entitlement.id)] }
        : current);
      setAction({ status: "idle" });
    } catch (error) {
      const failure = describeMemberApiFailure(error);
      setAction({ status: "failed", code: failure.code, message: failure.message, correlationId: failure.correlationId });
    }
  };

  if (state.status === "loading") {
    return <main id="main"><div className="breadcrumb"><Link href="/">หน้าแรก</Link><span>/</span><span>โปรโมชั่น</span></div><section className="panel"><div className="panel-title"><h2>กำลังโหลดโปรโมชั่น</h2></div><p className="muted small">กำลังดึงแคมเปญและสิทธิ์ของบัญชีคุณจาก API…</p></section></main>;
  }

  if (state.status === "failed") {
    return <main id="main"><div className="breadcrumb"><Link href="/">หน้าแรก</Link><span>/</span><span>โปรโมชั่น</span></div><section className="panel"><div className="panel-title"><h2>โหลดโปรโมชั่นไม่สำเร็จ</h2><span className="status danger">{state.code}</span></div><p className="muted small">{state.message}</p>{state.correlationId && <p className="muted small">รหัสอ้างอิง: {state.correlationId}</p>}</section></main>;
  }

  const { campaigns, entitlements, asOf } = state;
  const active = entitlements.filter((entitlement) => entitlement.state === "ACTIVE" || entitlement.state === "RELEASE_PENDING");
  const provisionalTotal = entitlements.reduce((total, entitlement) => total + BigInt(entitlement.turnover.provisionalMinor), 0n);
  const finalizedTotal = entitlements.reduce((total, entitlement) => total + BigInt(entitlement.turnover.finalizedMinor), 0n);

  return <main id="main">
    <div className="breadcrumb"><Link href="/">หน้าแรก</Link><span>/</span><span>โปรโมชั่น</span></div>
    <div className="page-head promotion-page-head"><div><p className="pt-eyebrow">สิทธิ์โบนัสของฉัน</p><h1>โปรโมชั่นและยอดเล่น</h1><p>ตัวเลขทั้งหมดด้านล่างคือค่าจริงจากระบบโปรโมชั่น ณ {formatDateTime(asOf)} รวมยอดชั่วคราวที่ยังไม่ถึงผลสิ้นสุด</p></div><Link className="button secondary" href="/wallet">ดูกระเป๋า</Link></div>

    <section className="pt-balance-strip" aria-label="สรุปยอดเล่น">
      <div><span>สิทธิ์ที่กำลังใช้งาน</span><strong>{active.length} <small>รายการ</small></strong></div>
      <div><span>ยอดเล่นยืนยันแล้ว (รวมทุกสิทธิ์)</span><strong>{formatBaht(finalizedTotal)}</strong></div>
      <div><span>ยอดเล่นชั่วคราว</span><strong className="pt-provisional-number">{formatBaht(provisionalTotal)}</strong></div>
      <div><span>สิทธิ์ทั้งหมด</span><strong>{entitlements.length} <small>รายการ</small></strong></div>
    </section>

    {action.status === "failed" && <div className="notice warning" aria-live="polite"><b>!</b><div><strong>ดำเนินการไม่สำเร็จ ({action.code})</strong>{action.message}{action.correlationId ? ` · รหัสอ้างอิง ${action.correlationId}` : ""}</div></div>}

    <div className="pt-layout">
      <div className="stack">
        {entitlements.length === 0 && <section className="panel"><div className="panel-title"><h2>ยังไม่มีสิทธิ์โบนัส</h2></div><div className="notice info"><b>i</b><div><strong>ไม่พบสิทธิ์ในบัญชีนี้</strong>เมื่อคุณรับสิทธิ์จากแคมเปญที่เข้าเงื่อนไข สิทธิ์จะปรากฏที่นี่พร้อมยอดเล่นจริง</div></div></section>}
        {entitlements.map((entitlement) => {
          const status = describeEntitlementState(entitlement.state);
          const target = BigInt(entitlement.turnover.targetMinor);
          const progress = BigInt(entitlement.turnover.progressMinor);
          const percent = target > 0n ? Number((progress * 100n) / target) : 0;
          const open = openEntitlement === entitlement.id;
          return <section className="pt-entitlement-card" key={entitlement.id}>
            <div className="pt-card-top"><div><div className="pt-title-row"><span className="pt-gift-mark" aria-hidden="true">✦</span><div><p className="pt-card-kicker">สิทธิ์ {entitlement.id.slice(0, 8)}…</p><h2>{entitlement.campaignCode} · โบนัส {formatBaht(entitlement.rewardMinor)}</h2></div></div><p className="pt-card-copy">สิทธิ์นี้เก็บเงื่อนไข (terms) ที่บันทึกไว้ตอนรับสิทธิ์ การเปลี่ยนเงื่อนไขของแคมเปญภายหลังไม่แก้ประวัติของสิทธิ์นี้</p></div><span className={`status ${status.tone}`}>{status.label}</span></div>
            <div className="pt-progress-block">
              <div className="pt-progress-heading"><div><span>ยอดเล่นที่ยืนยันแล้ว</span><strong>{formatBaht(progress)} / {formatBaht(target)}</strong></div><strong className="pt-percent">{percent}%</strong></div>
              <div className="pt-progress-track" role="progressbar" aria-label="ยอดเล่นที่ยืนยันแล้ว" aria-valuemin={0} aria-valuemax={Number(target)} aria-valuenow={Number(progress)}><span style={{ width: `${Math.min(100, percent)}%` }} /></div>
              <div className="pt-provisional-callout"><span className="pt-dot" aria-hidden="true" /><div><strong>ยอดชั่วคราว {formatBaht(entitlement.turnover.provisionalMinor)}</strong><span>เกิดจากรายการที่ยืนยันแล้วแต่ยังไม่ถึงผลสิ้นสุด จึงยังไม่รวมในยอดยืนยันแล้ว · ยังต้องทำอีก {formatBaht(entitlement.turnover.remainingMinor)}</span></div><button type="button" className="pt-text-button" onClick={() => setOpenEntitlement(open ? null : entitlement.id)} aria-expanded={open}>{open ? "ซ่อนที่มา" : "ดูที่มา"}</button></div>
            </div>
            <div className="pt-fact-grid">
              <div className="pt-fact"><span>โบนัสของสิทธิ์</span><strong>{formatBaht(entitlement.rewardMinor)}</strong><small>ยอดที่ปลดแล้ว {formatBaht(entitlement.releasedMinor)}</small></div>
              <div className="pt-fact"><span>เป้าหมายยอดเล่น</span><strong>{formatBaht(entitlement.turnover.targetMinor)}</strong><small>ถึงเป้าแล้วเมื่อ {formatDateTime(entitlement.completedAt)}</small></div>
              <div className="pt-fact"><span>รับสิทธิ์เมื่อ</span><strong>{formatDateTime(entitlement.grantedAt)}</strong><small>หมดอายุ {formatDateTime(entitlement.expiresAt)}</small></div>
              <div className="pt-fact"><span>รหัสธุรกรรม Ledger</span><strong className="small">{entitlement.grantLedgerTransactionId ?? "—"}</strong><small>ปลดเมื่อ {entitlement.releaseLedgerTransactionId ?? "—"}</small></div>
            </div>
            {open && <div className="pt-tab-panels"><section className="pt-tab-panel"><div className="pt-section-title"><div><p>ประวัติที่เก็บย้อนหลัง</p><h3>ยอดชั่วคราว ยอดยืนยัน และการนำออก</h3></div></div>
              {entitlement.turnoverEntries.length === 0
                ? <p className="muted small">ยังไม่มีรายการยอดเล่นที่บันทึกไว้สำหรับสิทธิ์นี้</p>
                : <ol className="pt-history">{entitlement.turnoverEntries.map((entry) => {
                  const entryStatus = describeTurnoverEntry(entry.state);
                  return <li key={`${entry.betReference}-${entry.occurredAt}-${entry.state}`}><div className={`pt-history-icon ${entry.state === "PROVISIONAL" ? "provisional" : entry.state === "REMOVED" ? "removed" : "final"}`}>{entry.entryKind === "ADJUSTMENT" ? "±" : entry.state === "REMOVED" ? "↩" : "✓"}</div><div><strong>{entry.betReference} · {entry.entryKind}</strong><span>{formatDateTime(entry.occurredAt)} · {entryStatus.label}</span></div><span className={`pt-history-amount ${entry.state === "PROVISIONAL" ? "provisional" : entry.state === "REMOVED" ? "removed" : "final"}`}>{formatBaht(entry.contributionMinor)}</span></li>;
                })}</ol>}
              <div className="pt-history-total"><div><span>ยอดยืนยันแล้วปัจจุบัน</span><strong>{formatBaht(entitlement.turnover.progressMinor)}</strong></div><div><span>ยอดชั่วคราวปัจจุบัน</span><strong>{formatBaht(entitlement.turnover.provisionalMinor)}</strong></div></div>
            </section></div>}
            <p className="muted small">การดำเนินการที่ระบบอนุญาตสำหรับสิทธิ์นี้: {entitlement.allowedActions.length ? entitlement.allowedActions.join(", ") : "—"} · ปลดสิทธิ์เมื่อ {entitlement.turnover.releaseReached ? "ถึงเป้าแล้ว" : "ยังไม่ถึงเป้า"}</p>
          </section>;
        })}

        <section className="panel"><div className="panel-title"><h2>แคมเปญที่เปิดให้รับ</h2><span className="muted small">{campaigns.length} แคมเปญ</span></div>
          {campaigns.length === 0
            ? <p className="muted small">ยังไม่มีแคมเปญที่เผยแพร่ให้ Member เห็นในขณะนี้</p>
            : <div className="stack">{campaigns.map((campaign) => <div className="pt-side-card" key={campaign.campaignVersionId}>
              <div className="pt-section-title"><div><p>{campaign.campaignCode} · v{campaign.campaignVersion}</p><h3>โบนัส {formatBaht(campaign.rewardAmountMinor)} · เป้ายอดเล่น {formatBaht(campaign.turnoverTargetMinor)}</h3></div><span className={`status ${campaign.eligible ? "success" : "warning"}`}>{campaign.eligible ? "เข้าเงื่อนไข" : "ยังไม่เข้าเงื่อนไข"}</span></div>
              <p className="muted small">ผลตอบแทนคิด {contributionBpsLabel(campaign.contributionBps)} ของยอดที่เข้าเงื่อนไข · ปลายทางรางวัล {campaign.winningsDestination} · รูปแบบ {campaign.stackingMode} · มีผล {formatDateTime(campaign.effectiveFrom)} ถึง {formatDateTime(campaign.effectiveUntil)} · หมดอายุ {formatDateTime(campaign.expiresAt)}</p>
              {!campaign.eligible && campaign.ineligibilityReasons.length > 0 && <div className="notice warning"><b>!</b><div><strong>ยังรับไม่ได้ในขณะนี้</strong>{campaign.ineligibilityReasons.join(", ")}</div></div>}
              <button className={`button ${campaign.eligible ? "primary" : "secondary"}`} type="button" style={{ marginTop: 10 }} disabled={!campaign.eligible || action.status === "working"} onClick={() => claim(campaign)}>{action.status === "working" ? `${action.label}…` : "รับสิทธิ์นี้"}</button>
            </div>)}</div>}
        </section>
      </div>
      <aside className="pt-side-stack">
        <section className="pt-side-card"><div className="pt-section-title"><div><p>สถานะยอดเล่น</p><h3>ต่างกันอย่างไร?</h3></div></div><div className="pt-legend-row"><span className="pt-legend-dot provisional" /><div><strong>ชั่วคราว</strong><span>เกิดหลังยืนยันรายการที่เข้าเงื่อนไข แต่ยังรอผลสิ้นสุด</span></div></div><div className="pt-legend-row"><span className="pt-legend-dot final" /><div><strong>ยืนยันแล้ว</strong><span>มาจากรายการที่ถึงผลสิ้นสุดและไม่ถูกคืนเงิน</span></div></div><div className="pt-legend-row"><span className="pt-legend-dot correction" /><div><strong>ปรับแก้ / นำออก</strong><span>เพิ่มหรือลดยอดด้วยเหตุการณ์ชดเชย โดยเก็บประวัติเดิมไว้</span></div></div></section>
        <section className="pt-side-card pt-expiry-card"><div className="pt-expiry-icon">⌛</div><div><p>สัดส่วนผลตอบแทน</p><h3>ผลตอบแทนคิดเป็นสัดส่วนของยอดที่เข้าเงื่อนไข</h3><span>ระบบใช้ค่าสัดส่วน (basis points) ที่บันทึกไว้กับสิทธิ์ของคุณ เช่น 1,000 bps = 10%</span></div></section>
        <section className="pt-side-card"><div className="pt-section-title"><div><p>อัตราจ่ายที่ระบบใช้</p><h3>รูปแบบค่าคอนฟิก</h3></div></div><p className="muted small">อัตราจ่ายที่ Member เห็นในหน้าซื้อหวยและใบรับรายการมาจากค่าคอนฟิกของ Bet Type เช่น {formatPayoutMultiplier(parseFixedPayout({ kind: "FIXED", amountMinor: 90000 })?.amountMinor ?? 0n)} หมายถึงได้ 900 บาทต่อการซื้อ 1 บาท</p></section>
      </aside>
    </div>
  </main>;
}
