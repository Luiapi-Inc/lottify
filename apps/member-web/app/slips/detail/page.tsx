"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  memberApi,
  type BetOrder,
  type BetReceipt,
  type MemberSettlementOutcome,
} from "../../lib/member-api";
import {
  describeFailureCode,
  describeMemberApiFailure,
  describeOrderState,
  describeResolvedPayout,
  formatBaht,
  formatDateTime,
} from "../../lib/member-display";

type Detail = {
  order: BetOrder;
  receipt: BetReceipt | null;
  settlement: MemberSettlementOutcome | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; detail: Detail }
  | { status: "failed"; message: string; code: string; correlationId?: string };

type TimelineEvent = {
  id: number;
  tone: "info" | "success" | "warning" | "danger" | "neutral";
  meta: string;
  badge: string;
  title: string;
  body: string;
  current?: boolean;
};

/** Build the timeline from the server's own facts only: nothing is shown that
 *  the Order / Receipt / Settlement resources do not actually state. */
function buildTimeline({ order, receipt, settlement }: Detail): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  let id = 1;
  events.push({
    id: id++,
    tone: "info",
    meta: `สร้างรายการ · ${formatDateTime(order.createdAt)}`,
    badge: "Bet Order",
    title: "สร้างรายการจาก Quote ที่อนุมัติแล้ว",
    body: `Quote ${order.quoteId} ถูกนำมาสร้างรายการนี้ ยังไม่มีการเคลื่อนไหวทางการเงินในขั้นตอนนี้`,
  });
  if (order.confirmedAt) {
    events.push({
      id: id++,
      tone: "success",
      meta: `ยืนยันรายการ · ${formatDateTime(order.confirmedAt)}`,
      badge: "Confirmed",
      title: `ยืนยันรายการ ยอดซื้อ ${formatBaht(order.totalStakeMinor)}`,
      body: `ระบบกันเงินและบันทึกยอดซื้อสำเร็จ (รหัสธุรกรรมกันเงิน ${order.stakeTransactionId ?? "—"} · รหัสการจอง ${order.reservationId ?? "—"})`,
    });
  }
  if (order.state === "REJECTED" || order.rejectionReason) {
    events.push({
      id: id++,
      tone: "danger",
      meta: `ถูกปฏิเสธ · ${formatDateTime(order.rejectedAt ?? order.updatedAt)}`,
      badge: "Rejected",
      title: `ระบบปฏิเสธการยืนยัน: ${order.rejectionReason ?? "ไม่ระบุรหัส"}`,
      body: describeFailureCode(order.rejectionReason ?? "UNKNOWN"),
    });
  }
  if (order.cancelledAt) {
    events.push({
      id: id++,
      tone: "neutral",
      meta: `ยกเลิก · ${formatDateTime(order.cancelledAt)}`,
      badge: "Cancelled",
      title: `ยกเลิกรายการและคืนเงิน ${formatBaht(order.totalStakeMinor)}`,
      body: `รหัสธุรกรรมคืนเงิน ${order.refundTransactionId ?? "—"}${order.cancellationReason ? ` · เหตุผล ${order.cancellationReason}` : ""}`,
    });
  }
  if (receipt) {
    events.push({
      id: id++,
      tone: "info",
      meta: `ออกใบรับรายการ · ${formatDateTime(receipt.issuedAt)}`,
      badge: `Receipt v${receipt.orderVersion}`,
      title: "ออกใบรับรายการที่เก็บเงื่อนไขซึ่งยอมรับไว้",
      body: `รหัสตรวจสอบเนื้อหา (SHA-256) ${receipt.contentDigest} · งวด ${receipt.terms.drawReference ?? "—"} · ปิดรับ ${formatDateTime(receipt.terms.drawCutoffAt)}`,
    });
  }
  if (settlement) {
    const label = settlement.outcome === "WIN" ? "ถูกรางวัล" : settlement.outcome === "LOSE" ? "ไม่ถูกรางวัล" : "ยังไม่ทราบผล";
    events.push({
      id: id++,
      tone: settlement.authoritative ? (settlement.outcome === "WIN" ? "success" : "neutral") : "warning",
      meta: `ตัดสินผล · ${settlement.batchState ?? "ไม่มีรอบตัดสินผล"}`,
      badge: settlement.authoritative ? "Authoritative" : "Provisional",
      title: `${label} · เงินรางวัล ${formatBaht(settlement.payoutMinor)}`,
      body: settlement.authoritative
        ? "ผลนี้เป็นผลใช้งานปัจจุบันของรายการนี้"
        : "รอบตัดสินผลยังไม่เสร็จสมบูรณ์ (COMPLETED) ระบบจึงยังไม่ถือว่ายอดนี้เป็นผลสุดท้าย",
      current: true,
    });
  }
  return events;
}

