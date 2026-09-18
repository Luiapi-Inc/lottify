"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  MemberApiFailure,
  createIdempotencyKey,
  memberApi,
  type BetOrder,
  type BetReceipt,
} from "../../lib/member-api";
import {
  describeFailureCode,
  describeMemberApiFailure,
  describeOrderState,
  describeResolvedPayout,
  formatBaht,
  formatDateTime,
  sumMinor,
} from "../../lib/member-display";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; order: BetOrder; receipt: BetReceipt | null }
  | { status: "failed"; message: string; code: string; correlationId?: string };

type CancelState =
  | { status: "idle" }
  | { status: "review" }
  | { status: "working" }
  | { status: "failed"; code: string; message: string; correlationId?: string };

export default function ReceiptPage() {
  const [orderId, setOrderId] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [cancel, setCancel] = useState<CancelState>({ status: "idle" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOrderId(params.get("orderId"));
  }, []);

  const load = useCallback(async (id: string) => {
    const order = await memberApi.getOrder(id);
    // The Receipt only exists once the Order is confirmed; a 404 here is a
    // legitimate state, not a page failure.
    const receipt = order.receiptId ? await memberApi.getReceipt(order.id) : null;
    return { order, receipt };
  }, []);

  useEffect(() => {
    if (orderId === null) return;
    if (!orderId) {
      setState({ status: "failed", message: "ไม่พบรายการที่จะแสดง กรุณาเปิดจากหน้าโพยของฉัน", code: "ORDER_NOT_SELECTED" });
      return;
    }
    let active = true;
    load(orderId)
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
  }, [orderId, load]);

  const submitCancel = async () => {
    if (state.status !== "ready") return;
    const { order } = state;
    setCancel({ status: "working" });
    try {
      const updated = await memberApi.cancelOrder(order.id, order.version, undefined, createIdempotencyKey());
      const receipt = updated.receiptId ? await memberApi.getReceipt(updated.id).catch(() => state.receipt) : null;
      setState({ status: "ready", order: updated, receipt });
      setCancel({ status: "idle" });
    } catch (error) {
      const failure = describeMemberApiFailure(error);
      setCancel({ status: "failed", code: failure.code, message: failure.message, correlationId: failure.correlationId });
    }
  };

  if (state.status === "loading" || orderId === null) {
    return <main id="main"><section className="receipt panel"><div className="panel-title"><h2>กำลังโหลดรายการ</h2></div><p className="muted small">กำลังดึงใบรับรายการและสถานะล่าสุดจาก API…</p></section></main>;
  }

  if (state.status === "failed") {
    return <main id="main"><section className="receipt panel"><div className="panel-title"><h2>เปิดรายการนี้ไม่ได้</h2><span className="status danger">{state.code}</span></div><p className="muted small">{state.message}</p>{state.correlationId && <p className="muted small">รหัสอ้างอิง: {state.correlationId}</p>}<div className="receipt-actions"><Link className="button secondary" href="/slips">ไปโพยของฉัน</Link><Link className="button secondary" href="/buy">ซื้อรายการใหม่</Link></div></section></main>;
  }

  const { order, receipt } = state;
  const orderStatus = describeOrderState(order.state);
  const confirmed = order.state === "CONFIRMED" || order.state === "SETTLED";
  const cancelled = order.state === "CANCELLED";
  const canCancel = order.allowedActions.includes("CANCEL");
  const lines = receipt ? receipt.terms.lines : order.lines;
  const totalStakeMinor = receipt ? BigInt(receipt.terms.totalStakeMinor) : BigInt(order.totalStakeMinor);

  return <main id="main">
    <section className="receipt panel">
      <div className="receipt-hero">
        <div className={confirmed ? "success-check" : "success-check"}>{confirmed ? "✓" : "i"}</div>
        <h1 style={{ margin: "0 0 7px" }}>{confirmed ? "ยืนยันรายการสำเร็จ" : `สถานะรายการ: ${orderStatus.label}`}</h1>
        <p className="muted">{confirmed ? "ระบบยืนยันรายการแล้ว เก็บเลขอ้างอิงนี้ไว้สำหรับตรวจสอบภายหลัง" : "รายการนี้ยังไม่ถือว่าซื้อสำเร็จ สถานะด้านล่างคือค่าจริงจากเซิร์ฟเวอร์"}</p>
        <p className="receipt-ref">Order #{order.id} · สถานะ {order.state} · ปรับปรุงล่าสุด {formatDateTime(order.updatedAt)}</p>
      </div>
      <div className="receipt-grid">
        <div className="receipt-item"><span>สินค้า</span><strong>{order.productId}</strong></div>
        <div className="receipt-item"><span>งวด (Draw)</span><strong>{order.drawId}</strong></div>
        <div className="receipt-item"><span>Quote</span><strong>{order.quoteId}</strong></div>
        <div className="receipt-item"><span>สถานะ</span><span className={`status ${orderStatus.tone}`}>{orderStatus.label}</span></div>
        <div className="receipt-item"><span>ยอดซื้อรวม</span><strong>{formatBaht(totalStakeMinor)}</strong></div>
        <div className="receipt-item"><span>ปิดรับ</span><strong>{formatDateTime(order.cutoffAt)}</strong></div>
        <div className="receipt-item"><span>ยืนยันเมื่อ</span><strong>{order.confirmedAt ? formatDateTime(order.confirmedAt) : "—"}</strong></div>
        <div className="receipt-item"><span>เลขที่ใบรับ</span><strong>{order.receiptId ?? "—"}</strong></div>
      </div>
      <div className="table-wrap" style={{ marginTop: 18 }}><table><thead><tr><th>ประเภท</th><th>เลข</th><th>ยอดซื้อ</th><th>อัตราจ่ายที่รับ</th></tr></thead><tbody>
        {lines.map((line) => <tr key={`${line.betTypeCode}-${line.canonicalNumber}`}><td>{line.betTypeCode}</td><td><strong>{line.canonicalNumber}</strong></td><td>{formatBaht(line.stakeMinor)}</td><td className="payout">{describeResolvedPayout(line.resolvedPayout)}</td></tr>)}
      </tbody></table></div>
      {order.rejectionReason && <div className="notice warning" style={{ marginTop: 18 }}><b>!</b><div><strong>รายการนี้ถูกปฏิเสธ: {order.rejectionReason}</strong>{describeFailureCode(order.rejectionReason)}</div></div>}
      {order.cancellationReason && <div className="notice info" style={{ marginTop: 18 }}><b>i</b><div><strong>เหตุผลการยกเลิก: {order.cancellationReason}</strong>ยอดคืนถูกบันทึกเมื่อการยกเลิกสำเร็จ</div></div>}
      {receipt && <div className="notice info" style={{ marginTop: 18 }}><b>i</b><div><strong>ใบรับรายการนี้เก็บเงื่อนไขที่ยอมรับไว้</strong>รหัสตรวจสอบเนื้อหา (SHA-256): <span className="small">{receipt.contentDigest}</span> · ออกเมื่อ {formatDateTime(receipt.issuedAt)}</div></div>}

      {cancel.status === "failed" && <div className="notice warning" style={{ marginTop: 18 }} aria-live="polite"><b>!</b><div><strong>ยกเลิกไม่สำเร็จ ({cancel.code})</strong>{cancel.message}{cancel.correlationId ? ` · รหัสอ้างอิง ${cancel.correlationId}` : ""}</div></div>}

      <div className="receipt-actions">
        {canCancel && <button className="button danger" type="button" onClick={() => setCancel({ status: "review" })}>ยกเลิกโพย</button>}
        <Link className="button secondary" href="/buy">ซื้อรายการใหม่</Link>
        <Link className="button primary" href="/slips">ไปโพยของฉัน</Link>
        {order.receiptId && <Link className="button secondary" href={`/slips/detail?orderId=${encodeURIComponent(order.id)}`}>ดูรายละเอียดและผล →</Link>}
      </div>
      {cancelled && <div className="cancel-history"><div className="panel-title"><h2>ประวัติการยกเลิก</h2></div><div className="stack"><div className="notice info"><b>1</b><div><strong>ยืนยันรายการ · {order.confirmedAt ? formatDateTime(order.confirmedAt) : "—"}</strong>รับโพย {order.id} ยอดซื้อ {formatBaht(order.totalStakeMinor)}</div></div><div className="notice warning"><b>2</b><div><strong>ขอยกเลิกโพย</strong>ระบบตรวจ cutoff และนโยบายการยกเลิกของงวดอีกครั้งก่อนคืนเงิน</div></div><div className="notice success"><b>3</b><div><strong>คืนเงินสำเร็จ · ยกเลิกแล้ว · {order.cancelledAt ? formatDateTime(order.cancelledAt) : ""}</strong>ยอดคืน {formatBaht(order.totalStakeMinor)} ถูกบันทึกแล้ว (รหัสธุรกรรมคืนเงิน {order.refundTransactionId ?? "—"})</div></div></div></div>}
    </section>

    {cancel.status !== "idle" && <div className="cancel-overlay">
      <section className="cancel-sheet" role="dialog" aria-modal="true" aria-labelledby="cancel-title">
        {cancel.status === "review" && <><button className="cancel-sheet-close" type="button" aria-label="ปิด" onClick={() => setCancel({ status: "idle" })}>×</button><span className="status warning">ก่อน cutoff</span><h2 id="cancel-title">ยกเลิกโพยนี้?</h2><p className="muted">ระบบจะตรวจนโยบายของหวย/งวดและเวลาปิดรับอีกครั้งก่อนรับคำขอ</p><div className="cancel-summary"><div><span>เลขอ้างอิง</span><strong>{order.id}</strong></div><div><span>ยอดซื้อ</span><strong>{formatBaht(order.totalStakeMinor)}</strong></div><div><span>ปิดรับ</span><strong>{formatDateTime(order.cutoffAt)}</strong></div><div><span>ยอดคืนเมื่อสำเร็จ</span><strong>{formatBaht(order.totalStakeMinor)}</strong></div></div><div className="notice warning"><b>!</b><div><strong>การยกเลิกจะสมบูรณ์เมื่อคืนเงินสำเร็จ</strong>ระหว่างดำเนินการโพยจะแสดงสถานะ “กำลังยกเลิก” และยังไม่ถือว่ายกเลิกเสร็จ</div></div><div className="cancel-sheet-actions"><button className="button secondary" type="button" onClick={() => setCancel({ status: "idle" })}>ยังไม่ยกเลิก</button><button className="button danger" type="button" onClick={submitCancel}>ยืนยันยกเลิกโพย</button></div></>}
        {cancel.status === "working" && <div className="cancel-flow-state"><div className="cancel-state-icon pending">…</div><h2>กำลังยกเลิกโพย</h2><p>ส่งคำขอไปยังเซิร์ฟเวอร์แล้ว กำลังรอผลการคืนเงิน {formatBaht(order.totalStakeMinor)}</p><div className="notice info"><b>i</b><div><strong>ยังไม่ถือว่ายกเลิกเสร็จ</strong>สถานะจะเปลี่ยนเป็น “ยกเลิกแล้ว” เมื่อยอดคืนถูกบันทึกสำเร็จ</div></div></div>}
      </section>
    </div>}
  </main>;
}
