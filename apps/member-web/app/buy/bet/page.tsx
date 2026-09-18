"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  createIdempotencyKey,
  memberApi,
  type MemberDraw,
  type MemberDrawBetType,
} from "../../lib/member-api";
import {
  describeDrawState,
  describeMemberApiFailure,
  formatBaht,
  formatDateTime,
  formatPayoutMultiplier,
  isValidCanonicalNumber,
  numberLengthFor,
  parseFixedPayout,
} from "../../lib/member-display";

type BetLine = { number: string; stakeMinor: bigint; mergedCount: number };

type DrawState =
  | { status: "loading" }
  | { status: "ready"; draw: MemberDraw }
  | { status: "failed"; message: string; code: string; correlationId?: string };

function permutations(value: string) {
  const result = new Set<string>();
  const walk = (prefix: string, rest: string) => {
    if (!rest.length) return void result.add(prefix);
    [...rest].forEach((digit, index) => walk(prefix + digit, rest.slice(0, index) + rest.slice(index + 1)));
  };
  walk("", value);
  return [...result];
}

/** Baht entered by the Member -> integer minor units for the API. */
function bahtToMinor(baht: number): string {
  if (!Number.isFinite(baht) || baht <= 0) return "0";
  return BigInt(Math.round(baht * 100)).toString();
}

