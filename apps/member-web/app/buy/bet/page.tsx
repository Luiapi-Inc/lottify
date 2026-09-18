"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createIdempotencyKey, memberApi, type MemberDraw, type QuoteCreateLine } from "../../lib/member-api";
import { ErrorState, LoadingState, Money, PageHeading, Section, StatusBadge } from "../../components/presentation";

type DraftLine = QuoteCreateLine & { localId: string };

export default function BetEntryPage() {
  const [drawId, setDrawId] = useState("");
  const [draw, setDraw] = useState<MemberDraw | null>(null);
  const [betTypeCode, setBetTypeCode] = useState("");
  const [number, setNumber] = useState("");
  const [amountBaht, setAmountBaht] = useState("");
  const [bulk, setBulk] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const quoteIdentity = useRef<{ signature: string; key: string } | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const [detail, eligibility] = await Promise.all([
        memberApi.getDraw(id),
        memberApi.getDrawEligibility(id),
      ]);
      if (!eligibility.eligible || detail.state !== "OPEN") {
        throw new Error("งวดนี้ไม่เปิดรับเดิมพันแล้ว กรุณากลับไปเลือก Draw ใหม่");
      }
      setDraw(detail);
      setBetTypeCode((current) => current || detail.betTypes[0]?.betTypeCode || "");
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("drawId") ?? "";
    setDrawId(id);
    if (id) void load(id);
    else {
      setLoading(false);
      setError(new Error("ไม่พบ drawId กรุณาเลือก Draw จากหน้าซื้อหวยก่อน"));
    }
  }, [load]);

  const selectedBetType = draw?.betTypes.find((item) => item.betTypeCode === betTypeCode);
  const totalMinor = useMemo(() => lines.reduce((sum, line) => sum + BigInt(line.stakeMinor || "0"), 0n).toString(), [lines]);

  function toMinor(value: string): string | null {
    const baht = Number(value);
    if (!Number.isFinite(baht) || baht <= 0) return null;
    return String(Math.round(baht * 100));
  }

  function validate(canonicalNumber: string, stakeMinor: string): string | null {
    if (!selectedBetType) return "กรุณาเลือก Bet Type";
    try {
      if (!new RegExp(selectedBetType.validationPattern).test(canonicalNumber)) {
        return `เลขไม่ตรงรูปแบบ ${selectedBetType.canonicalNumberFormat}`;
      }
    } catch {
      return "Validation rule จาก backend ไม่สามารถประมวลผลได้";
    }
    const stake = BigInt(stakeMinor);
    if (stake < BigInt(selectedBetType.minStakeMinor) || stake > BigInt(selectedBetType.maxStakeMinor)) {
      return `ยอดต่อเลขต้องอยู่ระหว่าง ${Number(selectedBetType.minStakeMinor) / 100}–${Number(selectedBetType.maxStakeMinor) / 100} บาท`;
    }
    return null;
  }

  function addNumbers(values: string[]) {
    const stakeMinor = toMinor(amountBaht);
    if (!stakeMinor) {
      setFeedback("กรุณาระบุจำนวนเงินที่มากกว่า 0");
      return;
    }
    const normalized = values.map((value) => value.trim()).filter(Boolean);
    if (!normalized.length) {
      setFeedback("กรุณาระบุเลขอย่างน้อย 1 รายการ");
      return;
    }
    const next: DraftLine[] = [];
    for (const canonicalNumber of normalized) {
      const violation = validate(canonicalNumber, stakeMinor);
      if (violation) {
        setFeedback(`${canonicalNumber}: ${violation}`);
        return;
      }
      next.push({ localId: createIdempotencyKey(), betTypeCode, canonicalNumber, stakeMinor });
    }
    setLines((current) => {
      const merged = [...current];
      for (const item of next) {
        const existing = merged.find((line) => line.betTypeCode === item.betTypeCode && line.canonicalNumber === item.canonicalNumber);
        if (existing) existing.stakeMinor = (BigInt(existing.stakeMinor) + BigInt(item.stakeMinor)).toString();
        else merged.push({ ...item });
      }
      return [...merged];
    });
    quoteIdentity.current = null;
    setNumber("");
    setBulk("");
    setFeedback(`เพิ่ม ${next.length} รายการแล้ว`);
  }

  async function createQuote(event: FormEvent) {
    event.preventDefault();
    if (!draw || !lines.length) return;
    setSubmitting(true);
    setError(null);
    const payload = lines.map(({ betTypeCode, canonicalNumber, stakeMinor }) => ({ betTypeCode, canonicalNumber, stakeMinor }));
    const signature = JSON.stringify({ drawId: draw.id, payload });
    if (!quoteIdentity.current || quoteIdentity.current.signature !== signature) {
      quoteIdentity.current = { signature, key: createIdempotencyKey() };
    }
    try {
      const quote = await memberApi.createQuote(draw.id, payload, quoteIdentity.current.key);
      window.location.assign(`/buy/quote?quoteId=${encodeURIComponent(quote.id)}`);
    } catch (cause) {
      setError(cause);
    } finally {
      setSubmitting(false);
    }
  }

  return <main id="main">
    <PageHeading
      eyebrow="BETTING · STEP 2"
      title="กรอกเลขเป็น Canonical Bet Lines"
      description="เลขศูนย์นำหน้าถูกเก็บเป็น string ตาม Bet Type rule การตรวจในหน้านี้สะท้อน validation/min/max จาก Draw เท่านั้น และ server ยังเป็นผู้ตัดสินสุดท้ายตอน Quote"
      action={<Link className="button secondary" href="/buy">← เปลี่ยนงวด</Link>}
    />
    <div className="stepper">
      <div className="step done"><strong>1 · เลือกงวด</strong>{draw?.occurrenceIdentity ?? "เลือกแล้ว"}</div>
      <div className="step active"><strong>2 · ใส่เลข</strong>{lines.length} รายการ</div>
      <div className="step"><strong>3 · Quote</strong>ยังไม่สร้าง</div>
      <div className="step"><strong>4 · Confirm</strong>ยังไม่ยืนยัน</div>
    </div>

    {loading ? <LoadingState label="กำลังโหลด Draw และ eligibility…" /> : null}
    {error ? <div style={{ marginBottom: 16 }}><ErrorState error={error} retry={drawId ? () => void load(drawId) : undefined} /></div> : null}

    {draw ? <form onSubmit={createQuote}>
      <section className="grid-2">
        <div className="stack">
          <Section title="1. เลือก Bet Type" subtitle="ค่าทั้งหมดมาจาก Draw snapshot">
            <div className="section-tabs">
              {draw.betTypes.map((item) => <button key={item.betTypeCode} type="button" className={`tab ${betTypeCode === item.betTypeCode ? "active" : ""}`} onClick={() => { setBetTypeCode(item.betTypeCode); quoteIdentity.current = null; }}>
                {item.betTypeCode}
              </button>)}
            </div>
            {selectedBetType ? <div className="notice info"><b>i</b><div><strong>{selectedBetType.canonicalNumberFormat}</strong>Pattern {selectedBetType.validationPattern} · ขั้นต่ำ <Money minor={selectedBetType.minStakeMinor} /> · สูงสุด <Money minor={selectedBetType.maxStakeMinor} /></div></div> : null}
          </Section>

          <Section title="2. เพิ่มเลขและจำนวนเงิน" subtitle="รองรับเลขเดียวหรือ paste หลายเลข">
            <div className="form-grid">
              <div className="field"><label htmlFor="number">เลข</label><input id="number" value={number} inputMode="numeric" placeholder={selectedBetType?.canonicalNumberFormat ?? "เช่น 007"} onChange={(event) => setNumber(event.target.value.replace(/\s/g, ""))} /></div>
              <div className="field"><label htmlFor="amount">จำนวนเงินต่อเลข (บาท)</label><input id="amount" value={amountBaht} inputMode="decimal" placeholder="100" onChange={(event) => setAmountBaht(event.target.value)} /></div>
              <div className="field full"><button className="button primary" type="button" onClick={() => addNumbers([number])}>+ เพิ่มเลขนี้</button></div>
              <div className="field full"><label htmlFor="bulk">เพิ่มหลายเลข</label><textarea id="bulk" value={bulk} placeholder="007 125 908" onChange={(event) => setBulk(event.target.value)} /><button className="button secondary" type="button" onClick={() => addNumbers(bulk.split(/[\s,]+/))}>เพิ่มจากรายการ</button></div>
            </div>
            {feedback ? <div className="hint" style={{ marginTop: 10 }}>{feedback}</div> : null}
          </Section>

          <Section title="3. Review Lines" subtitle="เลขซ้ำ Bet Type เดียวกันจะรวม stake ก่อน Quote">
            {lines.length ? <div className="data-list">{lines.map((line) => <div className="data-row" key={line.localId}>
              <div className="data-main"><strong>{line.canonicalNumber}</strong><span>{line.betTypeCode}</span></div>
              <div className="data-meta"><strong><Money minor={line.stakeMinor} /></strong><button type="button" className="text-button" onClick={() => { setLines((current) => current.filter((item) => item.localId !== line.localId)); quoteIdentity.current = null; }}>ลบ</button></div>
            </div>)}</div> : <div className="state-card"><span className="state-symbol">+</span><div><strong>ยังไม่มี Bet Line</strong><p>เพิ่มเลขอย่างน้อยหนึ่งรายการก่อนสร้าง Quote</p></div></div>}
          </Section>
        </div>

        <aside className="stack">
          <Section title="Draw authority" subtitle="ข้อมูลที่มีผลกับรายการนี้">
            <div className="data-list">
              <div className="data-row"><div className="data-main"><strong>{draw.occurrenceIdentity}</strong><span>{draw.localDate} · {draw.timezone}</span></div><StatusBadge tone={draw.state === "OPEN" ? "success" : "warning"}>{draw.state}</StatusBadge></div>
              <div className="data-row"><div className="data-main"><strong>Cutoff</strong><span>Server authority</span></div><div className="data-meta"><strong>{new Date(draw.cutoffAt).toLocaleString("th-TH")}</strong></div></div>
            </div>
          </Section>
          <section className="summary-box">
            <div className="summary-row"><span>จำนวน Bet Lines</span><strong>{lines.length}</strong></div>
            <div className="summary-row total"><span>ยอดส่ง Quote</span><strong><Money minor={totalMinor} /></strong></div>
            <button className="button lime block" style={{ marginTop: 12 }} type="submit" disabled={!lines.length || submitting}>{submitting ? "กำลังสร้าง Quote…" : "สร้าง Quote จาก API →"}</button>
          </section>
          <div className="notice warning"><b>!</b><div><strong>Quote ไม่ใช่การยืนยันซื้อ</strong>Server จะ resolve payout/restrictions และตรวจซ้ำอีกครั้งตอน Confirm</div></div>
        </aside>
      </section>
    </form> : null}
  </main>;
}
