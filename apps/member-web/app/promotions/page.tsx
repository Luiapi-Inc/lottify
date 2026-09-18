"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createIdempotencyKey,
  memberApi,
  type PromotionDiscovery,
  type PromotionEntitlement,
  type PromotionEntitlementPage,
} from "../lib/member-api";
import { ErrorState, LoadingState, Money, PageHeading, Section, StatusBadge } from "../components/presentation";

export default function PromotionsPage() {
  const [discovery, setDiscovery] = useState<PromotionDiscovery | null>(null);
  const [entitlements, setEntitlements] = useState<PromotionEntitlementPage | null>(null);
  const [selected, setSelected] = useState<PromotionEntitlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<unknown>(null);
  const claimKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [promotionResult, entitlementResult] = await Promise.allSettled([
      memberApi.listPromotions(),
      memberApi.listPromotionEntitlements({ limit: 50 }),
    ]);
    if (promotionResult.status === "fulfilled") setDiscovery(promotionResult.value);
    else setError(promotionResult.reason);
    if (entitlementResult.status === "fulfilled") {
      setEntitlements(entitlementResult.value);
      if (entitlementResult.value.items[0]) {
        try {
          setSelected(await memberApi.getPromotionEntitlement(entitlementResult.value.items[0].id));
        } catch (cause) {
          setError(cause);
        }
      } else {
        setSelected(null);
      }
    } else {
      setError(entitlementResult.reason);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function claim(campaignVersionId: string) {
    setBusy(`claim:${campaignVersionId}`);
    setError(null);
    const key = claimKeys.current.get(campaignVersionId) ?? createIdempotencyKey();
    claimKeys.current.set(campaignVersionId, key);
    try {
      const result = await memberApi.claimPromotion({ campaignVersionId }, key);
      setSelected(result);
      const refreshed = await memberApi.listPromotionEntitlements({ limit: 50 });
      setEntitlements(refreshed);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy("");
    }
  }

  async function selectEntitlement(id: string) {
    setBusy(`detail:${id}`);
    setError(null);
    try {
      setSelected(await memberApi.getPromotionEntitlement(id));
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy("");
    }
  }

  return <main id="main">
    <PageHeading
      eyebrow="PROMOTIONS"
      title="สิทธิ์ โบนัส และ Turnover ที่ตรวจสอบย้อนกลับได้"
      description="Discovery แสดงสิทธิ์ที่ claim ได้ ส่วน Entitlement แสดง snapshot ของเงื่อนไขและ turnover จริง รวม provisional/finalized history โดยไม่สร้างยอดตัวอย่าง"
      action={<button className="button secondary" type="button" onClick={() => void load()}>รีเฟรช</button>}
    />

    {loading ? <LoadingState label="กำลังโหลด Promotion discovery และ Entitlements…" /> : null}
    {error ? <div style={{ marginBottom: 16 }}><ErrorState error={error} retry={() => void load()} /></div> : null}

    <section className="grid-2">
      <div className="stack">
        <Section title="โปรโมชั่นที่ค้นพบ" subtitle={discovery ? `ข้อมูล ณ ${new Date(discovery.asOf).toLocaleString("th-TH")}` : "GET /promotions"}>
          {discovery?.items.length ? <div className="data-list">{discovery.items.map((item) => <div className="data-row" key={item.campaignVersionId}>
            <div className="data-main">
              <strong>{item.campaignCode}</strong>
              <span>Reward <Money minor={item.rewardAmountMinor} /> · เป้า Turnover <Money minor={item.turnoverTargetMinor} /> · {item.contributionBps / 100}% contribution</span>
              {!item.eligible && item.ineligibilityReasons.length ? <span>{item.ineligibilityReasons.join(" · ")}</span> : null}
            </div>
            <div className="data-meta">
              <StatusBadge tone={item.eligible ? "success" : "warning"}>{item.eligible ? "ELIGIBLE" : "INELIGIBLE"}</StatusBadge>
              {item.eligible ? <button className="text-button" type="button" disabled={busy === `claim:${item.campaignVersionId}`} onClick={() => void claim(item.campaignVersionId)}>{busy === `claim:${item.campaignVersionId}` ? "กำลังรับสิทธิ์…" : "รับสิทธิ์"}</button> : null}
            </div>
          </div>)}</div> : !loading ? <div className="state-card"><span className="state-symbol">○</span><div><strong>ไม่มีแคมเปญที่ค้นพบ</strong><p>UI จะไม่แสดงโปรโมชั่นจำลองแทน API</p></div></div> : null}
        </Section>

        <Section title="Entitlements ของฉัน" subtitle={entitlements ? `${entitlements.items.length} สิทธิ์` : "GET /promotions/entitlements"}>
          {entitlements?.items.length ? <div className="data-list">{entitlements.items.map((item) => <button
            key={item.id}
            type="button"
            className="data-row"
            style={{ width: "100%", textAlign: "left", borderTop: 0, borderLeft: 0, borderRight: 0, cursor: "pointer", background: selected?.id === item.id ? "var(--mint)" : "transparent" }}
            onClick={() => void selectEntitlement(item.id)}
          >
            <div className="data-main"><strong>{item.campaignCode}</strong><span>{item.id} · หมดอายุ {new Date(item.expiresAt).toLocaleString("th-TH")}</span></div>
            <StatusBadge tone={item.state === "ACTIVE" || item.state === "COMPLETED" ? "success" : item.state === "REVOKED" ? "danger" : "warning"}>{item.state}</StatusBadge>
          </button>)}</div> : !loading ? <div className="state-card"><span className="state-symbol">○</span><div><strong>ยังไม่มี Entitlement</strong><p>รับสิทธิ์จากแคมเปญที่ eligible ด้านบน</p></div></div> : null}
        </Section>
      </div>

      <aside className="stack">
        <Section title="รายละเอียดสิทธิ์" subtitle="GET entitlement by id">
          {selected ? <>
            <div className="data-row"><div className="data-main"><strong>{selected.campaignCode}</strong><span>Campaign v{selected.campaignVersion} · entitlement v{selected.version}</span></div><StatusBadge tone={selected.state === "ACTIVE" || selected.state === "COMPLETED" ? "success" : "warning"}>{selected.state}</StatusBadge></div>
            <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))", marginTop: 12 }}>
              <div className="kpi"><div className="kpi-label">Reward</div><div className="kpi-value" style={{ fontSize: 22 }}><Money minor={selected.rewardMinor} /></div></div>
              <div className="kpi"><div className="kpi-label">Remaining turnover</div><div className="kpi-value" style={{ fontSize: 22 }}><Money minor={selected.turnover.remainingMinor} /></div></div>
              <div className="kpi"><div className="kpi-label">Finalized</div><div className="kpi-value" style={{ fontSize: 22 }}><Money minor={selected.turnover.finalizedMinor} /></div></div>
              <div className="kpi"><div className="kpi-label">Provisional</div><div className="kpi-value" style={{ fontSize: 22 }}><Money minor={selected.turnover.provisionalMinor} /></div></div>
            </div>
            <div className="notice info" style={{ marginTop: 12 }}><b>i</b><div><strong>Allowed actions</strong>{selected.allowedActions.join(", ") || "ไม่มี action"} · releaseReached = {String(selected.turnover.releaseReached)}</div></div>
          </> : <div className="state-card"><span className="state-symbol">○</span><div><strong>เลือก Entitlement</strong><p>รายละเอียด turnover และ terms จะอ่านจาก resource โดยตรง</p></div></div>}
        </Section>

        {selected ? <Section title="Turnover history" subtitle="เก็บ provisional/finalized/removed แยกเหตุการณ์">
          {selected.turnoverEntries.length ? <div className="data-list">{selected.turnoverEntries.map((entry, index) => <div className="data-row" key={`${entry.betReference}:${index}`}>
            <div className="data-main"><strong>{entry.entryKind} · {entry.betReference}</strong><span>{new Date(entry.occurredAt).toLocaleString("th-TH")}</span></div>
            <div className="data-meta"><strong><Money minor={entry.contributionMinor} /></strong><StatusBadge tone={entry.state === "FINALIZED" ? "success" : entry.state === "REMOVED" ? "danger" : "warning"}>{entry.state}</StatusBadge></div>
          </div>)}</div> : <div className="state-card"><span className="state-symbol">○</span><div><strong>ยังไม่มี Turnover entry</strong><p>ประวัติจะไม่ถูกสร้างจากยอดรวมใน client</p></div></div>}
        </Section> : null}

        <Link className="button secondary block" href="/wallet">← กลับกระเป๋า</Link>
      </aside>
    </section>
  </main>;
}
