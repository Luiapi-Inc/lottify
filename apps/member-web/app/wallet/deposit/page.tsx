"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { createIdempotencyKey, type DepositMethodDescription, type DepositMethodSummary, MemberApiFailure, memberApi } from "../../lib/member-api";

const amountChips = ["300", "500", "1000", "3000", "5000"];
const amountPattern = /^\d+(\.\d{1,2})?$/;

export default function DepositPage() {
  const router = useRouter();
  const [methods, setMethods] = useState<DepositMethodSummary[]>([]);
  const [methodCode, setMethodCode] = useState<string>("");
  const [description, setDescription] = useState<DepositMethodDescription | null>(null);
  const [amount, setAmount] = useState("1000");
  const [loadingMethods, setLoadingMethods] = useState(true);
  const [loadingDescription, setLoadingDescription] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const selectedMethod = useMemo(
    () => methods.find((item) => item.methodCode === methodCode) ?? null,
    [methodCode, methods],
  );
  const feeMinor = minorToNumber(description?.feeMinor);
  const amountMinor = bahtToMinor(amount);
  const amountError = amountValidationError(amount);
  const totalMinor = (amountMinor ?? 0) + feeMinor;
  const canSubmit = Boolean(selectedMethod && description && amountMinor !== null && amountMinor > 0 && !amountError && !loadingDescription && !submitting);

  useEffect(() => {
    let active = true;
    setLoadingMethods(true);
    memberApi.listDepositMethods()
      .then((items) => {
        if (!active) return;
        setMethods(items);
        setMethodCode((current) => current || items[0]?.methodCode || "");
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        setError(toDepositError(requestError));
      })
      .finally(() => {
        if (active) setLoadingMethods(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!methodCode) {
      setDescription(null);
      setLoadingDescription(false);
      return;
    }
    let active = true;
    setDescription(null);
    setLoadingDescription(true);
    setError(null);
    memberApi.describeDepositMethod(methodCode)
      .then((details) => {
        if (active) setDescription(details);
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        setDescription(null);
        setError(toDepositError(requestError));
      })
      .finally(() => {
        if (active) setLoadingDescription(false);
      });
    return () => {
      active = false;
    };
  }, [methodCode]);

  const confirm = async () => {
    if (!selectedMethod || !description || !canSubmit || amountMinor === null) return;
    setSubmitting(true);
    setError(null);
    const idempotencyKey = idempotencyKeyRef.current ?? createIdempotencyKey();
    idempotencyKeyRef.current = idempotencyKey;
    try {
      const deposit = await memberApi.createDeposit({
        providerCode: selectedMethod.providerCode,
        methodCode: selectedMethod.methodCode,
        amountMinor,
        currency: "THB",
      }, idempotencyKey);
      idempotencyKeyRef.current = null;
      router.push(`/wallet/deposit/status?id=${encodeURIComponent(deposit.id)}`);
    } catch (requestError) {
      if (isDefinitiveClientFailure(requestError)) idempotencyKeyRef.current = null;
      setError(toDepositError(requestError));
    } finally {
      setSubmitting(false);
    }
  };

  return <main id="main">
    <div className="breadcrumb"><Link href="/wallet">กระเป๋า</Link><span>/</span><span>ฝากเงิน</span></div>
    <div className="page-head"><div><h1>ฝากเงิน</h1><p>เลือกช่องทางและจำนวนเงิน ตรวจค่าธรรมเนียมก่อนยืนยัน แล้วติดตามสถานะรายการเดิมจนเสร็จ</p></div></div>
    <section className="grid-2"><div className="stack">
      <section className="panel"><div className="panel-title"><h2>1. เลือกช่องทาง</h2></div><div className="payment-methods">{loadingMethods ? <div className="notice info"><b>i</b><div><strong>กำลังโหลดช่องทางฝากเงิน</strong>กำลังอ่านช่องทางที่เปิดให้บริการล่าสุด</div></div> : methods.length === 0 ? <div className="notice warning"><b>!</b><div><strong>ยังไม่มีช่องทางฝากเงินที่เปิดให้บริการ</strong>กรุณาลองใหม่อีกครั้งภายหลัง</div></div> : methods.map((item) => <button className={`method ${methodCode === item.methodCode ? "active" : ""}`} type="button" key={`${item.providerCode}:${item.methodCode}`} onClick={() => { if (methodCode === item.methodCode) return; idempotencyKeyRef.current = null; setDescription(null); setLoadingDescription(true); setMethodCode(item.methodCode); }}><strong>{methodLabel(item.methodCode)}</strong><span>{item.providerCode} · {methodDescription(item.methodCode)}</span></button>)}</div></section>
      <section className="panel"><div className="panel-title"><h2>2. ระบุจำนวนเงิน</h2></div><div className="field"><label htmlFor="deposit-amount">จำนวนเงิน</label><input id="deposit-amount" className="input large" type="text" inputMode="decimal" value={amount} onChange={(event) => { if (event.target.value !== amount) idempotencyKeyRef.current = null; setAmount(event.target.value); }} />{amountError && <div className="hint">{amountError}</div>}<div className="amount-chips">{amountChips.map((value) => <button className={`chip-btn ${amount === value ? "active" : ""}`} type="button" key={value} onClick={() => { if (amount === value) return; idempotencyKeyRef.current = null; setAmount(value); }}>{Number.parseInt(value, 10).toLocaleString("th-TH")}</button>)}</div></div></section>
      {description && <section className="panel"><div className="panel-title"><h2>คำแนะนำการชำระเงิน</h2></div><div className="stack">{description.instructions.map((instruction) => <div className="notice info" key={instruction}><b>i</b><div>{instruction}</div></div>)}</div></section>}
      {error && <div className="notice warning" role="alert"><b>!</b><div><strong>ไม่สามารถทำรายการฝากเงินได้</strong>{error}</div></div>}
    </div><aside className="stack"><section className="summary-box"><div className="summary-row"><span>ช่องทาง</span><strong>{selectedMethod ? methodLabel(selectedMethod.methodCode) : "-"}</strong></div><div className="summary-row"><span>จำนวนฝาก</span><strong>{amountMinor === null ? "-" : `${formatBaht(amountMinor)} บาท`}</strong></div><div className="summary-row"><span>ค่าธรรมเนียม</span><strong>{loadingDescription ? "กำลังตรวจสอบ" : description ? `${formatBaht(feeMinor)} บาท` : "-"}</strong></div><div className="summary-row total"><span>ยอดชำระ</span><strong>{description && amountMinor !== null ? `${formatBaht(totalMinor)} บาท` : "-"}</strong></div><button className={`button lime block ${canSubmit ? "" : "disabled"}`} type="button" disabled={!canSubmit} aria-disabled={!canSubmit} onClick={confirm} style={{ marginTop: 12 }}>{submitting ? "กำลังสร้างรายการ..." : "ยืนยันและรับคำแนะนำ →"}</button></section><div className="notice info"><b>i</b><div><strong>อย่าสร้างรายการซ้ำหากยังรอตรวจสอบ</strong>สถานะ Pending จะอัปเดตรายการเดิมเมื่อผู้ให้บริการยืนยัน</div></div></aside></section>
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

function minorToNumber(value: string | undefined): number {
  return Number.parseInt(value ?? "0", 10) || 0;
}

function formatBaht(minor: number | string): string {
  const value = typeof minor === "string" ? minorToNumber(minor) : minor;
  return (value / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function methodLabel(code: string): string {
  const labels: Record<string, string> = {
    promptpay: "PromptPay QR",
    "bank-transfer": "โอนผ่านธนาคาร",
  };
  return labels[code] ?? code;
}

function methodDescription(code: string): string {
  return code === "promptpay" ? "สแกนด้วยแอปธนาคาร · ปกติ 1-2 นาที" : code === "bank-transfer" ? "บัญชีเฉพาะรายการ · ตรวจอัตโนมัติ" : "ช่องทางฝากเงินที่ระบบเปิดให้บริการ";
}

function toDepositError(error: unknown): string {
  if (error instanceof MemberApiFailure) {
    if (error.code === "SESSION_REQUIRED") return "กรุณาเข้าสู่ระบบอีกครั้งก่อนทำรายการ";
    if (error.code === "DEPOSIT_METHOD_NOT_FOUND") return "ช่องทางฝากเงินนี้ไม่พร้อมใช้งานแล้ว กรุณาเลือกช่องทางใหม่";
    if (error.code === "INVALID_DEPOSIT_REQUEST" || error.code === "INVALID") return "ข้อมูลฝากเงินไม่ถูกต้อง กรุณาตรวจจำนวนเงินและช่องทางอีกครั้ง";
    if (error.code === "IDEMPOTENCY_CONFLICT") return "คำขอนี้ไม่ตรงกับรายการเดิม กรุณาตรวจสอบสถานะก่อนสร้างรายการใหม่";
    if (error.code === "NOT_FOUND") return "ไม่พบรายการฝากเงินนี้";
    return "ไม่สามารถดำเนินการฝากเงินได้ กรุณาลองอีกครั้ง";
  }
  return "ไม่สามารถอ่านข้อมูลฝากเงินได้ กรุณาลองอีกครั้ง";
}

function isDefinitiveClientFailure(error: unknown): boolean {
  return error instanceof MemberApiFailure && error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 408;
}
