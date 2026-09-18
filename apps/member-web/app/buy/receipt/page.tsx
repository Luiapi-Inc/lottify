"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createIdempotencyKey,
  memberApi,
  type BetOrder,
  type BetReceipt,
  type MemberSettlementOutcome,
} from "../../lib/member-api";
import { ErrorState, LoadingState, Money, PageHeading, Section, StatusBadge } from "../../components/presentation";

export default function ReceiptPage() {
  const [orderId, setOrderId] = useState("");
  const [order, setOrder] = useState<BetOrder | null>(null);
  const [receipt, setReceipt] = useState<BetReceipt | null>(null);
  const [settlement, setSettlement] = useState<MemberSettlementOutcome | null>(null);
  const [settlementError, setSettlementError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const cancelKey = useRef(createIdempotencyKey());

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    const [orderResult, receiptResult, settlementResult] = await Promise.allSettled([
      memberApi.getOrder(id),
      memberApi.getReceipt(id),
      memberApi.getSettlement(id),
    ]);
    if (orderResult.status === "rejected") {
      setError(orderResult.reason);
      setLoading(false);
      return;
    }
    setOrder(orderResult.value);
    if (receiptResult.status === "fulfilled") setReceipt(receiptResult.value);
    else setError(receiptResult.reason);
    if (settlementResult.status === "fulfilled") {
      setSettlement(settlementResult.value);
      setSettlementError(null);
    } else {
      setSettlement(null);
      setSettlementError(settlementResult.reason);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("orderId") ?? "";
    setOrderId(id);
    if (id) void load(id);
    else {
      setLoading(false);
      setError(new Error("ไม่พบ orderId กรุณาเปิดใบรับรายการจากโพยของฉัน"));
    }
  }, [load]);

  async function cancel() {
    if (!order || !order.allowedActions.includes("CANCEL")) return;
    setCancelling(true);
    setError(null);
    try {
      const updated = await memberApi.cancelOrder(order.id, { version: order.version, reason: "MEMBER_REQUEST" }, cancelKey.current);
      setOrder(updated);
    } catch (cause) {
      setError(cause);
    } finally {
      setCancelling(false);
    }
  }

  return <main id="main">
    <PageHeading
      eyebrow="BETTING · RECEIPT"
      title="ใบรับรายการจากข้อมูลที่ยืนยันแล้ว"
      description="Receipt แสดง accepted terms ที่ backend บันทึกไว้ ไม่ reconstruct จาก Quote ใน browser และ Settlement ถูกอ่านแยกจาก authoritative endpoint"
      action={<button className="button secondary" type="button" disabled={!orderId} onClick={() => orderId && void load(orderId)}>รีเฟรชสถานะ</button>}
    />

    {loading ? <LoadingState label="กำลังโหลด Order, Receipt และ Settlement…" /> : null}
    {error ? <div style={{ marginBottom: 16 }}><ErrorState error={error} retry={orderId ? () => void load(orderId) : undefined} /></div> : null}

    {order && receipt ? <section className="grid-2">
      <div className="stack">
        <section className="receipt">
          <div className="receipt-hero">
            <div className="success-check">✓</div>
            <h1 style={{ marginBottom: 7 }}>ระบบรับรายการแล้ว</h1>
            <p className="muted">Order และ Receipt ด้านล่างคือข้อมูล authoritative ที่โหลดใหม่จาก API</p>
            <p className="receipt-ref">{receipt.id} · Order {order.id}</p>
          </div>
          <div className="receipt-grid">
            <div className="receipt-item"><span>สถานะ Order</span><StatusBadge tone={order.state === "CONFIRMED" || order.state === "SETTLED" ? "success" : order.state === "CANCELLED" ? "neutral" : "info"}>{order.state}</StatusBadge></div>
            <div className="receipt-item"><span>ยอดซื้อที่ยอมรับ</span><strong><Money minor={receipt.terms.totalStakeMinor} /></strong></div>
            <div className="receipt-item"><span>Product</span><strong>{receipt.terms.productId}</strong></div>
            <div className="receipt-item"><span>Product version</span><strong>{receipt.terms.productVersionId}</strong></div>
            <div className="receipt-item"><span>Draw</span><strong>{receipt.terms.drawReference ?? order.drawId}</strong></div>
            <div className="receipt-item"><span>Cutoff</span><strong>{receipt.terms.drawCutoffAt ? new Date(receipt.terms.drawCutoffAt).toLocaleString("th-TH") : "—"}</strong></div>
            <div className="receipt-item"><span>Accepted at</span><strong>{new Date(receipt.terms.acceptedAt).toLocaleString("th-TH")}</strong></div>
            <div className="receipt-item"><span>Digest</span><strong style={{ overflowWrap: "anywhere" }}>{receipt.contentDigest}</strong></div>
          </div>
        </section>

        <Section title="Accepted Bet Lines" subtitle="เก็บ payout snapshot ตาม Receipt">
          <div className="table-wrap"><table><thead><tr><th>Bet Type</th><th>เลข</th><th>Stake</th><th>Accepted payout</th></tr></thead><tbody>
            {receipt.terms.lines.map((line, index) => <tr key={index}><td>{line.betTypeCode}</td><td><strong>{line.canonicalNumber}</strong></td><td><Money minor={line.stakeMinor} /></td><td>{Object.keys(line.resolvedPayout).length ? JSON.stringify(line.resolvedPayout) : "server snapshot"}</td></tr>)}
          </tbody></table></div>
        </Section>
      </div>

      <aside className="stack">
        <Section title="Settlement" subtitle="GET /orders/{id}/settlement">
          {settlement ? <div className="data-list">
            <div className="data-row"><div className="data-main"><strong>ผลล่าสุด</strong><span>Batch {settlement.batchState ?? "ยังไม่มี batch"}</span></div><StatusBadge tone={settlement.authoritative ? "success" : "warning"}>{settlement.authoritative ? "AUTHORITATIVE" : "PENDING"}</StatusBadge></div>
            <div className="data-row"><div className="data-main"><strong>{settlement.outcome ?? "ยังไม่มีผล"}</strong><span>เงินรางวัลที่ server รายงาน</span></div><div className="data-meta"><strong><Money minor={settlement.payoutMinor} /></strong></div></div>
          </div> : settlementError ? <div className="state-card"><span className="state-symbol">…</span><div><strong>Settlement ยังไม่พร้อม</strong><p>ผลจะไม่ถูกเดาหรือสร้างจาก client กดรีเฟรชเมื่อต้องการตรวจใหม่</p></div></div> : null}
        </Section>

        <Section title="Order actions" subtitle={`version ${order.version}`}>
          <div className="data-row"><div className="data-main"><strong>Allowed actions</strong><span>{order.allowedActions.join(", ") || "ไม่มี action ที่อนุญาต"}</span></div><StatusBadge tone="info">{order.state}</StatusBadge></div>
          {order.allowedActions.includes("CANCEL") ? <button className="button danger block" type="button" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? "กำลังส่งคำขอยกเลิก…" : "ขอยกเลิกโพย"}</button> : null}
          {order.state === "CANCELLING" ? <div className="notice warning" style={{ marginTop: 12 }}><b>!</b><div><strong>ยังไม่ถือว่ายกเลิกเสร็จ</strong>UI จะรอ authoritative refund/order state ก่อนแสดง CANCELLED</div></div> : null}
        </Section>

        <div className="action-grid">
          <Link className="action-card" href="/slips"><b>≡</b><div><strong>โพยของฉัน</strong><span>ดูประวัติทั้งหมด</span></div></Link>
          <Link className="action-card" href="/buy"><b>+</b><div><strong>ซื้ออีก</strong><span>เลือก Draw ใหม่</span></div></Link>
        </div>
      </aside>
    </section> : null}
  </main>;
}