export default function BetPage() {
  const router = useRouter();
  const [drawId, setDrawId] = useState<string | null>(null);
  const [state, setState] = useState<DrawState>({ status: "loading" });
  const [betTypeId, setBetTypeId] = useState("");
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState(100);
  const [bulk, setBulk] = useState("");
  const [lines, setLines] = useState<BetLine[]>([]);
  const [feedback, setFeedback] = useState("ตัวช่วยจะแตกเป็นเลขจริงและแสดงใน “รายการของคุณ” ก่อนสร้าง Quote");
  const [error, setError] = useState("");
  const [quoting, setQuoting] = useState(false);

  // The Draw id travels in the URL; read it off the location instead of
  // useSearchParams so the page keeps rendering in the guarded app shell.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDrawId(params.get("drawId"));
  }, []);

  useEffect(() => {
    if (drawId === null) return;
    if (!drawId) {
      setState({ status: "failed", message: "ไม่พบงวดที่เลือก กรุณาเลือกงวดจากหน้าซื้อหวยก่อน", code: "DRAW_NOT_SELECTED" });
      return;
    }
    let active = true;
    memberApi
      .getDraw(drawId)
      .then((draw) => {
        if (!active) return;
        setState({ status: "ready", draw });
        setBetTypeId(draw.betTypes[0]?.betTypeId ?? "");
      })
      .catch((loadError) => {
        if (!active) return;
        const failure = describeMemberApiFailure(loadError);
        setState({ status: "failed", message: failure.message, code: failure.code, correlationId: failure.correlationId });
      });
    return () => {
      active = false;
    };
  }, [drawId]);

  const betTypes: MemberDrawBetType[] = state.status === "ready" ? state.draw.betTypes : [];
  const selected = betTypes.find((betType) => betType.betTypeId === betTypeId) ?? betTypes[0];
  const digits = selected ? numberLengthFor(selected) : 0;
  const totalMinor = useMemo(() => lines.reduce((sum, line) => sum + line.stakeMinor, 0n), [lines]);

  const stakeMinorFor = (baht: number): bigint => BigInt(bahtToMinor(baht));

  const addNumbers = (numbers: string[]) => {
    const stake = stakeMinorFor(amount);
    setLines((current) => {
      const next = current.map((line) => ({ ...line }));
      let merged = 0;
      for (const item of numbers) {
        const existing = next.find((line) => line.number === item);
        if (existing) {
          existing.stakeMinor += stake;
          existing.mergedCount += 1;
          merged += 1;
        } else {
          next.push({ number: item, stakeMinor: stake, mergedCount: 1 });
        }
      }
      setFeedback(merged ? `เพิ่ม ${numbers.length} เลข · รวมเลขซ้ำ ${merged} รายการ` : `เพิ่ม ${numbers.length} เลขลงรายการแล้ว`);
      return next;
    });
  };

  const validate = (value: string) => (selected ? isValidCanonicalNumber(selected, value) : false);
  const stakeWithinLimits = (): string | null => {
    if (!selected) return "ยังไม่ได้เลือกประเภทการแทง";
    const stake = stakeMinorFor(amount);
    const min = BigInt(selected.minStakeMinor);
    const max = BigInt(selected.maxStakeMinor);
    if (stake < min) return `จำนวนเงินขั้นต่ำของประเภทนี้คือ ${formatBaht(selected.minStakeMinor)} ต่อรายการ`;
    if (stake > max) return `จำนวนเงินสูงสุดของประเภทนี้คือ ${formatBaht(selected.maxStakeMinor)} ต่อรายการ`;
    return null;
  };

  const addSingle = () => {
    const limitError = stakeWithinLimits();
    if (limitError) return setError(limitError);
    if (!validate(number)) return setError(`กรอกเลข ${digits} หลักให้ตรงกับรูปแบบของประเภทที่เลือก`);
    setError("");
    addNumbers([number]);
    setNumber("");
  };

  const runHelper = (action: "reverse" | "permute" | "run-front" | "run-back") => {
    const limitError = stakeWithinLimits();
    if (limitError) return setError(limitError);
    let generated: string[] = [];
    if (action === "reverse" || action === "permute") {
      if (!validate(number)) return setError(`กรอกเลข ${digits} หลักก่อนใช้ตัวช่วยนี้`);
      generated = action === "reverse" ? [number.split("").reverse().join("")] : permutations(number);
    } else {
      if (digits !== 2) return setError("รูดหน้า/รูดหลังใช้กับประเภท 2 ตัว");
      if (!/^\d$/.test(number)) return setError("กรอก 1 หลักก่อนใช้รูดหน้า/รูดหลัง");
      generated = Array.from({ length: 10 }, (_, index) => (action === "run-front" ? `${number}${index}` : `${index}${number}`));
    }
    setError("");
    addNumbers([...new Set(generated)].filter(validate));
  };

  const addBulk = () => {
    const limitError = stakeWithinLimits();
    if (limitError) return setError(limitError);
    const tokens = bulk.split(/[\s,]+/).map((token) => token.trim()).filter(Boolean);
    const valid = tokens.filter(validate);
    if (!valid.length) return setError(`ไม่พบเลข ${digits} หลักที่เพิ่มได้`);
    setError(tokens.length === valid.length ? "" : `ข้าม ${tokens.length - valid.length} รายการที่รูปแบบไม่ถูกต้อง`);
    addNumbers(valid);
    setBulk("");
  };

  const createQuote = async () => {
    if (state.status !== "ready" || !selected || !lines.length) return;
    setQuoting(true);
    setError("");
    try {
      // The API prices every line server-side; this request carries only the
      // Member's intent (bet type code, canonical number, stake in minor units).
      const quote = await memberApi.createQuote(
        state.draw.id,
        {
          currency: "THB",
          lines: lines.map((line) => ({
            betTypeCode: selected.betTypeCode,
            canonicalNumber: line.number,
            stakeMinor: line.stakeMinor.toString(),
          })),
        },
        createIdempotencyKey(),
      );
      router.push(`/buy/quote?quoteId=${encodeURIComponent(quote.id)}`);
    } catch (quoteError) {
      const failure = describeMemberApiFailure(quoteError);
      setError(failure.correlationId ? `${failure.message} (อ้างอิง ${failure.correlationId})` : failure.message);
    } finally {
      setQuoting(false);
    }
  };

  if (state.status === "loading") {
    return <main id="main">
      <div className="breadcrumb"><Link href="/">หน้าแรก</Link><span>/</span><Link href="/buy">ซื้อหวย</Link><span>/</span><span>ใส่เลข</span></div>
      <section className="panel"><div className="panel-title"><h2>กำลังโหลดข้อมูลงวด</h2></div><p className="muted small">กำลังดึงงวด ประเภทการแทง และอัตราจ่ายจาก API…</p></section>
    </main>;
  }

  if (state.status === "failed") {
    return <main id="main">
      <div className="breadcrumb"><Link href="/">หน้าแรก</Link><span>/</span><Link href="/buy">ซื้อหวย</Link><span>/</span><span>ใส่เลข</span></div>
      <section className="panel"><div className="panel-title"><h2>เปิดงวดนี้ไม่ได้</h2><span className="status danger">{state.code}</span></div><p className="muted small">{state.message}</p>{state.correlationId && <p className="muted small">รหัสอ้างอิง: {state.correlationId}</p>}<Link className="button secondary" href="/buy" style={{ marginTop: 12 }}>← กลับไปเลือกงวด</Link></section>
    </main>;
  }

  const draw = state.draw;
  const drawStatus = describeDrawState(draw.state);
  const eligibility = new Date(draw.cutoffAt).getTime() > Date.now();

  return <main id="main">
    <div className="breadcrumb"><Link href="/">หน้าแรก</Link><span>/</span><Link href="/buy">ซื้อหวย</Link><span>/</span><span>ใส่เลข</span></div>
    <div className="page-head"><div><h1>งวด {draw.localDate}</h1><p>เลือกประเภท ใส่เลขและจำนวนเงิน ระบบจะรวมรายการที่ซ้ำกันและให้เซิร์ฟเวอร์เป็นผู้กำหนดอัตราจ่ายตอนสร้าง Quote</p></div><div className="countdown"><small>ปิดรับ</small><span>{formatDateTime(draw.cutoffAt)}</span></div></div>
    <div className="stepper"><div className="step done"><strong>1 · เลือกงวด</strong>เลือกแล้ว</div><div className="step active"><strong>2 · ใส่เลข</strong>กำลังกรอก</div><div className="step"><strong>3 · ตรวจ Quote</strong>รอสร้าง</div><div className="step"><strong>4 · ยืนยัน</strong>รับใบรับรายการ</div></div>
    <section className="grid-2"><div className="stack">
      <section className="panel"><div className="panel-title"><h2>เพิ่มรายการ</h2><span className={`status ${eligibility ? "success" : "warning"}`}>{eligibility ? drawStatus.label : "เลยเวลาปิดรับของงวดนี้แล้ว"}</span></div>
        {betTypes.length === 0 && <div className="notice warning"><b>!</b><div><strong>งวดนี้ยังไม่มีประเภทการแทงที่เปิดใช้</strong>ระบบไม่แสดงประเภทที่ไม่มีในงวดนี้ เพราะการเสนอประเภทที่ใช้ไม่ได้จะทำให้สร้าง Quote ไม่สำเร็จ</div></div>}
        <div className="form-grid">
          <div className="field"><label htmlFor="bet-type">ประเภท</label><select id="bet-type" className="select" value={selected?.betTypeId ?? ""} onChange={(event) => { setBetTypeId(event.target.value); setNumber(""); setError(""); }} disabled={!betTypes.length}>{betTypes.map((betType) => <option value={betType.betTypeId} key={betType.betTypeId}>{betType.betTypeCode} · จ่าย {formatPayoutMultiplier(parseFixedPayout(betType.payout)?.amountMinor ?? 0n)} · ขั้นต่ำ {formatBaht(betType.minStakeMinor)}</option>)}</select><div className="hint">อัตราจ่ายและข้อจำกัดด้านบนคือค่าที่งวดนี้บันทึกไว้ · รูดหน้า/หลังใช้กับประเภท 2 ตัว</div></div>
          <div className="field number-entry"><label htmlFor="bet-number">เลข</label><input id="bet-number" className="input large" inputMode="numeric" maxLength={digits || undefined} value={number} onChange={(event) => setNumber(event.target.value.replace(/\D/g, "").slice(0, digits || 12))} autoComplete="off" /><div className="number-keypad" role="group" aria-label="แป้นตัวเลขสำหรับกรอกเลข">{[1,2,3,4,5,6,7,8,9].map((key) => <button type="button" key={key} onClick={() => setNumber((value) => `${value}${key}`.slice(0, digits || 12))}>{key}</button>)}<button type="button" className="keypad-action" onClick={() => setNumber("")}>ล้าง</button><button type="button" onClick={() => setNumber((value) => `${value}0`.slice(0, digits || 12))}>0</button><button type="button" className="keypad-action keypad-delete" aria-label="ลบตัวเลขล่าสุด" onClick={() => setNumber((value) => value.slice(0, -1))}>⌫</button></div><div className="hint keypad-hint">แตะตัวเลขเพื่อกรอกได้ทันที หรือพิมพ์จากคีย์บอร์ดตามปกติ</div><div className="field-error">{error}</div></div>
          <div className="field"><label htmlFor="bet-amount">จำนวนเงินต่อรายการ (บาท)</label><input id="bet-amount" className="input" type="number" min={1} value={amount} onChange={(event) => setAmount(Number(event.target.value))} /><div className="amount-chips">{[20,50,100,500].map((value) => <button className={`chip-btn ${amount === value ? "active" : ""}`} key={value} type="button" onClick={() => setAmount(value)}>{value}</button>)}</div><button className="button secondary block apply-all-button" type="button" onClick={() => setLines((current) => current.map((line) => ({ ...line, stakeMinor: stakeMinorFor(amount) })))}>ใช้จำนวนนี้กับทุกเลข</button></div>
          <div className="field"><label>ตัวช่วย</label><div className="amount-chips helper-actions"><button className="chip-btn" type="button" onClick={() => runHelper("reverse")}>กลับเลข</button><button className="chip-btn" type="button" onClick={() => runHelper("permute")}>สลับเลข</button><button className="chip-btn" type="button" disabled={digits !== 2} onClick={() => runHelper("run-front")}>รูดหน้า</button><button className="chip-btn" type="button" disabled={digits !== 2} onClick={() => runHelper("run-back")}>รูดหลัง</button></div><div className="hint">{feedback}</div></div>
          <div className="field full bulk-entry"><label htmlFor="bet-bulk">เพิ่มหลายเลข</label><textarea id="bet-bulk" className="input bulk-input" rows={3} value={bulk} onChange={(event) => setBulk(event.target.value)} placeholder="วางเลขคั่นด้วยเว้นวรรค จุลภาค หรือขึ้นบรรทัดใหม่ เช่น 007 125 908" /><div className="bulk-entry-actions"><div className="hint">ระบบเก็บเลขศูนย์นำหน้า เช่น 007 และรวมเลขซ้ำให้เห็นเป็นรายการเดียว</div><button className="button secondary" type="button" onClick={addBulk}>เพิ่มหลายเลข</button></div></div>
          <div className="field full"><button className="button primary block" type="button" onClick={addSingle}>+ เพิ่มลงโพย</button></div>
        </div>
      </section>
      <section className="panel"><div className="panel-title"><h2>รายการของคุณ</h2><span className="status neutral">{lines.length} รายการ</span></div><div className="bet-lines">{lines.map((line, index) => <div className="bet-line" key={line.number}><div><span className="muted small">เลข</span><div className="bet-number">{line.number}</div>{line.mergedCount > 1 && <span className="merge-badge">รวม {line.mergedCount} รายการซ้ำ</span>}</div><div><span className="muted small">จำนวนเงิน</span><div><strong>{formatBaht(line.stakeMinor)}</strong></div></div><div><span className="muted small">อัตราจ่าย (งวดนี้)</span><div className="payout">{formatPayoutMultiplier(parseFixedPayout(selected?.payout)?.amountMinor ?? 0n)}</div></div><button className="button secondary" type="button" onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>ลบ</button></div>)}</div></section>
    </div>
    <aside className="stack"><section className="summary-box"><div className="summary-row"><span>ยอดรายการ</span><strong>{formatBaht(totalMinor)}</strong></div><div className="summary-row"><span>ประเภทที่เลือก</span><strong>{selected?.betTypeCode ?? "—"}</strong></div><div className="summary-row"><span>เงินสดที่ใช้ได้</span><strong>ตรวจตอนยืนยัน</strong></div><div className="summary-row"><span>โบนัสที่ใช้ได้กับงวดนี้</span><strong>ตรวจตอนยืนยัน</strong></div><div className="summary-row total"><span>ประมาณการยอดซื้อ</span><span>{formatBaht(totalMinor)}</span></div><button className={`button lime block ${lines.length && !quoting ? "" : "disabled"}`} type="button" disabled={!lines.length || quoting} onClick={createQuote} style={{ marginTop: 12 }}>{quoting ? "กำลังสร้าง Quote…" : "สร้าง Quote และตรวจรายการ →"}</button><p className="muted small" style={{ marginTop: 8 }}>ยอดเงินที่ใช้ได้และยอดโบนัสจริงจะถูกตรวจซ้ำโดยเซิร์ฟเวอร์ตอนยืนยันรายการ</p></section><section className="notice warning"><b>!</b><div><strong>เลขอั้นและข้อจำกัด</strong>ระบบจะตรวจ restriction และ exposure ล่าสุดตอนสร้าง Quote และตรวจซ้ำก่อนยืนยัน</div></section></aside>
    </section>
  </main>;
}
