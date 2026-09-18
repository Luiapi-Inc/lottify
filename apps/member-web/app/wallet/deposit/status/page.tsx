"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type Deposit, MemberApiFailure, memberApi } from "../../../lib/member-api";

export default function DepositStatusPage() {
  return <DepositStatusInner />;
}

function DepositStatusInner() {
  const [id, setId] = useState("");
  const [idReady, setIdReady] = useState(false);
  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get("id")?.trim() ?? "");
    setIdReady(true);
  }, []);
  const [deposit, setDeposit] = useState<Deposit | null>(null);
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshText, setRefreshText] = useState("ยังไม่ได้ตรวจซ้ำ");
  const refreshGenerationRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!id) return;
    const generation = ++refreshGenerationRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await memberApi.getDeposit(id);
      if (generation !== refreshGenerationRef.current) return;
      setDeposit(next);
      setRefreshText(new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch (requestError) {
      if (generation !== refreshGenerationRef.current) return;
      setError(toStatusError(requestError));
    } finally {
      if (generation === refreshGenerationRef.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!deposit || isFinalStatus(deposit.status)) return;
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => window.clearInterval(timer);
  }, [deposit, refresh]);

  const reconcile = useCallback(async () => {
    if (!id || !deposit || isFinalStatus(deposit.status)) return;
    setReconciling(true);
    setError(null);
    try {
      const next = await memberApi.reconcileDeposit(id);
      setDeposit(next);
      setRefreshText(new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch (requestError) {
      setError(toStatusError(requestError));
    } finally {
      setReconciling(false);
    }
  }, [deposit, id]);

  const copy = useMemo(() => deposit ? depositCopy(deposit) : null, [deposit]);

  return <main id="main" className="payment-status-page">
    <div className="breadcrumb"><Link href="/wallet">กระเป๋า</Link><span>/</span><Link href="/wallet/deposit">ฝากเงิน</Link><span>/</span><span>สถานะ</span></div>
    <section className="payment-status-shell">
      <div className="payment-status-grid">
        <section className="panel payment-status-main" aria-labelledby="status-title">
          {error && <div className="notice warning" role="alert"><b>!</b><div><strong>ไม่สามารถอ่านสถานะฝากเงินได้</strong>{error}</div></div>}
          {idReady && !id && <div className="notice warning" role="alert"><b>!</b><div><strong>ไม่พบเลขอ้างอิงรายการ</strong>ไม่พบเลขอ้างอิงรายการ กรุณาเปิดหน้านี้จากการยืนยันรายการเดิม</div></div>}
          {!deposit && !error && (!idReady || Boolean(id)) && <div className="notice info"><b>i</b><div><strong>กำลังอ่านสถานะรายการ</strong>ระบบกำลังโหลดสถานะฝากเงินล่าสุด</div></div>}
          {deposit && copy && <>
            <div className="payment-status-heading"><div><p className="payment-eyebrow">สถานะล่าสุดจากระบบ</p><h1 id="status-title">{copy.title}</h1><p className="muted">{copy.message}</p></div><span className={`payment-status-badge ${copy.badgeClass}`}>{copy.badge}</span></div>
            <div className="payment-reference-card"><div><span>เลขอ้างอิง</span><strong>{deposit.id}</strong></div><div><span>ยอดชำระ</span><strong>{formatBaht(deposit.amountMinor)} บาท</strong></div><div><span>ยอดเข้ากระเป๋า</span><strong>{deposit.status === "COMPLETED" ? `+${formatBaht(deposit.amountMinor)} บาท` : "ยังไม่เพิ่มยอด"}</strong></div></div>
            <div className={`payment-state-note ${copy.noteClass}`} role="status" aria-live="polite"><strong>{copy.noteTitle}</strong><span>{copy.note}</span></div>
            <ol className="payment-timeline" aria-label="ความคืบหน้ารายการฝากเงิน">{copy.steps.map(([tone, stepTitle, detail], index) => <li className={tone} key={`${deposit.status}-${index}`}><span className="payment-step-marker">{index + 1}</span><div><strong>{stepTitle}</strong><span>{detail}</span></div></li>)}</ol>
          </>}
          <div className="payment-refresh-row">
            <button className="button secondary payment-status-refresh" type="button" onClick={() => void refresh()} disabled={!id || loading}>{loading ? "กำลังอ่าน..." : "อ่านสถานะล่าสุด"}</button>
            {deposit && !isFinalStatus(deposit.status) ? <button className="button primary payment-status-refresh" type="button" onClick={() => void reconcile()} disabled={reconciling}>{reconciling ? "กำลัง reconcile…" : "ตรวจสอบกับผู้ให้บริการ"}</button> : null}
            <p>การอ่านสถานะไม่สร้างรายการใหม่ ส่วน reconcile จะตรวจรายการเดิมกับ provider และเครดิตได้เฉพาะผลที่พิสูจน์ว่า APPROVED</p>
          </div>
          <p className="payment-updated">ตรวจสถานะล่าสุด: <strong>{refreshText}</strong></p>
        </section>
        <aside className="stack payment-status-aside">
          <section className="summary-box"><div className="summary-row"><span>รายการ</span><strong>ฝากเงิน</strong></div><div className="summary-row"><span>ช่องทาง</span><strong>{deposit ? methodLabel(deposit.methodCode) : "-"}</strong></div><div className="summary-row"><span>ยอดชำระ</span><strong>{deposit ? `${formatBaht(deposit.amountMinor)} บาท` : "-"}</strong></div><div className="summary-row"><span>เลขอ้างอิง</span><strong>{id || "-"}</strong></div></section>
          <Link className="button secondary block" href="/wallet">กลับกระเป๋า</Link>
        </aside>
      </div>
    </section>
  </main>;
}

function depositCopy(deposit: Deposit) {
  if (deposit.status === "COMPLETED") return { badge: "ฝากเงินสำเร็จ", badgeClass: "is-completed", title: "ฝากเงินสำเร็จ", message: `การชำระเงินได้รับการยืนยันและยอด ${formatBaht(deposit.amountMinor)} บาทถูกบันทึกเข้ากระเป๋าแล้ว`, noteClass: "is-success", noteTitle: "เครดิตของรายการนี้แสดงเพียงครั้งเดียว", note: "หากระบบได้รับการยืนยันซ้ำ ยอดเงินของรายการนี้จะไม่ถูกเพิ่มซ้ำ", steps: [["done", "ยืนยันการชำระแล้ว", "ผลรายการได้รับการยืนยัน"], ["done", "บันทึกเครดิตเข้ากระเป๋าแล้ว", `+${formatBaht(deposit.amountMinor)} บาทสำหรับรายการอ้างอิงนี้`], ["done", "รายการเสร็จสมบูรณ์", "ติดตามย้อนหลังได้ด้วยเลขอ้างอิงเดิม"]] as const };
  if (deposit.status === "REVIEW_REQUIRED") return { badge: "กำลังตรวจสอบ", badgeClass: "is-review", title: "กำลังตรวจสอบรายการฝากเงิน", message: "พบข้อมูลที่ยังยืนยันไม่ได้ครบ รายการจึงยังไม่ถูกเพิ่มยอดอัตโนมัติ", noteClass: "is-warning", noteTitle: "เก็บเลขอ้างอิงนี้ไว้", note: "ไม่ต้องสร้างรายการใหม่ ระบบจะตรวจสอบรายการเดิมและอัปเดตเมื่อทราบผลที่ยืนยันได้", steps: [["done", "สร้างรายการฝากแล้ว", "เลขอ้างอิงยังคงเดิม"], ["current", "กำลังตรวจสอบ", "ยอดยังไม่ถูกเพิ่มเข้ากระเป๋าระหว่างตรวจสอบ"], ["future", "ยืนยันผลและบันทึกยอด", "จะเปลี่ยนเป็นสำเร็จหลังบันทึกเครดิตแล้วเท่านั้น"]] as const };
  if (deposit.status === "REJECTED") return { badge: "ฝากเงินไม่สำเร็จ", badgeClass: "is-review", title: "รายการฝากเงินไม่สำเร็จ", message: "รายการนี้ถูกปฏิเสธและยังไม่มีการเพิ่มยอดเข้ากระเป๋า", noteClass: "is-warning", noteTitle: "ยังไม่เพิ่มยอด", note: "หากต้องการฝากเงิน ให้สร้างรายการใหม่หลังตรวจสอบข้อมูลช่องทางและยอดชำระ", steps: [["done", "สร้างรายการฝากแล้ว", "เลขอ้างอิงนี้ถูกบันทึกไว้"], ["done", "ตรวจสอบผลแล้ว", "รายการไม่ผ่านเงื่อนไขการยืนยัน"], ["future", "ไม่บันทึกเครดิต", "ยอดของรายการนี้ไม่ถูกเพิ่มเข้ากระเป๋า"]] as const };
  return { badge: "กำลังดำเนินการ", badgeClass: "is-pending", title: "กำลังรอการยืนยันการชำระเงิน", message: "ยังไม่เพิ่มยอดเข้ากระเป๋าจนกว่าจะยืนยันการชำระและบันทึกเครดิตสำเร็จครบถ้วน", noteClass: "", noteTitle: "ยังไม่ถือว่าฝากเงินสำเร็จ", note: "สถานะ Pending จะอัปเดตรายการเดิมเมื่อผู้ให้บริการยืนยัน", steps: [["done", "สร้างรายการฝากแล้ว", "ใช้เลขอ้างอิงเดิมติดตามรายการนี้"], ["current", "รอการยืนยันการชำระ", "ยังไม่เพิ่มยอดเงินระหว่างรอผลที่ยืนยันได้"], ["future", "บันทึกยอดเข้ากระเป๋า", "จะแสดงสำเร็จเมื่อการยืนยันและเครดิตในกระเป๋าครบถ้วน"]] as const };
}

function isFinalStatus(status: Deposit["status"]): boolean {
  return status === "COMPLETED" || status === "REJECTED";
}

function formatBaht(minor: string): string {
  return ((Number.parseInt(minor, 10) || 0) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function methodLabel(code: string): string {
  return ({ promptpay: "PromptPay QR", "bank-transfer": "โอนผ่านธนาคาร" } as Record<string, string>)[code] ?? code;
}

function toStatusError(error: unknown): string {
  if (error instanceof MemberApiFailure) {
    if (error.code === "SESSION_REQUIRED") return "กรุณาเข้าสู่ระบบอีกครั้งก่อนตรวจสถานะ";
    if (error.code === "NOT_FOUND") return "ไม่พบรายการฝากเงินนี้";
    return "ไม่สามารถอ่านสถานะรายการฝากเงินได้ กรุณาลองอีกครั้ง";
  }
  return "ไม่สามารถอ่านสถานะรายการฝากเงินได้ กรุณาลองอีกครั้ง";
}
