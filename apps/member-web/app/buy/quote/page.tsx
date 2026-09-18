"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createIdempotencyKey,
  memberApi,
  type BetOrder,
  type BettingQuote,
} from "../../lib/member-api";
import { ErrorState, LoadingState, Money, PageHeading, Section, StatusBadge } from "../../components/presentation";

export default function QuotePage() {
  const [quoteId, setQuoteId] = useState("");
  const [quote, setQuote] = useState<BettingQuote | null>(null);
  const [order, setOrder] = useState<BetOrder | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const createOrderKey = useRef(createIdempotencyKey());
  const confirmOrderKey = useRef(createIdempotencyKey());

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      setQuote(await memberApi.getQuote(id));
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("quoteId") ?? "";
    setQuoteId(id);
    if (id) void load(id);
    else {
      setLoading(false);
      setError(new Error("ไม่พบ quoteId กรุณาสร้าง Quote ใหม่จากหน้ากรอกเลข"));
    }
  }, [load]);

  const expired = useMemo(() => !quote || quote.status === "EXPIRED" || new Date(quote.expiresAt).getTime() <= Date.now(), [quote]);
  const canConfirm = Boolean(quote && !expired && accepted && !confirming);

  async function confirm() {
    if (!quote || !canConfirm) return;
    setConfirming(true);
    setError(null);
    try {
      const currentOrder = order ?? await memberApi.createOrder(quote.id, createOrderKey.current);
      setOrder(currentOrder);
      const confirmed = await memberApi.confirmOrder(
        currentOrder.id,
        { version: currentOrder.version },
        confirmOrderKey.current,
      );
      setOrder(confirmed);
      window.location.assign(`/buy/receipt?orderId=${encodeURIComponent(confirmed.id)}`);
    } catch (cause) {
      setError(cause);
    } finally {
      setConfirming(false);
    }
  }

  return <main id="main">
    <PageHeading
      eyebrow="BETTING · STEP 3"
      title="Quote คือเงื่อนไขจาก Server"
      description="ตรวจ canonical lines, stake, payout และ restrictions ที่ backend resolve แล้วก่อนสร้าง Bet Order และ Confirm ไม่มีการคำนวณ payout หรือสร้างสถานะสำเร็จเองใน browser"
      action={<Link className="button secondary" href="/buy/bet">← แก้รายการ</Link>}
    />
    <div className="stepper">
      <div className="step done"><strong>1 · เลือกงวด</strong>เสร็จแล้ว</div>
      <div className="step done"><strong>2 · ใส่เลข</strong>ส่งให้ server แล้ว</div>
      <div className="step active"><strong>3 · Quote</strong>{quote?.status ?? "กำลังโหลด"}</div>
      <div className="step"><strong>4 · Confirm</strong>{order?.state ?? "ยังไม่สร้าง Order"}</div>
    </div>

    {loading ? <LoadingState label="กำลังอ่าน Quote จาก API…" /> : null}
    {error ? <div style={{ marginBottom: 16 }}><ErrorState error={error} retry={quoteId ? () => void load(quoteId) : undefined} /></div> : null}

    {quote ? <section className="grid-2">
      <div className="stack">
        <Section
          title={`Quote ${quote.id}`}
          subtitle={`Draw ${quote.drawId} · หมดอายุ ${new Date(quote.expiresAt).toLocaleString("th-TH")}`}
          action={<StatusBadge tone={expired ? "danger" : "success"}>{expired ? "EXPIRED" : quote.status}</StatusBadge>}
        >
          <div className="table-wrap"><table><thead><tr><th>Bet Type</th><th>เลข</th><th>Stake</th><th>Payout source</th><th>Restrictions</th></tr></thead><tbody>
            {quote.lines.map((line, index) => <tr key={`${line.betTypeCode}-${line.canonicalNumber}-${index}`}>
              <td><strong>{line.betTypeCode}</strong></td>
              <td><strong>{line.canonicalNumber}</strong></td>
              <td><Money minor={line.stakeMinor} /></td>
              <td>{line.payoutSource}</td>
              <td>{line.restrictions.length ? line.restrictions.join(", ") : "ไม่มี"}</td>
            </tr>)}
          </tbody></table></div>
        </Section>

        <Section title="Server-resolved terms" subtitle="ข้อมูลดิบที่ Member ต้องทบทวนก่อน Confirm">
          <div className="data-list">
            {quote.lines.map((line, index) => <div className="data-row" key={index}>
              <div className="data-main"><strong>{line.betTypeCode} · {line.canonicalNumber}</strong><span>Payout: {Object.keys(line.resolvedPayout).length ? JSON.stringify(line.resolvedPayout) : "ตาม policy snapshot ของ server"}</span></div>
              <div className="data-meta"><strong><Money minor={line.stakeMinor} /></strong><span>{line.payoutSource}</span></div>
            </div>)}
          </div>
        </Section>
      </div>

      <aside className="stack">
        <section className="summary-box">
          <div className="summary-row"><span>Currency</span><strong>{quote.currency}</strong></div>
          <div className="summary-row"><span>จำนวนรายการ</span><strong>{quote.lines.length}</strong></div>
          <div className="summary-row total"><span>ยอดซื้อรวม</span><strong><Money minor={quote.totalStakeMinor} /></strong></div>
        </section>

        {expired ? <div className="notice danger"><b>!</b><div><strong>Quote ใช้ต่อไม่ได้</strong>กลับไปสร้าง Quote ใหม่ ระบบจะไม่ Confirm เงื่อนไขที่หมดอายุ</div></div> : <div className="notice info"><b>i</b><div><strong>Confirm จะ revalidate อีกครั้ง</strong>Draw, eligibility, restriction, exposure และ Wallet ยังเป็น authoritative server checks</div></div>}

        {order ? <Section title="Bet Order" subtitle="Order ถูกสร้างแล้วและสามารถ retry Confirm ด้วย idempotency identity เดิม">
          <div className="data-row"><div className="data-main"><strong>{order.id}</strong><span>version {order.version} · {order.allowedActions.join(", ") || "ไม่มี action"}</span></div><StatusBadge tone={order.state === "CONFIRMED" ? "success" : "info"}>{order.state}</StatusBadge></div>
        </Section> : null}

        <label className="notice" style={{ cursor: expired ? "not-allowed" : "pointer" }}>
          <input type="checkbox" checked={accepted} disabled={expired} onChange={(event) => setAccepted(event.target.checked)} />
          <div><strong>ฉันตรวจเลข ยอดซื้อ และเงื่อนไขจาก Quote แล้ว</strong>การ Confirm จะใช้เงื่อนไขนี้เป็นฐานและให้ server ตรวจซ้ำ</div>
        </label>
        <button className="button lime block" type="button" disabled={!canConfirm} onClick={() => void confirm()}>
          {confirming ? "กำลังสร้าง/ยืนยัน Bet Order…" : `ยืนยันซื้อ ${(Number(quote.totalStakeMinor) / 100).toLocaleString("th-TH")} บาท`}
        </button>
      </aside>
    </section> : null}
  </main>;
}
