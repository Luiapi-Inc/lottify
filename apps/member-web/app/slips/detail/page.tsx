"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createIdempotencyKey, memberApi, type BetOrder, type BetReceipt, type MemberSettlementOutcome } from "../../lib/member-api";
import { ErrorState, LoadingState, Money, PageHeading, Section, StatusBadge } from "../../components/presentation";

export default function SlipDetailPage() {
  const [id, setId] = useState("");
  const [order, setOrder] = useState<BetOrder | null>(null);
  const [receipt, setReceipt] = useState<BetReceipt | null>(null);
  const [settlement, setSettlement] = useState<MemberSettlementOutcome | null>(null);
  const [secondaryErrors, setSecondaryErrors] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const cancelKey = useRef(createIdempotencyKey());

  const load = useCallback(async (orderId: string) => {
    setLoading(true);
    setError(null);
    const [orderResult, receiptResult, settlementResult] = await Promise.allSettled([
      memberApi.getOrder(orderId),
      memberApi.getReceipt(orderId),
      memberApi.getSettlement(orderId),
    ]);
    if (orderResult.status === "rejected") {
      setError(orderResult.reason);
      setLoading(false);
      return;
    }
    setOrder(orderResult.value);
    const errors: string[] = [];
    if (receiptResult.status === "fulfilled") setReceipt(receiptResult.value); else { setReceipt(null); errors.push("Receipt ยังไม่พร้อม"); }
    if (settlementResult.status === "fulfilled") setSettlement(settlementResult.value); else { setSettlement(null); errors.push("Settlement ยังไม่พร้อม"); }
    setSecondaryErrors(errors);
    setLoading(false);
  }, []);

  useEffect(() => {
    const orderId = new URLSearchParams(window.location.search).get("id") ?? "";
    setId(orderId);
    if (orderId) void load(orderId);
    else {
      setLoading(false);
      setError(new Error("ไม่พบ id ของ Bet Order"));
    }
  }, [load]);

  async function cancel() {
    if (!order || !order.allowedActions.includes("CANCEL")) return;
    setCancelling(true);
    setError(null);
    try {
      setOrder(await memberApi.cancelOrder(order.id, { version: order.version, reason: "MEMBER_REQUEST" }, cancelKey.current));
    } catch (cause) {
      setError(cause);
    } finally {
      setCancelling(false);
    }
  }

  return <main id="main">
    <PageHeading eyebrow="ORDER DETAIL" title="รายละเอียดโพยและผลล่าสุด" description="Order, immutable Receipt และ Settlement ถูกอ่านแยกกันเพื่อไม่ให้สถานะปัจจุบันเขียนทับ historical accepted terms" action={<Link className="button secondary" href="/slips">← โพยทั้งหมด</Link>} />
    {loading ? <LoadingState label="กำลังโหลด Order / Receipt / Settlement…" /> : null}
    {error ? <div style={{ marginBottom: 16 }}><ErrorState error={error} retry={id ? () => void load(id) : undefined} /></div> : null}

    {order ? <section className="grid-2">
      <div className="stack">
        <Section title="Bet Order" subtitle={order.id} action={<StatusBadge tone={order.state === "SETTLED" || order.state === "CONFIRMED" ? "success" : order.state === "REJECTED" ? "danger" : "info"}>{order.state}</StatusBadge>}>
          <div className="receipt-grid">
            <div className="receipt-item"><span>Total stake</span><strong><Money minor={order.totalStakeMinor} /></strong></div>
            <div className="receipt-item"><span>Version</span><strong>{order.version}</strong></div>
            <div className="receipt-item"><span>Created</span><strong>{new Date(order.createdAt).toLocaleString("th-TH")}</strong></div>
            <div className="receipt-item"><span>Confirmed</span><strong>{order.confirmedAt ? new Date(order.confirmedAt).toLocaleString("th-TH") : "—"}</strong></div>
          </div>
          <div className="table-wrap" style={{ marginTop: 14 }}><table><thead><tr><th>Bet Type</th><th>เลข</th><th>Stake</th><th>Restrictions</th></tr></thead><tbody>{order.lines.map((line,index) => <tr key={index}><td>{line.betTypeCode}</td><td><strong>{line.canonicalNumber}</strong></td><td><Money minor={line.stakeMinor} /></td><td>{line.restrictions.join(", ") || "—"}</td></tr>)}</tbody></table></div>
        </Section>

        {receipt ? <Section title="Immutable Receipt" subtitle={receipt.id}>
          <div className="data-list"><div className="data-row"><div className="data-main"><strong>Accepted at</strong><span>{new Date(receipt.terms.acceptedAt).toLocaleString("th-TH")}</span></div><div className="data-meta"><strong><Money minor={receipt.terms.totalStakeMinor} /></strong></div></div><div className="data-row"><div className="data-main"><strong>Content digest</strong><span>{receipt.contentDigest}</span></div><StatusBadge tone="neutral">v{receipt.orderVersion}</StatusBadge></div></div>
        </Section> : null}
      </div>

      <aside className="stack">
        <Section title="Settlement / correction outcome" subtitle="authoritative only when backend says so">
          {settlement ? <div className="data-list">
            <div className="data-row"><div className="data-main"><strong>{settlement.outcome ?? "ยังไม่มีผล"}</strong><span>Batch {settlement.batchState ?? "—"}</span></div><StatusBadge tone={settlement.authoritative ? "success" : "warning"}>{settlement.authoritative ? "AUTHORITATIVE" : "PENDING"}</StatusBadge></div>
            <div className="data-row"><div className="data-main"><strong>ยอด payout</strong><span>ค่าปัจจุบันจาก settlement API</span></div><div className="data-meta"><strong><Money minor={settlement.payoutMinor} /></strong></div></div>
          </div> : <div className="state-card"><span className="state-symbol">…</span><div><strong>ยังไม่มี Settlement ที่อ่านได้</strong><p>จะไม่อนุมานผลจาก Order state</p></div></div>}
        </Section>

        {secondaryErrors.length ? <div className="notice info"><b>i</b><div><strong>ข้อมูลบางส่วนยังไม่พร้อม</strong>{secondaryErrors.join(" · ")}</div></div> : null}

        <Section title="Actions" subtitle={order.allowedActions.length ? order.allowedActions.join(", ") : "ไม่มี action"}>
          {order.allowedActions.includes("CANCEL") ? <button className="button danger block" disabled={cancelling} type="button" onClick={() => void cancel()}>{cancelling ? "กำลังยกเลิก…" : "ขอยกเลิกโพย"}</button> : <div className="state-card"><span className="state-symbol">✓</span><div><strong>ไม่มีคำสั่งที่ทำได้ในตอนนี้</strong><p>UI ใช้ allowedActions จาก server ไม่ derive จาก state เอง</p></div></div>}
          {order.state === "CANCELLING" ? <div className="notice warning" style={{ marginTop: 12 }}><b>!</b><div><strong>กำลังยกเลิก</strong>ยังไม่แสดงว่าเงินคืนจนกว่า API จะคืน authoritative state</div></div> : null}
        </Section>

        <button className="button secondary block" type="button" onClick={() => id && void load(id)}>รีเฟรชข้อมูล authoritative</button>
      </aside>
    </section> : null}
  </main>;
}
