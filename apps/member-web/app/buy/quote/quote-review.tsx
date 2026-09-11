"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MemberApiFailure,
  createIdempotencyKey,
  memberApi,
  type BetOrder,
  type BettingQuote,
} from "../../lib/member-api";
import {
  formatMinor,
  formatPayout,
  formatRemaining,
  payoutReturnMinor,
  productLabel,
  shortId,
} from "../live-data";

export default function QuoteReview({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [quote, setQuote] = useState<BettingQuote | null>(null);
  const [order, setOrder] = useState<BetOrder | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(Boolean(quoteId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const orderCommand = useRef<{ quoteId: string; key: string } | null>(null);
  const confirmCommand = useRef<{ orderId: string; version: number; key: string } | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!quoteId) return;
    let active = true;
    setLoading(true);
    setError("");
    memberApi.getQuote(quoteId)
      .then((loaded) => {
        if (!active) return;
        setQuote(loaded);
        setServerOffsetMs(new Date(loaded.serverNow).getTime() - Date.now());
      })
      .catch((caught) => {
        if (!active) return;
        if (caught instanceof MemberApiFailure && caught.code === "SESSION_REQUIRED") {
          router.replace("/login");
          return;
        }
        setError(caught instanceof Error ? caught.message : "โหลด Quote ไม่สำเร็จ");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [quoteId, router]);

  const remaining = quote
    ? formatRemaining(quote.expiresAt, new Date(clock + serverOffsetMs).toISOString())
    : "—";
  const quoteUsable = quote?.status === "QUOTED" && remaining !== "ปิดรับแล้ว";
  const canConfirm = Boolean(quoteUsable && accepted && !busy);
  const totalReturnMinor = useMemo(() => {
    if (!quote) return null;
    let total = 0n;
    for (const line of quote.lines) {
      const payout = payoutReturnMinor(line.stakeMinor, line.resolvedPayout);
      if (payout === null) return null;
      total += BigInt(payout);
    }
    return total.toString();
  }, [quote]);

  async function confirm() {
    if (!quote || !canConfirm) return;
    setBusy(true);
    setError("");
    try {
      let currentOrder = order;
      if (!currentOrder) {
        if (!orderCommand.current || orderCommand.current.quoteId !== quote.id) {
          orderCommand.current = { quoteId: quote.id, key: createIdempotencyKey() };
        }
        currentOrder = await memberApi.createOrder(quote.id, orderCommand.current.key);
        setOrder(currentOrder);
      }

      if (currentOrder.state === "CONFIRMED") {
        router.push(`/buy/receipt?orderId=${encodeURIComponent(currentOrder.id)}`);
        return;
      }

      if (!currentOrder.allowedActions.includes("CONFIRM")) {
        setError(`รายการอยู่ในสถานะ ${currentOrder.state} และยังยืนยันต่อไม่ได้`);
        return;
      }

      if (
        !confirmCommand.current ||
        confirmCommand.current.orderId !== currentOrder.id ||
        confirmCommand.current.version !== currentOrder.version
      ) {
        confirmCommand.current = {
          orderId: currentOrder.id,
          version: currentOrder.version,
          key: createIdempotencyKey(),
        };
      }

      const confirmed = await memberApi.confirmOrder(
        currentOrder.id,
        confirmCommand.current.version,
        confirmCommand.current.key,
      );
      setOrder(confirmed);
      if (confirmed.state === "CONFIRMED") {
        confirmCommand.current = null;
        router.push(`/buy/receipt?orderId=${encodeURIComponent(confirmed.id)}`);
      }
    } catch (caught) {
      if (caught instanceof MemberApiFailure && caught.code === "SESSION_REQUIRED") {
        router.replace("/login");
        return;
      }
      setError(caught instanceof Error ? caught.message : "ยืนยันรายการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function refreshOrder() {
    if (!order || busy) return;
    setBusy(true);
    setError("");
    try {
      const latest = await memberApi.getOrder(order.id);
      setOrder(latest);
      if (latest.state === "CONFIRMED") {
        router.push(`/buy/receipt?orderId=${encodeURIComponent(latest.id)}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ตรวจสถานะรายการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  if (!quoteId) {
    return <main id="main"><section className="panel"><h1>ไม่พบ Quote</h1><p>สร้าง Quote จากรายการที่ต้องการซื้อก่อน</p><Link className="button primary" href="/buy">กลับไปเลือกงวด</Link></section></main>;
  }

  if (loading) {
    return <main id="main"><section className="panel"><p role="status">กำลังโหลด Quote…</p></section></main>;
  }

  if (!quote) {
    return <main id="main"><section className="panel"><h1>เปิด Quote ไม่ได้</h1>{error && <p role="alert">{error}</p>}<Link className="button primary" href="/buy">กลับไปเลือกงวด</Link></section></main>;
  }

  return <main id="main">
    <div className="breadcrumb"><Link href="/">หน้าแรก</Link><span>/</span><Link href="/buy">ซื้อหวย</Link><span>/</span><Link href={`/buy/bet?drawId=${encodeURIComponent(quote.drawId)}`}>ใส่เลข</Link><span>/</span><span>Quote</span></div>
    <div className="page-head"><div><h1>ตรวจสอบข้อเสนอก่อนยืนยัน</h1><p>รายการและอัตราจ่ายด้านล่างคือค่าที่ server ยอมรับไว้ใน Quote นี้</p></div></div>
    <div className="stepper"><div className="step done"><strong>1 · เลือกงวด</strong>เลือกแล้ว</div><div className="step done"><strong>2 · ใส่เลข</strong>{quote.lines.length} รายการ</div><div className="step active"><strong>3 · ตรวจ Quote</strong>{quoteUsable ? "รอยืนยัน" : quote.status}</div><div className="step"><strong>4 · ยืนยัน</strong>{order?.state ?? "ยังไม่ยืนยัน"}</div></div>

    {!quoteUsable && <div className="notice warning" role="alert"><b>!</b><div><strong>Quote นี้ใช้ยืนยันไม่ได้แล้ว</strong>สถานะ {quote.status} · กรุณากลับไปสร้าง Quote ใหม่</div></div>}
    {error && <div className="notice warning" role="alert"><b>!</b><div><strong>ดำเนินการไม่ได้</strong>{error}</div></div>}

    <section className="quote-box">
      <div className="quote-head"><div><strong>Quote {shortId(quote.id)}</strong><div className="small" style={{ color: "#cde4da", marginTop: 4 }}>{productLabel(quote.productId)} · Draw {shortId(quote.drawId)}</div></div><div><div className="small" style={{ color: "#cde4da" }}>Quote หมดอายุใน</div><div className="quote-timer">{remaining}</div></div></div>
      <div className="quote-body">
        <div className="table-wrap"><table className="quote-lines"><thead><tr><th>ประเภท</th><th>เลข</th><th>อัตราจ่ายที่ยอมรับ</th><th>ยอดซื้อ</th><th>เงินรางวัลเมื่อถูกรางวัล</th></tr></thead><tbody>{quote.lines.map((line) => {
          const payoutMinor = payoutReturnMinor(line.stakeMinor, line.resolvedPayout);
          return <tr key={`${line.betTypeCode}:${line.canonicalNumber}`}><td>{line.betTypeCode}</td><td><strong>{line.canonicalNumber}</strong></td><td className="payout">{formatPayout(line.resolvedPayout)}</td><td>{formatMinor(line.stakeMinor)} บาท</td><td>{payoutMinor ? `${formatMinor(payoutMinor)} บาท` : "ดูตามเงื่อนไข payout"}</td></tr>;
        })}</tbody></table></div>
        <div className="grid-equal" style={{ marginTop: 18 }}>
          <div className="summary-box"><div className="summary-row"><span>ยอดซื้อรวม</span><strong>{formatMinor(quote.totalStakeMinor)} บาท</strong></div>{totalReturnMinor && <div className="summary-row"><span>ผลตอบแทนรวมสูงสุดของรายการที่ถูกรางวัลทั้งหมด</span><strong>{formatMinor(totalReturnMinor)} บาท</strong></div>}<div className="summary-row total"><span>สถานะ Quote</span><strong>{quote.status}</strong></div></div>
          <div className="stack"><div className="notice success"><b>✓</b><div><strong>ระบบสร้าง Quote แล้ว</strong>payout และ restriction ในแต่ละบรรทัดถูกบันทึกกับข้อเสนอนี้แล้ว</div></div><div className="notice info"><b>i</b><div><strong>Confirm จะตรวจ cutoff, eligibility และยอดเงินอีกครั้ง</strong>รายการจะสำเร็จเมื่อ Order กลายเป็น CONFIRMED เท่านั้น</div></div>{quote.lines.some((line) => line.restrictions.length) && <div className="notice warning"><b>!</b><div><strong>ข้อจำกัดที่ใช้กับ Quote</strong>{quote.lines.flatMap((line) => line.restrictions).join(", ")}</div></div>}</div>
        </div>
        <label className="quote-accept-row"><input type="checkbox" checked={accepted} disabled={!quoteUsable || busy} onChange={(event) => setAccepted(event.target.checked)} /><span>ฉันตรวจเลข จำนวนเงิน และอัตราจ่ายที่ระบบยอมรับแล้ว และต้องการยืนยันรายการนี้</span></label>
        <div className="quote-confirm-actions"><Link className="button secondary" href={`/buy/bet?drawId=${encodeURIComponent(quote.drawId)}`}>← แก้ไขรายการ</Link><button className={`button lime ${canConfirm ? "" : "disabled"}`} type="button" disabled={!canConfirm} onClick={() => void confirm()}>{busy ? "กำลังยืนยัน…" : `ยืนยันซื้อ ${formatMinor(quote.totalStakeMinor)} บาท`}</button></div>
        {order && order.state !== "CONFIRMED" && <div className="notice info" style={{ marginTop: 16 }}><b>i</b><div><strong>Order {shortId(order.id)} · {order.state}</strong>หากคำสั่งอยู่ระหว่างดำเนินการ สามารถตรวจสถานะล่าสุดได้โดยไม่สร้างคำสั่งใหม่</div><button className="button secondary" type="button" disabled={busy} onClick={() => void refreshOrder()}>ตรวจสถานะล่าสุด</button></div>}
      </div>
    </section>
  </main>;
}
