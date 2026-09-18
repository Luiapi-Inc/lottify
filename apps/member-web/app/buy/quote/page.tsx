"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  createIdempotencyKey,
  memberApi,
  type BettingQuote,
} from "../../lib/member-api";
import {
  describeFailureCode,
  describeMemberApiFailure,
  describeResolvedPayout,
  expectedWinMinor,
  formatBaht,
  formatDateTime,
  sumMinor,
} from "../../lib/member-display";

type QuoteState =
  | { status: "loading" }
  | { status: "ready"; quote: BettingQuote; serverOffsetMs: number }
  | { status: "failed"; message: string; code: string; correlationId?: string };

type ConfirmState =
  | { status: "idle" }
  | { status: "working"; step: "order" | "confirm" }
  | { status: "rejected"; reason: string; orderId: string }
  | { status: "failed"; code: string; message: string; correlationId?: string };

function secondsUntil(target: string, offsetMs: number): number {
  return Math.floor((new Date(target).getTime() - (Date.now() + offsetMs)) / 1000);
}

function formatClock(totalSeconds: number): string {
  if (totalSeconds <= 0) return "หมดอายุแล้ว";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function QuotePage() {
  const router = useRouter();
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [state, setState] = useState<QuoteState>({ status: "loading" });
  const [accepted, setAccepted] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>({ status: "idle" });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQuoteId(params.get("quoteId"));
  }, []);

  useEffect(() => {
    if (quoteId === null) return;
    if (!quoteId) {
      setState({ status: "failed", message: "ไม่พบ Quote ที่จะตรวจ กรุณาสร้าง Quote ใหม่จากหน้ากรอกเลข", code: "QUOTE_NOT_SELECTED" });
      return;
    }
    let active = true;
    memberApi
      .getQuote(quoteId)
      .then((quote) => {
        if (!active) return;
        // Anchor the countdown to the server's own clock: the Draw cutoff and
        // the Quote expiry are server-authoritative instants.
        const serverOffsetMs = new Date(quote.serverNow).getTime() - Date.now();
        setState({ status: "ready", quote, serverOffsetMs });
      })
      .catch((loadError) => {
        if (!active) return;
        const failure = describeMemberApiFailure(loadError);
        setState({ status: "failed", message: failure.message, code: failure.code, correlationId: failure.correlationId });
      });
    return () => {
      active = false;
    };
  }, [quoteId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const quote = state.status === "ready" ? state.quote : null;
  const offset = state.status === "ready" ? state.serverOffsetMs : 0;
  const totalStakeMinor = useMemo(
    () => (quote ? sumMinor(quote.lines.map((line) => line.stakeMinor)) : 0n),
    [quote],
  );
  const expiresIn = quote ? Math.floor((new Date(quote.expiresAt).getTime() - now - offset) / 1000) : 0;
  const cutoffIn = quote ? Math.floor((new Date(quote.cutoffAt).getTime() - now - offset) / 1000) : 0;
  const expired = quote ? quote.status === "EXPIRED" || expiresIn <= 0 : false;
  const canConfirm = Boolean(quote) && accepted && !expired && confirm.status === "idle";

  const submit = async () => {
    if (state.status !== "ready") return;
    const current = state.quote;
    try {
      setConfirm({ status: "working", step: "order" });
      // Creating the Order moves no money; Confirm is the only financial step.
      const order = await memberApi.createOrder(current.id, createIdempotencyKey());
      setConfirm({ status: "working", step: "confirm" });
      const confirmed = await memberApi.confirmOrder(order.id, order.version, createIdempotencyKey());
      if (confirmed.state === "CONFIRMED") {
        router.push(`/buy/receipt?orderId=${encodeURIComponent(confirmed.id)}`);
        return;
      }
      if (confirmed.state === "REJECTED") {
        setConfirm({
          status: "rejected",
          reason: confirmed.rejectionReason ?? "UNKNOWN",
          orderId: confirmed.id,
        });
        return;
      }
      // Any other state (EXPIRED/CANCELLED by a concurrent actor) is reported
      // as-is instead of being presented as a successful purchase.
      setConfirm({
        status: "failed",
        code: confirmed.state,
        message: `เซิร์ฟเวอร์คืนสถานะรายการเป็น ${confirmed.state} จึงยังไม่ถือว่าซื้อสำเร็จ`,
      });
    } catch (error) {
      const failure = describeMemberApiFailure(error);
      setConfirm({ status: "failed", code: failure.code, message: failure.message, correlationId: failure.correlationId });
    }
  };

  if (state.status === "loading" || quoteId === null) {
    return <main id="main">
      <div className="breadcrumb"><Link href="/">หน้าแรก</Link><span>/</span><Link href="/buy">ซื้อหวย</Link><span>/</span><span>Quote</span></div>
      <section className="panel"><div className="panel-title"><h2>กำลังโหลด Quote</h2></div><p className="muted small">กำลังดึงข้อเสนอที่เซิร์ฟเวอร์บันทึกไว้…</p></section>
    </main>;
  }

  if (state.status === "failed") {
    return <main id="main">
      <div className="breadcrumb"><Link href="/">หน้าแรก</Link><span>/</span><Link href="/buy">ซื้อหวย</Link><span>/</span><span>Quote</span></div>
      <section className="panel"><div className="panel-title"><h2>เปิด Quote นี้ไม่ได้</h2><span className="status danger">{state.code}</span></div><p className="muted small">{state.message}</p>{state.correlationId && <p className="muted small">รหัสอ้างอิง: {state.correlationId}</p>}<div className="quote-confirm-actions" style={{ marginTop: 14 }}><Link className="button secondary" href="/buy">← เลือกงวดใหม่</Link></div></section>
    </main>;
  }

  const failure = confirm.status === "failed" ? confirm : null;
  const rejected = confirm.status === "rejected" ? confirm : null;
  const active = state.quote;

  return <main id="main">
    <div className="breadcrumb"><Link href="/">หน้าแรก</Link><span>/</span><Link href="/buy">ซื้อหวย</Link><span>/</span><span>Quote</span></div>
    <div className="page-head"><div><h1>ตรวจสอบข้อเสนอก่อนยืนยัน</h1><p>ราคา รายการ และเวลาด้านล่างคือข้อมูลที่เซิร์ฟเวอร์ยอมรับ ณ เวลาที่สร้าง Quote หากมีการเปลี่ยนแปลงสำคัญ ระบบจะปฏิเสธการยืนยันและให้คุณเริ่มใหม่</p></div></div>
    <div className="stepper"><div className="step done"><strong>1 · เลือกงวด</strong>เลือกแล้ว</div><div className="step done"><strong>2 · ใส่เลข</strong>{active.lines.length} รายการ</div><div className="step active"><strong>3 · ตรวจ Quote</strong>{expired ? "ต้องดำเนินการ" : "เหลือเวลาจำกัด"}</div><div className="step"><strong>4 · ยืนยัน</strong>ยังไม่ยืนยัน</div></div>

    {(expired || cutoffIn <= 0) && <div className="quote-failure quote-failure-warning" aria-live="polite">
      <div className="quote-failure-icon">!</div>
      <div className="quote-failure-copy"><strong>{cutoffIn <= 0 ? "งวดนี้ปิดรับแล้ว" : "Quote นี้หมดอายุแล้ว"}</strong><span>{cutoffIn <= 0 ? "ระบบหยุดรับการยืนยันรายการของงวดนี้แล้ว กรุณากลับไปเลือกงวดที่ยังเปิดรับ" : "ราคานี้ใช้ยืนยันต่อไม่ได้ กรุณาสร้าง Quote ใหม่จากรายการเดิม"}</span></div>
      <div className="quote-failure-actions"><Link className="button secondary" href={cutoffIn <= 0 ? "/buy" : "/buy/bet"}>{cutoffIn <= 0 ? "เลือกงวดใหม่" : "สร้าง Quote ใหม่"}</Link></div>
    </div>}

    {rejected && <div className="quote-failure quote-failure-danger" aria-live="polite">
      <div className="quote-failure-icon">!</div>
      <div className="quote-failure-copy"><strong>ระบบปฏิเสธการยืนยันรายการนี้</strong><span>{describeFailureCode(rejected.reason)} · เหตุผลจากเซิร์ฟเวอร์: {rejected.reason}</span></div>
      <div className="quote-failure-actions"><Link className="button secondary" href={`/slips/detail?orderId=${encodeURIComponent(rejected.orderId)}`}>ดูรายการนี้</Link><Link className="button secondary" href="/buy/bet">สร้าง Quote ใหม่</Link></div>
    </div>}

    {failure && <div className={`quote-failure quote-failure-${failure.code === "INSUFFICIENT_FUNDS" ? "danger" : "warning"}`} aria-live="polite">
      <div className="quote-failure-icon">!</div>
      <div className="quote-failure-copy"><strong>ยืนยันรายการไม่สำเร็จ ({failure.code})</strong><span>{failure.message}</span>{failure.correlationId && <span className="muted small">รหัสอ้างอิง: {failure.correlationId}</span>}</div>
      <div className="quote-failure-actions"><Link className="button secondary" href="/wallet">ไปที่กระเป๋า</Link><Link className="button secondary" href="/buy/bet">แก้ไขรายการ</Link></div>
    </div>}

    <section className="quote-box">
      <div className="quote-head"><div><strong>Quote #{active.id}</strong><div className="small" style={{ color: "#cde4da", marginTop: 4 }}>งวด {new Date(active.cutoffAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })} · สถานะ {active.status}</div></div><div><div className="small" style={{ color: "#cde4da" }}>{expired ? "Quote สถานะ" : "Quote หมดอายุใน"}</div><div className="quote-timer">{expired ? active.status : formatClock(expiresIn)}</div></div></div>
      <div className="quote-body">
        <div className="table-wrap"><table className="quote-lines"><thead><tr><th>ประเภท</th><th>เลข</th><th>อัตราจ่ายที่อนุมัติ</th><th>ยอดซื้อ</th><th>เงินรางวัลเมื่อถูก</th></tr></thead><tbody>
          {active.lines.map((line) => {
            const win = expectedWinMinor(line.stakeMinor, line.resolvedPayout);
            return <tr key={`${line.betTypeCode}-${line.canonicalNumber}`}><td>{line.betTypeCode}</td><td><strong>{line.canonicalNumber}</strong></td><td className="payout">{describeResolvedPayout(line.resolvedPayout)}</td><td>{formatBaht(line.stakeMinor)}</td><td>{win === null ? "—" : formatBaht(win)}</td></tr>;
          })}
        </tbody></table></div>
        <div className="grid-equal" style={{ marginTop: 18 }}>
          <div className="summary-box"><div className="summary-row"><span>ยอดซื้อรวม</span><strong>{formatBaht(totalStakeMinor)}</strong></div><div className="summary-row"><span>ปิดรับงวด</span><strong>{formatDateTime(active.cutoffAt)}</strong></div><div className="summary-row"><span>Quote หมดอายุ</span><strong>{formatDateTime(active.expiresAt)}</strong></div><div className="summary-row total"><span>ชำระรวม</span><strong>{formatBaht(totalStakeMinor)}</strong></div></div>
          <div className="stack"><div className="notice success"><b>✓</b><div><strong>เซิร์ฟเวอร์คำนวณอัตราจ่ายให้แล้ว</strong>อัตราจ่ายและข้อจำกัดในตารางคือค่าที่ระบบยอมรับ ณ เวลาสร้าง Quote</div></div><div className="notice info"><b>i</b><div><strong>ก่อนยืนยัน ระบบจะตรวจซ้ำอีกครั้ง</strong>หาก payout, cutoff, restriction หรือยอดเงินเปลี่ยน ระบบจะปฏิเสธและแจ้งเหตุผลให้คุณเห็น</div></div></div>
        </div>
        <label className="quote-accept-row"><input type="checkbox" checked={accepted} disabled={expired || confirm.status !== "idle"} onChange={(event) => setAccepted(event.target.checked)} /><span>ฉันตรวจเลข จำนวนเงิน อัตราจ่าย และแหล่งเงินเรียบร้อยแล้ว และต้องการยืนยันรายการนี้</span></label>
        <div className="quote-confirm-actions"><Link className="button secondary block" href="/buy/bet" style={{ flex: "0 0 auto" }}>← แก้ไขรายการ</Link><button className={`button lime ${canConfirm ? "" : "disabled"}`} type="button" disabled={!canConfirm} onClick={submit}>{confirm.status === "working" ? (confirm.step === "order" ? "กำลังสร้างรายการ…" : "กำลังยืนยันกับระบบเงิน…") : `ยืนยันซื้อ ${formatBaht(totalStakeMinor)}`}</button></div>
      </div>
    </section>
  </main>;
}
