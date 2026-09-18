"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { memberApi, type BetOrder, type BetOrderList } from "../lib/member-api";
import { ErrorState, LoadingState, Money, PageHeading, Section, StatusBadge } from "../components/presentation";

const states: Array<BetOrder["state"] | "ALL"> = ["ALL","CONFIRMED","SETTLED","CANCELLING","CANCELLED","REJECTED","EXPIRED"];

export default function SlipsPage() {
  const [filter, setFilter] = useState<BetOrder["state"] | "ALL">("ALL");
  const [page, setPage] = useState<BetOrderList | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (state = filter) => {
    setLoading(true);
    setError(null);
    try {
      setPage(await memberApi.listOrders({ state: state === "ALL" ? undefined : state, limit: 30 }));
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(filter); }, [filter, load]);

  async function loadMore() {
    if (!page?.nextCursor) return;
    setLoadingMore(true);
    try {
      const next = await memberApi.listOrders({ state: filter === "ALL" ? undefined : filter, cursor: page.nextCursor, limit: 30 });
      setPage({ items: [...page.items, ...next.items], nextCursor: next.nextCursor });
    } catch (cause) {
      setError(cause);
    } finally {
      setLoadingMore(false);
    }
  }

  return <main id="main">
    <PageHeading eyebrow="ORDERS" title="โพยของฉัน" description="ทุกแถวคือ Bet Order จาก API เปิดดู Receipt, Settlement, cancellation และ correction-aware outcome ได้จากหน้ารายละเอียด" action={<button className="button secondary" type="button" onClick={() => void load()}>รีเฟรช</button>} />

    <div className="section-tabs">
      {states.map((state) => <button className={`tab ${filter === state ? "active" : ""}`} key={state} type="button" onClick={() => setFilter(state)}>{state === "ALL" ? "ทั้งหมด" : state}</button>)}
    </div>

    {loading ? <LoadingState label="กำลังโหลด Bet Orders…" /> : null}
    {error ? <div style={{ marginBottom: 16 }}><ErrorState error={error} retry={() => void load()} /></div> : null}

    <Section title="รายการ Bet Order" subtitle={page ? `${page.items.length} รายการที่โหลดแล้ว` : "GET /orders"}>
      {page?.items.length ? <div className="data-list">{page.items.map((order) => <Link className="data-row" key={order.id} href={`/slips/detail?id=${encodeURIComponent(order.id)}`}>
        <div className="data-main">
          <strong>{order.lines.map((line) => line.canonicalNumber).join(" · ") || order.id}</strong>
          <span>{order.id} · {new Date(order.createdAt).toLocaleString("th-TH")} · {order.lines.length} lines</span>
        </div>
        <div className="data-meta"><strong><Money minor={order.totalStakeMinor} /></strong><StatusBadge tone={order.state === "CONFIRMED" || order.state === "SETTLED" ? "success" : order.state === "REJECTED" ? "danger" : order.state === "CANCELLED" ? "neutral" : "info"}>{order.state}</StatusBadge></div>
      </Link>)}</div> : !loading ? <div className="state-card"><span className="state-symbol">○</span><div><strong>ไม่พบโพยในสถานะนี้</strong><p>รายการจะมาจาก backend เท่านั้น ไม่มี fixture เติมแทน</p></div></div> : null}
      {page?.nextCursor ? <button className="button secondary block" style={{ marginTop: 14 }} type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "กำลังโหลด…" : "โหลดเพิ่ม"}</button> : null}
    </Section>
  </main>;
}
