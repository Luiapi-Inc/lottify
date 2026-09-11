"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MemberApiFailure,
  createIdempotencyKey,
  memberApi,
  type CreateQuoteInput,
  type MemberDraw,
} from "../../lib/member-api";
import {
  digitLengthFromPattern,
  formatDateTime,
  formatMinor,
  formatPayout,
  formatRemaining,
  minorToBaht,
  productLabel,
  toMinor,
} from "../live-data";

type DrawBetType = MemberDraw["betTypes"][number];

type BetLine = {
  betTypeCode: string;
  canonicalNumber: string;
  stakeMinor: string;
  mergedCount: number;
  payout: unknown;
};

function permutations(value: string): string[] {
  const result = new Set<string>();
  const walk = (prefix: string, rest: string) => {
    if (!rest.length) {
      result.add(prefix);
      return;
    }
    [...rest].forEach((digit, index) => {
      walk(prefix + digit, rest.slice(0, index) + rest.slice(index + 1));
    });
  };
  walk("", value);
  return [...result];
}

function validNumber(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

function withinStakeRange(stakeMinor: string, betType: DrawBetType): boolean {
  if (!/^\d+$/.test(stakeMinor)) return false;
  const stake = BigInt(stakeMinor);
  return stake >= BigInt(betType.minStakeMinor) && stake <= BigInt(betType.maxStakeMinor);
}

export default function BetEditor({ drawId }: { drawId: string }) {
  const router = useRouter();
  const [draw, setDraw] = useState<MemberDraw | null>(null);
  const [betTypeCode, setBetTypeCode] = useState("");
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState(0);
  const [bulk, setBulk] = useState("");
  const [lines, setLines] = useState<BetLine[]>([]);
  const [feedback, setFeedback] = useState("รายการจะถูกรวมเลขซ้ำก่อนส่งให้ระบบสร้าง Quote");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(drawId));
  const [submitting, setSubmitting] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const quoteCommand = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!drawId) return;
    let active = true;
    setLoading(true);
    setError("");
    memberApi.getDraw(drawId)
      .then((loaded) => {
        if (!active) return;
        setDraw(loaded);
        setServerOffsetMs(new Date(loaded.serverNow).getTime() - Date.now());
        const first = loaded.betTypes[0];
        if (first) {
          setBetTypeCode(first.betTypeCode);
          setAmount(Math.max(0.01, minorToBaht(first.minStakeMinor)));
        }
      })
      .catch((caught) => {
        if (!active) return;
        if (caught instanceof MemberApiFailure && caught.code === "SESSION_REQUIRED") {
          router.replace("/login");
          return;
        }
        setError(caught instanceof Error ? caught.message : "โหลดข้อมูลงวดไม่สำเร็จ");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [drawId, router]);

  const selectedBetType = useMemo(
    () => draw?.betTypes.find((item) => item.betTypeCode === betTypeCode) ?? null,
    [betTypeCode, draw],
  );
  const digits = selectedBetType ? digitLengthFromPattern(selectedBetType.validationPattern) : null;
  const totalStakeMinor = useMemo(
    () => lines.reduce((sum, line) => sum + BigInt(line.stakeMinor), 0n).toString(),
    [lines],
  );
  const serverNow = draw ? new Date(clock + serverOffsetMs).toISOString() : "";
  const remaining = draw ? formatRemaining(draw.cutoffAt, serverNow) : "—";
  const open = draw?.state === "OPEN" && remaining !== "ปิดรับแล้ว";

  function validateStake(): string | null {
    if (!selectedBetType) return null;
    const stakeMinor = toMinor(amount);
    if (!stakeMinor || !withinStakeRange(stakeMinor, selectedBetType)) {
      setError(`จำนวนเงินต่อรายการต้องอยู่ระหว่าง ${formatMinor(selectedBetType.minStakeMinor)} และ ${formatMinor(selectedBetType.maxStakeMinor)} บาท`);
      return null;
    }
    return stakeMinor;
  }

  function addNumbers(numbers: string[]) {
    if (!selectedBetType) return;
    const stakeMinor = validateStake();
    if (!stakeMinor) return;
    const invalid = numbers.filter((item) => !validNumber(selectedBetType.validationPattern, item));
    const valid = numbers.filter((item) => validNumber(selectedBetType.validationPattern, item));
    if (!valid.length) {
      setError(`รูปแบบเลขไม่ตรงกับ ${selectedBetType.betTypeCode}`);
      return;
    }

    let rejectedForLimit = 0;
    let merged = 0;
    setLines((current) => {
      const next = current.map((line) => ({ ...line }));
      for (const item of valid) {
        const existing = next.find(
          (line) => line.betTypeCode === selectedBetType.betTypeCode && line.canonicalNumber === item,
        );
        if (existing) {
          const combined = BigInt(existing.stakeMinor) + BigInt(stakeMinor);
          if (combined > BigInt(selectedBetType.maxStakeMinor)) {
            rejectedForLimit += 1;
            continue;
          }
          existing.stakeMinor = combined.toString();
          existing.mergedCount += 1;
          merged += 1;
        } else {
          next.push({
            betTypeCode: selectedBetType.betTypeCode,
            canonicalNumber: item,
            stakeMinor,
            mergedCount: 1,
            payout: selectedBetType.payout,
          });
        }
      }
      return next;
    });

    const messages = [`เพิ่ม ${valid.length - rejectedForLimit} รายการ`];
    if (merged) messages.push(`รวมเลขซ้ำ ${merged} รายการ`);
    if (invalid.length) messages.push(`ข้ามรูปแบบไม่ถูกต้อง ${invalid.length} รายการ`);
    if (rejectedForLimit) messages.push(`ข้ามเกินวงเงิน ${rejectedForLimit} รายการ`);
    setFeedback(messages.join(" · "));
    setError("");
  }

  function addSingle() {
    if (!selectedBetType) return;
    if (!validNumber(selectedBetType.validationPattern, number)) {
      setError(`กรอกเลขให้ตรงรูปแบบ ${selectedBetType.canonicalNumberFormat}`);
      return;
    }
    addNumbers([number]);
    setNumber("");
  }

  function runHelper(action: "reverse" | "permute" | "run-front" | "run-back") {
    if (!selectedBetType) return;
    let generated: string[] = [];
    if (action === "reverse" || action === "permute") {
      if (!validNumber(selectedBetType.validationPattern, number)) {
        setError(`กรอกเลขให้ตรงรูปแบบ ${selectedBetType.canonicalNumberFormat} ก่อนใช้ตัวช่วย`);
        return;
      }
      generated = action === "reverse" ? [number.split("").reverse().join("")] : permutations(number);
    } else {
      if (digits !== 2) {
        setError("รูดหน้า/รูดหลังใช้ได้เมื่อรูปแบบของประเภทนี้เป็นเลข 2 หลัก");
        return;
      }
      if (!/^\d$/.test(number)) {
        setError("กรอก 1 หลักก่อนใช้รูดหน้า/รูดหลัง");
        return;
      }
      generated = Array.from({ length: 10 }, (_, index) =>
        action === "run-front" ? `${number}${index}` : `${index}${number}`,
      );
    }
    addNumbers([...new Set(generated)]);
  }

  function addBulk() {
    if (!selectedBetType) return;
    const tokens = bulk.split(/[\s,]+/).map((token) => token.trim()).filter(Boolean);
    if (!tokens.length) {
      setError("กรอกเลขอย่างน้อย 1 รายการ");
      return;
    }
    addNumbers(tokens);
    setBulk("");
  }

  async function createQuote() {
    if (!draw || !open || !lines.length || submitting) return;
    const body: CreateQuoteInput = {
      currency: "THB",
      lines: lines.map((line) => ({
        betTypeCode: line.betTypeCode,
        canonicalNumber: line.canonicalNumber,
        stakeMinor: line.stakeMinor,
      })),
    };
    const fingerprint = JSON.stringify(body);
    if (!quoteCommand.current || quoteCommand.current.fingerprint !== fingerprint) {
      quoteCommand.current = { fingerprint, key: createIdempotencyKey() };
    }
    setSubmitting(true);
    setError("");
    try {
      const quote = await memberApi.createQuote(draw.id, body, quoteCommand.current.key);
      router.push(`/buy/quote?quoteId=${encodeURIComponent(quote.id)}`);
    } catch (caught) {
      if (caught instanceof MemberApiFailure && caught.code === "SESSION_REQUIRED") {
        router.replace("/login");
        return;
      }
      setError(caught instanceof Error ? caught.message : "สร้าง Quote ไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }

  if (!drawId) {
    return <main id="main"><section className="panel"><h1>ไม่พบงวดที่เลือก</h1><p>กลับไปเลือกงวดที่ยังเปิดรับก่อนเริ่มกรอกเลข</p><Link className="button primary" href="/buy">เลือกงวด</Link></section></main>;
  }

  if (loading) {
    return <main id="main"><section className="panel"><p role="status">กำลังโหลดข้อมูลงวด…</p></section></main>;
  }

  if (!draw) {
    return <main id="main"><section className="panel"><h1>เปิดงวดนี้ไม่ได้</h1>{error && <p role="alert">{error}</p>}<Link className="button primary" href="/buy">กลับไปเลือกงวด</Link></section></main>;
  }

  const maxDigits = digits ?? 64;
  const quickAmounts = [20, 50, 100, 500].filter((value) => {
    const minor = toMinor(value);
    return selectedBetType && minor ? withinStakeRange(minor, selectedBetType) : false;
  });

  return <main id="main">
    <div className="breadcrumb"><Link href="/">หน้าแรก</Link><span>/</span><Link href="/buy">ซื้อหวย</Link><span>/</span><span>ใส่เลข</span></div>
    <div className="page-head"><div><h1>{productLabel(draw.productId)} · งวด {draw.localDate}</h1><p>เลือกประเภท ใส่เลขและจำนวนเงิน ระบบจะรวมรายการที่ซ้ำกันก่อนสร้าง Quote</p></div><div className="countdown"><small>ปิดรับใน</small><span>{remaining}</span></div></div>
    <div className="stepper"><div className="step done"><strong>1 · เลือกงวด</strong>เลือกแล้ว</div><div className="step active"><strong>2 · ใส่เลข</strong>กำลังกรอก</div><div className="step"><strong>3 · ตรวจ Quote</strong>รอสร้าง</div><div className="step"><strong>4 · ยืนยัน</strong>รับใบรับรายการ</div></div>

    {!open && <div className="notice warning" role="alert"><b>!</b><div><strong>งวดนี้ไม่เปิดรับแล้ว</strong>สถานะปัจจุบัน {draw.state} · cutoff {formatDateTime(draw.cutoffAt, draw.timezone)}</div></div>}
    {error && <div className="notice warning" role="alert"><b>!</b><div><strong>ดำเนินการไม่ได้</strong>{error}</div></div>}

    <section className="grid-2"><div className="stack">
      <section className="panel"><div className="panel-title"><h2>เพิ่มรายการ</h2><span className={`status ${open ? "success" : "neutral"}`}>{open ? "เปิดรับ" : draw.state}</span></div>
        {draw.betTypes.length ? <div className="form-grid">
          <div className="field"><label htmlFor="bet-type">ประเภท</label><select id="bet-type" className="select" value={betTypeCode} onChange={(event) => { const next = draw.betTypes.find((item) => item.betTypeCode === event.target.value); setBetTypeCode(event.target.value); setNumber(""); setError(""); if (next) setAmount(Math.max(0.01, minorToBaht(next.minStakeMinor))); }} disabled={!open}>{draw.betTypes.map((item) => <option key={item.betTypeId} value={item.betTypeCode}>{item.betTypeCode} · {formatPayout(item.payout)}</option>)}</select>{selectedBetType && <div className="hint">รูปแบบ {selectedBetType.canonicalNumberFormat} · ขั้นต่ำ {formatMinor(selectedBetType.minStakeMinor)} บาท · สูงสุด {formatMinor(selectedBetType.maxStakeMinor)} บาท</div>}</div>
          <div className="field number-entry"><label htmlFor="bet-number">เลข</label><input id="bet-number" className="input large" inputMode="numeric" maxLength={maxDigits} value={number} onChange={(event) => setNumber(event.target.value.replace(/\D/g, "").slice(0, maxDigits))} autoComplete="off" disabled={!open} /><div className="number-keypad" aria-label="แป้นตัวเลขสำหรับกรอกเลข">{[1,2,3,4,5,6,7,8,9].map((key) => <button type="button" key={key} disabled={!open} onClick={() => setNumber((value) => `${value}${key}`.slice(0, maxDigits))}>{key}</button>)}<button type="button" className="keypad-action" disabled={!open} onClick={() => setNumber("")}>ล้าง</button><button type="button" disabled={!open} onClick={() => setNumber((value) => `${value}0`.slice(0, maxDigits))}>0</button><button type="button" className="keypad-action keypad-delete" aria-label="ลบตัวเลขล่าสุด" disabled={!open} onClick={() => setNumber((value) => value.slice(0, -1))}>⌫</button></div><div className="hint keypad-hint">ตรวจรูปแบบด้วยกฎของ Bet Type ที่งวดนี้บันทึกไว้</div></div>
          <div className="field"><label htmlFor="bet-amount">จำนวนเงินต่อรายการ (บาท)</label><input id="bet-amount" className="input" type="number" min={selectedBetType ? minorToBaht(selectedBetType.minStakeMinor) : undefined} max={selectedBetType ? minorToBaht(selectedBetType.maxStakeMinor) : undefined} step="0.01" value={amount} onChange={(event) => setAmount(Number(event.target.value))} disabled={!open} /><div className="amount-chips">{quickAmounts.map((value) => <button className={`chip-btn ${amount === value ? "active" : ""}`} key={value} type="button" disabled={!open} onClick={() => setAmount(value)}>{value}</button>)}</div></div>
          <div className="field"><label>ตัวช่วย</label><div className="amount-chips helper-actions"><button className="chip-btn" type="button" disabled={!open} onClick={() => runHelper("reverse")}>กลับเลข</button><button className="chip-btn" type="button" disabled={!open} onClick={() => runHelper("permute")}>สลับเลข</button><button className="chip-btn" type="button" disabled={!open || digits !== 2} onClick={() => runHelper("run-front")}>รูดหน้า</button><button className="chip-btn" type="button" disabled={!open || digits !== 2} onClick={() => runHelper("run-back")}>รูดหลัง</button></div><div className="hint">{feedback}</div></div>
          <div className="field full bulk-entry"><label htmlFor="bet-bulk">เพิ่มหลายเลข</label><textarea id="bet-bulk" className="input bulk-input" rows={3} value={bulk} onChange={(event) => setBulk(event.target.value)} disabled={!open} placeholder="วางเลขคั่นด้วยเว้นวรรค จุลภาค หรือขึ้นบรรทัดใหม่" /><div className="bulk-entry-actions"><div className="hint">เลขศูนย์นำหน้าจะถูกเก็บไว้ และรายการซ้ำจะถูกรวมยอด</div><button className="button secondary" type="button" disabled={!open} onClick={addBulk}>เพิ่มหลายเลข</button></div></div>
          <div className="field full"><button className="button primary block" type="button" disabled={!open} onClick={addSingle}>+ เพิ่มลงโพย</button></div>
        </div> : <div className="notice warning"><b>!</b><div><strong>งวดนี้ไม่มี Bet Type ที่ใช้งานได้</strong>ยังไม่สามารถสร้าง Quote สำหรับงวดนี้ได้</div></div>}
      </section>
      <section className="panel"><div className="panel-title"><h2>รายการของคุณ</h2><span className="status neutral">{lines.length} รายการ</span></div><div className="bet-lines">{lines.length ? lines.map((line, index) => <div className="bet-line" key={`${line.betTypeCode}:${line.canonicalNumber}`}><div><span className="muted small">{line.betTypeCode}</span><div className="bet-number">{line.canonicalNumber}</div>{line.mergedCount > 1 && <span className="merge-badge">รวม {line.mergedCount} รายการซ้ำ</span>}</div><div><span className="muted small">จำนวนเงิน</span><div><strong>{formatMinor(line.stakeMinor)} บาท</strong></div></div><div><span className="muted small">อัตราจ่ายปัจจุบัน</span><div className="payout">{formatPayout(line.payout)}</div></div><button className="button secondary" type="button" onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>ลบ</button></div>) : <p className="muted">ยังไม่มีรายการ</p>}</div></section>
    </div>
    <aside className="stack"><section className="summary-box"><div className="summary-row"><span>จำนวนรายการ</span><strong>{lines.length}</strong></div><div className="summary-row total"><span>ยอดซื้อรวม</span><span>{formatMinor(totalStakeMinor)} บาท</span></div><button className={`button lime block ${lines.length && open ? "" : "disabled"}`} type="button" disabled={!lines.length || !open || submitting} onClick={() => void createQuote()} style={{ marginTop: 12 }}>{submitting ? "กำลังสร้าง Quote…" : "สร้าง Quote และตรวจรายการ →"}</button></section><section className="notice warning"><b>!</b><div><strong>เลขอั้น วงเงิน และ payout จะยืนยันที่ Quote</strong>ระบบตรวจ restriction, exposure และกฎล่าสุดบน server ก่อนส่งข้อเสนอให้ยืนยัน</div></section></aside>
    </section>
  </main>;
}
