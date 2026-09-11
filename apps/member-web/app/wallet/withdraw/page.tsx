"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { createIdempotencyKey, type PayoutDestination, type WithdrawalPreflight, MemberApiFailure, memberApi } from "../../lib/member-api";

const amountChips = ["500", "1000", "3000", "5000"];
const amountPattern = /^\d+(\.\d{1,2})?$/;

export default function WithdrawPage() {
  const router = useRouter();
  const [amount, setAmount] = useState("3000");
  const [destinations, setDestinations] = useState<PayoutDestination[]>([]);
  const [destinationId, setDestinationId] = useState("");
  const [preflight, setPreflight] = useState<WithdrawalPreflight | null>(null);
  const [loadingDestinations, setLoadingDestinations] = useState(true);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const selectedDestination = useMemo(
    () => destinations.find((item) => item.id === destinationId) ?? null,
    [destinationId, destinations],
  );
  const amountMinor = bahtToMinor(amount);
  const amountError = amountValidationError(amount);
  const canSubmit = Boolean(selectedDestination && preflight?.outcome !== "DENY" && preflight?.balanceReady && preflight?.minValid && preflight?.maxValid && amountMinor !== null && amountMinor > 0 && !amountError && !checking && !submitting);

  useEffect(() => {
    let active = true;
    setLoadingDestinations(true);
    memberApi.listPayoutDestinations()
      .then(({ items }) => {
        if (!active) return;
        setDestinations(items);
        const verified = items.find((item) => item.status === "VERIFIED") ?? items[0];
        setDestinationId(verified?.id ?? "");
      })
      .catch((requestError: unknown) => {
        if (active) setError(toWithdrawError(requestError));
      })
      .finally(() => {
        if (active) setLoadingDestinations(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!destinationId || amountMinor === null || amountMinor <= 0) {
      setPreflight(null);
      setChecking(false);
      return;
    }
    let active = true;
    setPreflight(null);
    setChecking(true);
    const timer = window.setTimeout(() => {
      setError(null);
      memberApi.preflightWithdrawal({ payoutDestinationId: destinationId, amountMinor, currency: "THB" })
        .then((decision) => {
          if (active) setPreflight(decision);
        })
        .catch((requestError: unknown) => {
          if (active) setError(toWithdrawError(requestError));
        })
        .finally(() => {
          if (active) setChecking(false);
        });
    }, 400);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [amountMinor, destinationId]);

  const confirm = async () => {
    if (!selectedDestination || !canSubmit || amountMinor === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        payoutDestinationId: selectedDestination.id,
        amountMinor,
        currency: "THB" as const,
      };
      const latestPreflight = await memberApi.preflightWithdrawal(body);
      setPreflight(latestPreflight);
      if (!isPreflightSubmittable(latestPreflight)) return;
      const idempotencyKey = idempotencyKeyRef.current ?? createIdempotencyKey();
      idempotencyKeyRef.current = idempotencyKey;
      const withdrawal = await memberApi.createWithdrawal(body, idempotencyKey);
      idempotencyKeyRef.current = null;
      router.push(`/wallet/withdraw/status?id=${encodeURIComponent(withdrawal.id)}`);
    } catch (requestError) {
      if (isDefinitiveClientFailure(requestError)) idempotencyKeyRef.current = null;
      setError(toWithdrawError(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  return <main id="main">
    <div className="breadcrumb"><Link href="/wallet">กระเป๋า</Link><span>/</span><span>ถอนเงิน</span></div>
    <div className="page-head"><div><h1>ถอนเงิน</h1><p>ตรวจยอดเงินสดที่ถอนได้ ปลายทาง ค่าธรรมเนียม และเงื่อนไขการยืนยันตัวตนก่อนส่งคำขอ</p></div></div>
    <section className="grid-2"><div className="stack">
      <section className="panel"><div className="panel-title"><h2>ปลายทางรับเงิน</h2><Link href="/account/bank-account">จัดการบัญชีธนาคาร →</Link></div>{loadingDestinations ? <div className="notice info"><b>i</b><div><strong>กำลังโหลดปลายทางรับเงิน</strong>กำลังอ่านบัญชีรับเงินที่ผูกไว้กับสมาชิก</div></div> : destinations.length === 0 ? <div className="notice warning"><b>!</b><div><strong>ยังไม่มีบัญชีรับเงิน</strong>เพิ่มและยืนยันบัญชีธนาคารก่อนถอนเงิน</div></div> : <div className="payment-methods">{destinations.map((item) => <button className={`method ${destinationId === item.id ? "active" : ""}`} type="button" key={item.id} onClick={() => { if (destinationId === item.id) return; idempotencyKeyRef.current = null; setDestinationId(item.id); }}><strong>{bankLabel(item.bankCode)} · {item.accountNumberMasked}</strong><span>ชื่อบัญชี: {item.accountHolderName} · {destinationStatus(item.status)}</span></button>)}</div>}</section>
      <section className="panel"><div className="panel-title"><h2>จำนวนเงินที่ต้องการถอน</h2></div><div className="field"><label htmlFor="withdraw-amount">จำนวนเงิน</label><input id="withdraw-amount" className="input large" type="text" inputMode="decimal" value={amount} onChange={(event) => { if (event.target.value !== amount) idempotencyKeyRef.current = null; setAmount(event.target.value); }} />{amountError && <div className="hint">{amountError}</div>}<div className="amount-chips">{amountChips.map((value) => <button className={`chip-btn ${amount === value ? "active" : ""}`} type="button" key={value} onClick={() => { if (amount === value) return; idempotencyKeyRef.current = null; setAmount(value); }}>{Number.parseInt(value, 10).toLocaleString("th-TH")}</button>)}</div><div className="hint">ยอดเงินสดที่ถอนออกได้ {preflight ? `${formatBaht(preflight.availableMinor)} บาท` : checking ? "กำลังตรวจสอบ" : "-"} · โบนัสไม่รวมในยอดที่ถอนได้</div></div></section>
      {preflight && preflight.outcome !== "ALLOW" && <div className="notice warning"><b>!</b><div><strong>{preflight.outcome === "REVIEW_REQUIRED" ? "รายการนี้อาจต้องตรวจสอบเพิ่มเติม" : "ยังไม่สามารถถอนเงินจำนวนนี้ได้"}</strong>{preflight.reasonCodes.map(reasonCopy).join(" · ")}</div></div>}
      {error && <div className="notice warning" role="alert"><b>!</b><div><strong>ไม่สามารถทำรายการถอนได้</strong>{error}</div></div>}
    </div><aside className="stack"><section className="summary-box"><div className="summary-row"><span>ยอดถอน</span><strong>{amountMinor === null ? "-" : `${formatBaht(amountMinor)} บาท`}</strong></div><div className="summary-row"><span>ค่าธรรมเนียม</span><strong>ระบบจะยืนยันหลังรับคำขอ</strong></div><div className="summary-row"><span>ปลายทาง</span><strong>{selectedDestination ? `${bankLabel(selectedDestination.bankCode)} ${selectedDestination.accountNumberMasked}` : "-"}</strong></div><div className="summary-row total"><span>สถานะตรวจเงื่อนไข</span><strong>{checking ? "กำลังตรวจสอบ" : preflight ? outcomeLabel(preflight.outcome) : "-"}</strong></div><button className={`button lime block ${canSubmit ? "" : "disabled"}`} type="button" disabled={!canSubmit} aria-disabled={!canSubmit} onClick={confirm} style={{ marginTop: 12 }}>{submitting ? "กำลังส่งคำขอ..." : "ตรวจเงื่อนไขและยืนยัน →"}</button></section><div className="notice info"><b>i</b><div><strong>หลังยืนยัน ยอดจะถูกพักไว้</strong>หากผู้ให้บริการมีผลไม่ชัดเจน ระบบจะคงยอดพักไว้ระหว่างตรวจสอบและไม่คืนเงินอัตโนมัติจนทราบผลแน่นอน</div></div></aside></section>
  </main>;
}

function bahtToMinor(value: string): number | null {
  if (!amountPattern.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number.parseInt(whole ?? "0", 10) * 100 + Number.parseInt(fraction.padEnd(2, "0"), 10);
}

function amountValidationError(value: string): string | null {
  if (!value) return "กรุณาระบุจำนวนเงิน";
  if (!amountPattern.test(value)) return "จำนวนเงินต้องเป็นตัวเลขและมีทศนิยมไม่เกิน 2 ตำแหน่ง";
  return null;
}

function minorToNumber(value: string): number {
  return Number.parseInt(value, 10) || 0;
}

function formatBaht(minor: number | string): string {
  const value = typeof minor === "string" ? minorToNumber(minor) : minor;
  return (value / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function bankLabel(code: string): string {
  return ({ KBANK: "ธนาคารกสิกรไทย", SCB: "ธนาคารไทยพาณิชย์", BBL: "ธนาคารกรุงเทพ", KTB: "ธนาคารกรุงไทย" } as Record<string, string>)[code] ?? code;
}

function destinationStatus(status: PayoutDestination["status"]): string {
  if (status === "VERIFIED") return "ยืนยันแล้ว";
  if (status === "REJECTED") return "ไม่ผ่านการยืนยัน";
  return "รอยืนยัน";
}

function outcomeLabel(outcome: WithdrawalPreflight["outcome"]): string {
  if (outcome === "ALLOW") return "ถอนได้";
  if (outcome === "REVIEW_REQUIRED") return "ต้องตรวจสอบ";
  return "ถอนไม่ได้";
}

function isPreflightSubmittable(preflight: WithdrawalPreflight): boolean {
  return preflight.outcome !== "DENY" && preflight.balanceReady && preflight.minValid && preflight.maxValid;
}

function reasonCopy(code: string): string {
  const copy: Record<string, string> = {
    INSUFFICIENT_FUNDS: "ยอดเงินสดที่ถอนได้ไม่พอ",
    BELOW_MINIMUM: "จำนวนเงินต่ำกว่าขั้นต่ำ",
    ABOVE_MAXIMUM: "จำนวนเงินเกินเพดานที่ถอนได้",
    KYC_REQUIRED: "ต้องยืนยันตัวตนก่อนถอนเงิน",
    KYC_REVIEW_REQUIRED: "การยืนยันตัวตนอยู่ระหว่างตรวจสอบ",
    KYC_MORE_INFO_REQUIRED: "ต้องเพิ่มข้อมูลยืนยันตัวตนก่อนถอนเงิน",
    KYC_REJECTED: "การยืนยันตัวตนไม่ผ่านเงื่อนไขสำหรับการถอนเงิน",
    KYC_EXPIRED: "ข้อมูลยืนยันตัวตนหมดอายุ กรุณายืนยันใหม่",
    TERMS_NOT_ACCEPTED: "ต้องยอมรับข้อกำหนดให้ครบก่อน",
    PROFILE_INCOMPLETE: "ต้องกรอกข้อมูลบัญชีให้ครบก่อน",
    PAYOUT_DESTINATION_UNAVAILABLE: "บัญชีรับเงินนี้ไม่พร้อมใช้งาน",
    PAYOUT_DESTINATION_NOT_VERIFIED: "บัญชีรับเงินยังไม่ผ่านการยืนยัน",
    CAPABILITY_RESTRICTION: "บัญชีนี้มีข้อจำกัดการถอนเงิน",
    WITHDRAWAL_BLOCKED: "บัญชีนี้ถูกจำกัดการถอนเงิน",
    REVIEW_REQUIRED: "รายการต้องได้รับการตรวจสอบเพิ่มเติม",
    APPROVAL_THRESHOLD: "จำนวนเงินนี้ต้องได้รับการอนุมัติเพิ่มเติม",
    ELIGIBLE: "ผ่านเงื่อนไขการถอนเงิน",
  };
  return copy[code] ?? code;
}

function toWithdrawError(error: unknown): string {
  if (error instanceof MemberApiFailure) {
    if (error.code === "SESSION_REQUIRED") return "กรุณาเข้าสู่ระบบอีกครั้งก่อนทำรายการ";
    if (error.code === "INVALID_WITHDRAWAL_REQUEST" || error.code === "INVALID") return "ข้อมูลถอนเงินไม่ถูกต้อง กรุณาตรวจจำนวนเงินและปลายทางอีกครั้ง";
    if (error.code === "INSUFFICIENT_FUNDS") return "ยอดเงินสดที่ถอนได้ไม่เพียงพอสำหรับจำนวนนี้";
    if (error.code === "PAYOUT_DESTINATION_NOT_ELIGIBLE") return "บัญชีรับเงินนี้ไม่ผ่านเงื่อนไขสำหรับการถอนเงิน";
    if (error.code === "WITHDRAWAL_BLOCKED") return "บัญชีนี้ยังไม่สามารถถอนเงินได้ตามเงื่อนไขปัจจุบัน";
    if (error.code === "IDEMPOTENCY_CONFLICT") return "คำขอนี้ไม่ตรงกับรายการเดิม กรุณาตรวจสอบสถานะก่อนส่งใหม่";
    if (error.code === "STATE_CONFLICT" || error.code === "VERSION_CONFLICT") return "สถานะรายการเปลี่ยนแล้ว กรุณาตรวจข้อมูลล่าสุดก่อนดำเนินการต่อ";
    if (error.code === "NOT_FOUND") return "ไม่พบรายการถอนเงินนี้";
    return "ไม่สามารถดำเนินการถอนเงินได้ กรุณาลองอีกครั้ง";
  }
  return "ไม่สามารถตรวจเงื่อนไขถอนเงินได้ กรุณาลองอีกครั้ง";
}

function isDefinitiveClientFailure(error: unknown): boolean {
  return error instanceof MemberApiFailure && error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 408;
}
