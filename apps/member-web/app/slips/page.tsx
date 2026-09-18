"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { memberApi, type BetOrder, type BetOrderState } from "../lib/member-api";
import { describeMemberApiFailure, describeOrderState, formatBaht, formatDateTime } from "../lib/member-display";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; orders: BetOrder[]; nextCursor: string | null }
  | { status: "failed"; message: string; code: string; correlationId?: string };

const STATES: BetOrderState[] = [
  "DRAFT",
  "QUOTED",
  "CONFIRMING",
  "CONFIRMED",
  "CANCELLING",
  "CANCELLED",
  "EXPIRED",
  "REJECTED",
  "SETTLED",
];

const PAGE_SIZE = 20;

export default function SlipsPage() {
  const [stateFilter, setStateFilter] = useState<string>("");
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (filter: string) => {
    const page = await memberApi.listOrders({ limit: PAGE_SIZE, state: filter || undefined });
    return { orders: page.items, nextCursor: page.nextCursor };
  }, []);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    load(stateFilter)
      .then((page) => {
        if (active) setState({ status: "ready", ...page });
      })
      .catch((loadError) => {
        if (!active) return;
        const failure = describeMemberApiFailure(loadError);
        setState({ status: "failed", message: failure.message, code: failure.code, correlationId: failure.correlationId });
      });
    return () => {
      active = false;
    };
  }, [stateFilter, load]);

  const loadMore = async () => {
    if (state.status !== "ready" || !state.nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await memberApi.listOrders({ limit: PAGE_SIZE, state: stateFilter || undefined, cursor: state.nextCursor });
      setState({ status: "ready", orders: [...state.orders, ...page.items], nextCursor: page.nextCursor });
    } catch (loadError) {
      const failure = describeMemberApiFailure(loadError);
      setState({ status: "failed", message: failure.message, code: failure.code, correlationId: failure.correlationId });
    } finally {
      setLoadingMore(false);
    }
  };

  return <main id="main">
    <div className="page-head">
      <div><h1>โพยของฉัน</h1><p>รายการที่แสดงคือรายการจริงในบัญชีของคุณ พร้อมสถานะ ลิงก์ใบรับรายการ และผลการตัดสินผลเมื่อมี</p></div>
      <Link className="button primary" href="/buy">+ ซื้อหวย</Link>
    </div>
    <section className="panel">
      <div className="filters">
        <div className="field"><label htmlFor="slip-status">สถานะ</label><select id="slip-status" className="select" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}><option value="">ทั้งหมด</option>{STATES.map((value) => <option value={value} key={value}>{describeOrderState(value).label} ({value})</option>)}</select></div>
        <button className="button secondary" type="button" onClick={() => setStateFilter("")}>ล้างตัวกรอง</button>
      </div>
    </section>

    {state.status === "loading" && <section className="panel" style={{ marginTop: 18 }}><div className="panel-title"><h2>กำลังโหลดโพย</h2></div><p className="muted small">กำลังดึงรายการจาก API…</p></section>}

    {state.status === "failed" && <section className="panel" style={{ marginTop: 18 }}><div className="panel-title"><h2>โหลดรายการไม่สำเร็จ</h2><span className="status danger">{state.code}</span></div><p className="muted small">{state.message}</p>{state.correlationId && <p className="muted small">รหัสอ้างอิง: {state.correlationId}</p>}</section>}

    {state.status === "ready" && <section className="panel" style={{ marginTop: 18 }}>
      <div className="panel-title"><h2>รายการล่าสุด</h2><span className="muted small">แสดง {state.orders.length} โพย</span></div>
      {state.orders.length === 0
        ? <div className="notice info"><b>i</b><div><strong>ยังไม่มีโพยในบัญชีนี้</strong>เมื่อคุณยืนยันรายการซื้อสำเร็จ โพยจะปรากฏที่นี่ทันทีจากข้อมูลของเซิร์ฟเวอร์</div></div>
        : <div className="table-wrap"><table><thead><tr><th>วัน / เวลา</th><th>สินค้า / งวด</th><th>รายการ</th><th>ยอดซื้อ</th><th>สถานะ</th><th /></tr></thead><tbody>
          {state.orders.map((order) => {
            const status = describeOrderState(order.state);
            return <tr key={order.id}><td>{formatDateTime(order.createdAt)}</td><td><strong>{order.productId}</strong><br /><span className="muted">งวด {order.drawId}</span></td><td>{order.lines.length} รายการ</td><td>{formatBaht(order.totalStakeMinor)}</td><td><span className={`status ${status.tone}`}>{status.label}</span></td><td><Link className="text-link" href={`/slips/detail?orderId=${encodeURIComponent(order.id)}`}>ดูรายละเอียด →</Link></td></tr>;
          })}
        </tbody></table></div>}
      {state.nextCursor && <button className="button secondary" type="button" style={{ marginTop: 14 }} onClick={loadMore} disabled={loadingMore}>{loadingMore ? "กำลังโหลด…" : "โหลดเพิ่มเติม"}</button>}
    </section>}
  </main>;
}
