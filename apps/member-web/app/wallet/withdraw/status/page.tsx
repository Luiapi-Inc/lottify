"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { type Withdrawal, MemberApiFailure, memberApi } from "../../../lib/member-api";

type StepTone = "done" | "current" | "future";

export default function WithdrawStatusPage() {
  return <WithdrawStatusInner />;
}

function WithdrawStatusInner() {
  const [id, setId] = useState("");
  useEffect(() => setId(new URLSearchParams(window.location.search).get("id") ?? ""), []);
  const [withdrawal, setWithdrawal] = useState<Withdrawal | null>(null);
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshText, setRefreshText] = useState("ยังไม่ได้ตรวจซ้ำ");

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const next = await memberApi.getWithdrawal(id);
      setWithdrawal(next);
      setRefreshText(nowLabel());
    } catch (requestError) {
      setError(toStatusError(requestError));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!withdrawal || isFinalState(withdrawal.state)) return;
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => window.clearInterval(timer);
  }, [refresh, withdrawal]);

  const copy = useMemo(() => withdrawal ? withdrawalCopy(withdrawal) : null, [withdrawal]);
  const canCancel = withdrawal ? hasMemberCancelAction(withdrawal.allowedActions) : false;

  const cancel = async () => {
    if (!withdrawal || !canCancel || cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      const next = await memberApi.cancelWithdrawal(withdrawal.id);
      setWithdrawal(next);
      setRefreshText(nowLabel());
    } catch (requestError) {
      setError(toCancelError(requestError));
    } finally {
      setCancelling(false);
    }
  };

  return <main id="main" className="payment-status-page">
    <div className="breadcrumb"><Link href="/wallet">กระเป๋า</Link><span>/</span><Link href="/wallet/withdraw">ถอนเงิน</Link><span>/</span><span>สถานะ</span></div>
    <section className="payment-status-shell">
      <div className="payment-status-grid">
        <section className="panel payment-status-main" aria-labelledby="status-title">
          {error && <div className="notice warning" role="alert"><b>!</b><div><strong>ไม่สามารถอ่านสถานะถอนเงินได้</strong>{error}</div></div>}
          {!withdrawal && !error && <div className="notice info"><b>i</b><div><strong>กำลังอ่านสถานะรายการ</strong>ระบบกำลังโหลดสถานะถอนเงินล่าสุด</div></div>}
          {withdrawal && copy && <>
            <div className="payment-status-heading"><div><p className="payment-eyebrow">สถานะล่าสุดจากระบบ</p><h1 id="status-title">{copy.title}</h1><p className="muted">{copy.message}</p></div><span className={`payment-status-badge ${copy.badgeClass}`}>{copy.badge}</span></div>
            <div className="payment-reference-card"><div><span>เลขอ้างอิง</span><strong>{withdrawal.id}</strong></div><div><span>ยอดถอน</span><strong>{formatBaht(withdrawal.amountMinor)} บาท</strong></div><div><span>ค่าธรรมเนียม</span><strong>{formatBaht(withdrawal.feeMinor)} บาท</strong></div></div>
            <div className={`payment-state-note ${copy.noteClass}`} role="status" aria-live="polite"><strong>{copy.noteTitle}</strong><span>{copy.note}</span></div>
            <ol className="payment-timeline" aria-label="ความคืบหน้ารายการถอนเงิน">{copy.steps.map(([tone, stepTitle, detail], index) => <li className={tone} key={`${withdrawal.state}-${index}`}><span className="payment-step-marker">{index + 1}</span><div><strong>{stepTitle}</strong><span>{detail}</span></div></li>)}</ol>
          </>}
          <div className="payment-refresh-row"><button className="button primary payment-status-refresh" type="button" onClick={() => void refresh()} disabled={!id || loading || cancelling}>{loading ? "กำลังตรวจ..." : "ตรวจสถานะล่าสุด"}</button><p>ระบบจะอ่านสถานะของรายการเดิมจาก API และไม่ส่งคำขอถอนใหม่</p></div>
          <p className="payment-updated">ตรวจสถานะล่าสุด: <strong>{refreshText}</strong></p>
        </section>
        <aside className="stack payment-status-aside">
          <section className="summary-box"><div className="summary-row"><span>รายการ</span><strong>ถอนเงิน</strong></div><div className="summary-row"><span>ยอดถอน</span><strong>{withdrawal ? `${formatBaht(withdrawal.amountMinor)} บาท` : "-"}</strong></div><div className="summary-row"><span>ค่าธรรมเนียม</span><strong>{withdrawal ? `${formatBaht(withdrawal.feeMinor)} บาท` : "-"}</strong></div><div className="summary-row"><span>เลขอ้างอิง</span><strong>{id || "-"}</strong></div></section>
          {canCancel && <button className="button secondary block" type="button" onClick={() => void cancel()} disabled={cancelling || loading}>{cancelling ? "กำลังยกเลิก..." : "ยกเลิกรายการถอนเงิน"}</button>}
          <Link className="button secondary block" href="/wallet">กลับกระเป๋า</Link>
        </aside>
      </div>
    </section>
  </main>;
}