export default function SlipDetailPage() {
  const [orderId, setOrderId] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [filter, setFilter] = useState<"all" | "current">("all");

  const load = useCallback(async (id: string): Promise<Detail> => {
    const order = await memberApi.getOrder(id);
    const receipt = order.receiptId ? await memberApi.getReceipt(order.id) : null;
    // A settlement outcome may legitimately not exist yet; that is a state, not
    // a page error, so a failed read degrades to null instead of blanking the page.
    const settlement = await memberApi.getSettlement(order.id).catch(() => null);
    return { order, receipt, settlement };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOrderId(params.get("orderId"));
  }, []);

  useEffect(() => {
    if (orderId === null) return;
    if (!orderId) {
      setState({ status: "failed", message: "ไม่พบโพยที่จะแสดง กรุณาเปิดจากหน้าโพยของฉัน", code: "ORDER_NOT_SELECTED" });
      return;
    }
    let active = true;
    load(orderId)
      .then((detail) => {
        if (active) setState({ status: "ready", detail });
      })
      .catch((loadError) => {
        if (!active) return;
        const failure = describeMemberApiFailure(loadError);
        setState({ status: "failed", message: failure.message, code: failure.code, correlationId: failure.correlationId });
      });
    return () => {
      active = false;
    };
  }, [orderId, load]);

  if (state.status === "loading" || orderId === null) {
    return <main id="main"><section className="panel"><div className="panel-title"><h2>กำลังโหลดรายละเอียดโพย</h2></div><p className="muted small">กำลังดึงรายการ ใบรับรายการ และผลตัดสินผลจาก API…</p></section></main>;
  }

  if (state.status === "failed") {
    return <main id="main"><section className="panel"><div className="panel-title"><h2>เปิดโพยนี้ไม่ได้</h2><span className="status danger">{state.code}</span></div><p className="muted small">{state.message}</p>{state.correlationId && <p className="muted small">รหัสอ้างอิง: {state.correlationId}</p>}<Link className="button secondary" href="/slips" style={{ marginTop: 12 }}>← กลับรายการโพย</Link></section></main>;
  }

  const { order, receipt, settlement } = state.detail;
  const status = describeOrderState(order.state);
  const events = buildTimeline(state.detail);
  const shown = filter === "all" ? events : events.filter((event) => event.current);
  const lines = receipt ? receipt.terms.lines : order.lines;

  return <main id="main">
    <div className="breadcrumb"><Link href="/slips">โพยของฉัน</Link><span>/</span><span>{order.id}</span></div>
    <div className="page-head"><div><h1>งวด {order.drawId}</h1><p>รายละเอียดทั้งหมดด้านล่างมาจาก Order, Receipt และ Settlement ของรายการนี้โดยตรง ไม่มีการเขียนทับประวัติเดิม</p></div><span className={`status ${status.tone}`}>{status.label}</span></div>
    <section className="grid-2">
      <div className="stack">
        <section className="panel"><div className="panel-title"><h2>ใบรับรายการ</h2><span className="small muted">{order.id}</span></div>
          <div className="table-wrap"><table><thead><tr><th>ประเภท</th><th>เลข</th><th>ยอดซื้อ</th><th>อัตราจ่ายที่รับ</th></tr></thead><tbody>
            {lines.map((line) => <tr key={`${line.betTypeCode}-${line.canonicalNumber}`}><td>{line.betTypeCode}</td><td><strong>{line.canonicalNumber}</strong></td><td>{formatBaht(line.stakeMinor)}</td><td className="payout">{describeResolvedPayout(line.resolvedPayout)}</td></tr>)}
          </tbody></table></div>
          <div className="summary-box" style={{ marginTop: 14 }}>
            <div className="summary-row"><span>ยอดซื้อรวม</span><strong>{formatBaht(order.totalStakeMinor)}</strong></div>
            <div className="summary-row"><span>ยืนยันเมื่อ</span><strong>{order.confirmedAt ? formatDateTime(order.confirmedAt) : "—"}</strong></div>
            <div className="summary-row"><span>ปิดรับงวด</span><strong>{formatDateTime(order.cutoffAt)}</strong></div>
            <div className="summary-row"><span>สินค้า / เวอร์ชัน</span><strong className="small">{order.productId} · {order.productVersionId.slice(0, 8)}…</strong></div>
          </div>
        </section>
        <section className="panel" id="correction">
          <div className="panel-title"><div><h2>ประวัติผลและการแก้ไข</h2><p className="small muted">แสดงตามลำดับเหตุการณ์จริง · ประวัติเดิมไม่ถูกลบ</p></div><div className="section-tabs correction-tabs"><button className={`tab ${filter === "all" ? "active" : ""}`} type="button" onClick={() => setFilter("all")} aria-pressed={filter === "all"}>ทั้งหมด</button><button className={`tab ${filter === "current" ? "active" : ""}`} type="button" onClick={() => setFilter("current")} aria-pressed={filter === "current"}>ผลปัจจุบัน</button></div></div>
          <div className="correction-timeline">{shown.map((event) => <article className={`correction-event ${event.current ? "current" : ""}`} key={event.id}><div className={`correction-marker ${event.tone}`}>{event.id}</div><div className="correction-card"><div className="correction-meta"><span>{event.meta}</span><span className={`status ${event.tone}`}>{event.badge}</span></div><h3>{event.title}</h3><p>{event.body}</p></div></article>)}</div>
          <div className="notice info correction-note"><b>i</b><div><strong>ข้อมูลเดิมยังคงตรวจสอบย้อนหลังได้</strong>ระบบไม่แก้ข้อความหรือยอดของ Receipt/Settlement เดิมเพื่อทำให้ดูเหมือนไม่เคยเกิด correction</div></div>
        </section>
      </div>
      <aside className="stack">
        <section className="summary-box">
          <div className="summary-row"><span>สถานะปัจจุบัน</span><strong>{status.label}</strong></div>
          <div className="summary-row"><span>ยอดซื้อ</span><strong>{formatBaht(order.totalStakeMinor)}</strong></div>
          <div className="summary-row total"><span>เงินรางวัลปัจจุบัน</span><strong>{settlement ? formatBaht(settlement.payoutMinor) : "ยังไม่มีผล"}</strong></div>
          <div className="summary-row"><span>ผลตัดสินผล</span><strong>{settlement ? (settlement.authoritative ? "ยืนยันแล้ว" : "ยังไม่ถือเป็นผลสุดท้าย") : "ยังไม่มีรอบตัดสินผล"}</strong></div>
        </section>
        {order.allowedActions.includes("CANCEL") && <Link className="button secondary block" href={`/buy/receipt?orderId=${encodeURIComponent(order.id)}`}>ยกเลิกหรือจัดการรายการนี้ →</Link>}
        <Link className="button secondary block" href="/slips">← กลับรายการโพย</Link>
      </aside>
    </section>
  </main>;
}
