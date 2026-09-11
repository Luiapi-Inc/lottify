"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MemberApiFailure,
  createIdempotencyKey,
  memberApi,
  type BetOrder,
  type BetReceipt,
} from "../../lib/member-api";
import {
  formatDateTime,
  formatMinor,
  formatPayout,
  productLabel,
  shortId,
} from "../live-data";

const ORDER_LABELS: Record<string, string> = {
  DRAFT: "ฉบับร่าง",
  QUOTED: "รอยืนยัน",
  CONFIRMING: "กำลังยืนยัน",
  CONFIRMED: "ยืนยันแล้ว",
  CANCELLING: "กำลังยกเลิก",
  CANCELLED: "ยกเลิกแล้ว",
  EXPIRED: "หมดอายุ",
  REJECTED: "ไม่ผ่านการยืนยัน",
  SETTLED: "ประมวลผลรางวัลแล้ว",
};

export default function ReceiptView({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [order, setOrder] = useState<BetOrder | null>(null);
  const [receipt, setReceipt] = useState<BetReceipt | null>(null);
  const [loading, setLoading] = useState(Boolean(orderId));
  const [busy, setBusy] = useState(false);
  const [reviewCancel, setReviewCancel] = useState(false);
  const [error, setError] = useState("");
  const cancelCommand = useRef<{ orderId: string; version: number; key: string } | null>(null);

  const handleFailure = useCallback((caught: unknown) => {
    if (caught instanceof MemberApiFailure && caught.code === "SESSION_REQUIRED") {
      router.replace("/login");
      return;
    }
    setError(caught instanceof Error ? caught.message : "โหลดรายการไม่สำเร็จ");
  }, [router]);

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    setError("");
    try {
      const current = await memberApi.getOrder(orderId);
      if (current.id !== orderId) throw new Error("เลขอ้างอิงรายการไม่ตรงกัน");
      setOrder(current);
      if (current.receiptId) {
        const issued = await memberApi.getReceipt(orderId);
        if (issued.orderId !== orderId) throw new Error("ใบรับรายการไม่ตรงกับโพย");
        setReceipt(issued);
      } else {
        setReceipt(null);
      }
      if (
        cancelCommand.current &&
        (cancelCommand.current.orderId !== current.id || cancelCommand.current.version !== current.version)
      ) {
        cancelCommand.current = null;
      }
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setLoading(false);
    }
  }, [handleFailure, orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancelOrder() {
    if (!order || !order.allowedActions.includes("CANCEL") || busy) return;
    if (
      !cancelCommand.current ||
      cancelCommand.current.orderId !== order.id ||
      cancelCommand.current.version !== order.version
    ) {
      cancelCommand.current = {
        orderId: order.id,
        version: order.version,
        key: createIdempotencyKey(),
      };
    }

    setBusy(true);
    setError("");
    try {
      const result = await memberApi.cancelOrder(
        order.id,
        cancelCommand.current.version,
        cancelCommand.current.key,
      );
      setOrder(result);
      setReviewCancel(false);
      cancelCommand.current = null;
    } catch (caught) {
      handleFailure(caught);
    } finally {
      setBusy(false);
    }
  }

  if (!orderId) {
    return <main id="main"><section className="panel"><h1>ไม่พบเลขอ้างอิงรายการ</h1><p>เลือกโพยที่ต้องการดูใบรับรายการก่อน</p><Link className="button primary" href="/slips">ไปโพยของฉัน</Link></section></main>;
  }

  if (loading) {
    return <main id="main"><section className="panel"><p role="status">กำลังตรวจสอบรายการ…</p></section></main>;
  }

  if (!order) {
    return <main id="main"><section className="panel"><h1>เปิดรายการไม่ได้</h1>{error && <p role="alert">{error}</p>}<Link className="button primary" href="/slips">ไปโพยของฉัน</Link></section></main>;
  }

  const statusLabel = ORDER_LABELS[order.state] ?? order.state;
  const confirmed = ["CONFIRMED", "CANCELLING", "CANCELLED", "SETTLED"].includes(order.state);

  return <main id="main">
    <section className="receipt panel">
      <div className="receipt-hero">
        {confirmed && <div className="success-check">✓</div>}
        <h1 style={{ margin: "0 0 7px" }}>{receipt ? "ใบรับรายการ" : "สถานะรายการ"}</h1>
        <p className="muted">ข้อมูลนี้อ่านจาก Order และ Receipt ของบัญชีปัจจุบัน</p>
        <p className="receipt-ref" style={{ overflowWrap: "anywhere" }}>Order {order.id}</p>
        <span className={`status ${order.state === "CANCELLED" ? "neutral" : "info"}`}>{statusLabel}</span>
      </div>

      {error && <div className="notice warning" role="alert"><b>!</b><div><strong>ดำเนินการไม่ได้</strong>{error}</div></div>}

      {receipt ? <>
        <div className="receipt-grid">
          <div className="receipt-item"><span>Product</span><strong>{productLabel(receipt.terms.productId)}</strong></div>
          <div className="receipt-item"><span>งวด</span><strong>{receipt.terms.drawReference ?? shortId(order.drawId)}</strong></div>
          <div className="receipt-item"><span>ออกใบรับเมื่อ</span><strong>{formatDateTime(receipt.issuedAt)}</strong></div>
          <div className="receipt-item"><span>ยอดซื้อรวม</span><strong>{formatMinor(receipt.terms.totalStakeMinor)} บาท</strong></div>
          {receipt.terms.drawCutoffAt && <div className="receipt-item"><span>ปิดรับ</span><strong>{formatDateTime(receipt.terms.drawCutoffAt)}</strong></div>}
          <div className="receipt-item"><span>Receipt</span><strong style={{ overflowWrap: "anywhere" }}>{receipt.id}</strong></div>
        </div>
        <div className="table-wrap" style={{ marginTop: 18 }}><table className="quote-lines"><thead><tr><th>ประเภท</th><th>เลข</th><th>ยอดซื้อ</th><th>อัตราจ่ายที่ยอมรับ</th></tr></thead><tbody>{receipt.terms.lines.map((line, index) => <tr key={`${line.betTypeCode}:${line.canonicalNumber}:${index}`}><td>{line.betTypeCode}</td><td><strong>{line.canonicalNumber}</strong></td><td>{formatMinor(line.stakeMinor)} บาท</td><td className="payout">{formatPayout(line.resolvedPayout)}</td></tr>)}</tbody></table></div>
        <div className="notice info" style={{ marginTop: 18 }}><b>i</b><div><strong>ใบรับรายการนี้เก็บเงื่อนไขที่ยอมรับไว้</strong>ประวัติ Order จะเปลี่ยนตามสถานะ แต่ Receipt เดิมไม่ถูกเขียนทับ</div></div>
      </> : <div className="notice info"><b>i</b><div><strong>รายการนี้ยังไม่มี Receipt</strong>Receipt จะมีเมื่อการยืนยัน Order สำเร็จตาม workflow</div></div>}

      {order.state === "CANCELLING" && <div className="notice warning"><b>!</b><div><strong>กำลังยกเลิกโพย</strong>ยังไม่ถือว่ายกเลิกเสร็จจนกว่า refund จะถูกบันทึกและ Order เป็น CANCELLED</div></div>}
      {order.state === "CANCELLED" && <div className="notice success"><b>✓</b><div><strong>ยกเลิกแล้ว</strong>{order.refundTransactionId ? <>เลขอ้างอิงคืนเงิน <span style={{ overflowWrap: "anywhere" }}>{order.refundTransactionId}</span></> : "ระบบบันทึกสถานะยกเลิกแล้ว"}</div></div>}

      {reviewCancel && order.allowedActions.includes("CANCEL") && <div className="cancel-overlay"><section className="cancel-sheet" role="dialog" aria-modal="true" aria-labelledby="cancel-title"><button className="cancel-sheet-close" type="button" aria-label="ปิด" disabled={busy} onClick={() => setReviewCancel(false)}>×</button><span className="status warning">ตรวจสิทธิ์อีกครั้งบน server</span><h2 id="cancel-title">ยกเลิกโพยนี้?</h2><p className="muted">ระบบจะตรวจ cutoff และนโยบายการยกเลิกอีกครั้งก่อนรับคำสั่ง</p><div className="cancel-summary"><div><span>เลขอ้างอิง</span><strong style={{ overflowWrap: "anywhere" }}>{order.id}</strong></div><div><span>ยอดซื้อ</span><strong>{formatMinor(order.totalStakeMinor)} บาท</strong></div><div><span>สถานะปัจจุบัน</span><strong>{statusLabel}</strong></div></div><div className="notice warning"><b>!</b><div><strong>การยกเลิกสำเร็จเมื่อ Order เป็น CANCELLED</strong>หากอยู่ระหว่าง CANCELLING ให้ตรวจสถานะล่าสุดแทนการสร้างคำสั่งใหม่</div></div><div className="cancel-sheet-actions"><button className="button secondary" type="button" disabled={busy} onClick={() => setReviewCancel(false)}>ยังไม่ยกเลิก</button><button className="button danger" type="button" disabled={busy} onClick={() => void cancelOrder()}>{busy ? "กำลังส่งคำขอ…" : "ยืนยันยกเลิกโพย"}</button></div></section></div>}

      <div className="receipt-actions">
        {order.allowedActions.includes("CANCEL") && !reviewCancel && <button className="button danger" type="button" disabled={busy} onClick={() => setReviewCancel(true)}>ยกเลิกโพย</button>}
        <button className="button secondary" type="button" disabled={busy} onClick={() => void load()}>{busy ? "กำลังตรวจ…" : "ตรวจสถานะล่าสุด"}</button>
        <Link className="button secondary" href="/buy">ซื้อรายการใหม่</Link>
        <Link className="button primary" href="/slips">ไปโพยของฉัน</Link>
        <Link className="button secondary" href="/">กลับหน้าแรก</Link>
      </div>
    </section>
  </main>;
}