function withdrawalCopy(withdrawal: Withdrawal): {
  badge: string;
  badgeClass: string;
  title: string;
  message: string;
  noteClass: string;
  noteTitle: string;
  note: string;
  steps: Array<[StepTone, string, string]>;
} {
  const amount = `${formatBaht(withdrawal.amountMinor)} บาท`;
  if (withdrawal.state === "COMPLETED") return { badge: "ถอนเงินสำเร็จ", badgeClass: "is-completed", title: "ถอนเงินสำเร็จ", message: "ผลการจ่ายเงินได้รับการยืนยันและการบันทึกยอดของรายการเสร็จสมบูรณ์แล้ว", noteClass: "is-success", noteTitle: "รายการปิดสมบูรณ์แล้ว", note: "เก็บเลขอ้างอิงไว้ใช้ตรวจสอบย้อนหลังหรือแจ้งฝ่ายช่วยเหลือ", steps: [["done", "ส่งคำขอและพักยอดแล้ว", amount], ["done", "ยืนยันผลการจ่ายเงินแล้ว", "มีผลที่ยืนยันได้สำหรับรายการนี้"], ["done", "บันทึกยอดเสร็จแล้ว", "การเปลี่ยนแปลงยอดของรายการเสร็จสมบูรณ์"], ["done", "ถอนเงินสำเร็จ", "รายการปิดด้วยเลขอ้างอิงเดิม"]] };
  if (withdrawal.state === "CANCELLED") return { badge: "ยกเลิกแล้ว", badgeClass: "is-review", title: "ยกเลิกรายการถอนเงินแล้ว", message: "คำขอถอนเงินรายการนี้ถูกยกเลิกแล้ว", noteClass: "is-success", noteTitle: "รายการนี้ไม่ถูกจ่ายออก", note: "การคืนยอดที่พักไว้เป็นผลจากสถานะที่ยืนยันแล้วของรายการเดิม", steps: [["done", "ส่งคำขอถอนแล้ว", amount], ["done", "รับคำขอยกเลิกแล้ว", "ระบบดำเนินการกับรายการเดิม"], ["done", "ยกเลิกรายการสำเร็จ", "รายการปิดโดยไม่มีการจ่ายเงินออก"]] };
  if (withdrawal.state === "REJECTED" || withdrawal.state === "FAILED") return { badge: "ถอนเงินไม่สำเร็จ", badgeClass: "is-review", title: "รายการถอนเงินไม่สำเร็จ", message: withdrawal.decisionReason || withdrawal.failureReason || "รายการนี้ไม่สามารถดำเนินการต่อได้", noteClass: "is-warning", noteTitle: "ตรวจสถานะรายการเดิมก่อนทำรายการใหม่", note: "ยอดที่พักไว้จะเปลี่ยนตามผลที่ระบบยืนยันและกระบวนการคืนยอดของรายการนี้", steps: [["done", "ส่งคำขอแล้ว", amount], ["done", "ตรวจสอบผลแล้ว", "รายการไม่สามารถดำเนินการต่อได้"], ["done", "ปิดรายการ", "ติดตามรายละเอียดด้วยเลขอ้างอิงเดิม"]] };
  if (withdrawal.state === "RECONCILING") return { badge: "กำลังตรวจสอบผล", badgeClass: "is-reconciling", title: "กำลังยืนยันผลรายการถอนเงิน", message: `ระบบยังยืนยันผลการจ่ายเงินไม่ได้ จึงคงยอด ${amount} ของรายการไว้ระหว่างตรวจสอบ`, noteClass: "is-warning", noteTitle: "ยอดยังคงพักไว้จนกว่าจะทราบผลแน่นอน", note: "ระบบจะไม่คืนยอดหรือสรุปว่าสำเร็จจากผลที่ยังไม่ชัดเจน", steps: [["done", "คำขออยู่ระหว่างดำเนินการ", "เลขอ้างอิงเดิมยังใช้ติดตามได้"], ["current", "กำลังตรวจสอบผลการจ่ายเงิน", "ผลยังไม่ชัดเจนและยอดยังคงพักไว้"], ["future", "ยืนยันผลที่ถูกต้อง", "จากนั้นจึงดำเนินการต่อหรือคืนยอดตามผลที่พิสูจน์ได้"], ["future", "บันทึกผลครั้งเดียว", "ไม่ทำรายการซ้ำระหว่างที่ผลยังไม่ชัดเจน"]] };
  if (withdrawal.state === "REVIEWING") return { badge: "กำลังตรวจสอบ", badgeClass: "is-review", title: "กำลังตรวจสอบคำขอถอนเงิน", message: `ยอด ${amount} ของรายการยังคงพักไว้ระหว่างตรวจสอบ และยังไม่ถือว่าถอนสำเร็จ`, noteClass: "is-warning", noteTitle: "ไม่ต้องส่งคำขอถอนซ้ำ", note: withdrawal.requiresApproval ? "รายการนี้ต้องได้รับการอนุมัติก่อนเข้าสู่ขั้นตอนจ่ายเงิน" : "ระบบกำลังตรวจเงื่อนไขของรายการเดิมก่อนดำเนินการต่อ", steps: [["done", "รับคำขอและพักยอดแล้ว", amount], ["current", "กำลังตรวจสอบ", "ยังไม่มีผลสำเร็จที่ยืนยันได้"], ["future", "ดำเนินการตามผลตรวจสอบ", "รายการเดิมจะดำเนินต่อโดยไม่สร้างคำขอใหม่"], ["future", "ปิดรายการเมื่อครบเงื่อนไข", "สำเร็จหลังการจ่ายเงินและบันทึกยอดครบเท่านั้น"]] };
  if (withdrawal.state === "CANCELLING") return { badge: "กำลังยกเลิก", badgeClass: "is-pending", title: "กำลังยกเลิกรายการถอนเงิน", message: "ระบบรับคำขอยกเลิกแล้วและกำลังดำเนินการกับยอดที่พักไว้", noteClass: "is-warning", noteTitle: "รอผลของรายการเดิม", note: "อย่าส่งคำขอถอนใหม่จนกว่าสถานะการยกเลิกจะยืนยันแล้ว", steps: [["done", "รับคำขอถอนแล้ว", amount], ["done", "รับคำขอยกเลิกแล้ว", "กำลังดำเนินการกับรายการเดิม"], ["current", "กำลังยกเลิก", "รอการยืนยันสถานะสุดท้าย"], ["future", "ปิดรายการ", "สถานะจะอัปเดตเมื่อการยกเลิกเสร็จสมบูรณ์"]] };
  if (withdrawal.state === "PAYOUT_CONFIRMED" || withdrawal.state === "FINALIZING") return { badge: "กำลังบันทึกผล", badgeClass: "is-pending", title: "ยืนยันการจ่ายเงินแล้ว กำลังปิดรายการ", message: "มีผลการจ่ายเงินที่ยืนยันได้แล้ว ระบบกำลังบันทึกผลทางการเงินให้ครบก่อนแสดงว่าสำเร็จ", noteClass: "", noteTitle: "ยังไม่ถือว่ารายการเสร็จสมบูรณ์", note: "สถานะจะเปลี่ยนเป็นสำเร็จหลังการบันทึกยอดของรายการครบถ้วนแล้ว", steps: [["done", "ส่งคำขอและพักยอดแล้ว", amount], ["done", "ยืนยันผลการจ่ายเงินแล้ว", "มีหลักฐานผลการจ่ายเงินของรายการ"], ["current", "กำลังบันทึกยอด", "รอการยืนยันผลทางการเงินขั้นสุดท้าย"], ["future", "ถอนเงินสำเร็จ", "รายการปิดเมื่อทุกขั้นตอนครบ"]] };
  return { badge: "กำลังดำเนินการ", badgeClass: "is-pending", title: "กำลังดำเนินการถอนเงิน", message: `คำขอถูกบันทึกแล้วและยอด ${amount} อยู่ระหว่างกระบวนการถอนเงิน`, noteClass: "", noteTitle: "ยังไม่ถือว่าถอนเงินสำเร็จ", note: "รายการจะสำเร็จเมื่อมีหลักฐานการจ่ายเงินและการบันทึกยอดเสร็จครบถ้วนแล้วเท่านั้น", steps: [["done", "ส่งคำขอแล้ว", amount], ["current", "กำลังดำเนินการ", stateLabel(withdrawal.state)], ["future", "ยืนยันผลการจ่ายเงิน", "ยังไม่สรุปว่าสำเร็จก่อนยืนยันผล"], ["future", "บันทึกยอดและปิดรายการ", "ต้องครบทั้งผลการจ่ายเงินและผลทางการเงิน"]] };
}

function hasMemberCancelAction(allowedActions: Withdrawal["allowedActions"]): boolean {
  const value: unknown = allowedActions;
  if (!value || typeof value !== "object") return false;
  const member = (value as Record<string, unknown>).member;
  return Array.isArray(member) && member.some((action) => action === "cancel");
}

function isFinalState(state: Withdrawal["state"]): boolean {
  return state === "COMPLETED" || state === "CANCELLED" || state === "REJECTED" || state === "FAILED";
}

function stateLabel(state: Withdrawal["state"]): string {
  const labels: Partial<Record<Withdrawal["state"], string>> = {
    REQUESTED: "ระบบรับคำขอแล้ว",
    RESERVING: "กำลังพักยอดสำหรับรายการ",
    APPROVED: "ผ่านการตรวจและรอเริ่มจ่ายเงิน",
    PAYOUT_PROCESSING: "กำลังดำเนินการจ่ายเงิน",
  };
  return labels[state] ?? "กำลังอัปเดตสถานะรายการ";
}

function formatBaht(minor: string): string {
  return ((Number.parseInt(minor, 10) || 0) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function nowLabel(): string {
  return new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function toStatusError(error: unknown): string {
  if (error instanceof MemberApiFailure) {
    if (error.code === "SESSION_REQUIRED") return "กรุณาเข้าสู่ระบบอีกครั้งก่อนตรวจสถานะ";
    if (error.code === "NOT_FOUND") return "ไม่พบรายการถอนเงินนี้";
    return "ไม่สามารถอ่านสถานะรายการถอนเงินได้ กรุณาลองอีกครั้ง";
  }
  return "ไม่สามารถอ่านสถานะรายการถอนเงินได้ กรุณาลองอีกครั้ง";
}

function toCancelError(error: unknown): string {
  if (error instanceof MemberApiFailure) {
    if (error.code === "SESSION_REQUIRED") return "กรุณาเข้าสู่ระบบอีกครั้งก่อนยกเลิกรายการ";
    if (error.code === "STATE_CONFLICT" || error.code === "VERSION_CONFLICT") return "สถานะรายการเปลี่ยนแล้วและไม่สามารถยกเลิกจากข้อมูลเดิมได้ กรุณาตรวจสถานะล่าสุด";
    if (error.code === "NOT_FOUND") return "ไม่พบรายการถอนเงินนี้";
    if (error.code === "IDEMPOTENCY_CONFLICT") return "คำขอยกเลิกไม่ตรงกับคำขอเดิม กรุณาตรวจสถานะล่าสุด";
    return "ไม่สามารถยกเลิกรายการถอนเงินได้ กรุณาตรวจสถานะล่าสุด";
  }
  return "ไม่สามารถยกเลิกรายการถอนเงินได้ กรุณาตรวจสถานะล่าสุด";
}
