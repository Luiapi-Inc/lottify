"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { memberApi, type PayoutDestination } from "../../lib/member-api";
import { describeFailureCode, describeMemberApiFailure, formatDateTime } from "../../lib/member-display";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; destinations: PayoutDestination[] }
  | { status: "failed"; message: string; code: string; correlationId?: string };

type ActionState =
  | { status: "idle" }
  | { status: "working"; label: string }
  | { status: "failed"; code: string; message: string; correlationId?: string };

type Draft = { type: string; bankCode: string; accountNumber: string; accountHolderName: string };

const DESTINATION_TYPES = ["BANK_ACCOUNT"] as const;
const emptyDraft: Draft = { type: DESTINATION_TYPES[0], bankCode: "", accountNumber: "", accountHolderName: "" };

/** Destination status -> Member-facing label; unknown statuses are shown raw. */
function describeDestinationStatus(status: string): { label: string; tone: "success" | "warning" | "danger" } {
  if (status === "VERIFIED") return { label: "ยืนยันแล้ว", tone: "success" };
  if (status === "PENDING") return { label: "รอการตรวจสอบ", tone: "warning" };
  if (status === "REJECTED") return { label: "ไม่ผ่านการตรวจสอบ", tone: "danger" };
  return { label: status, tone: "warning" };
}

export default function BankAccountPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [formOpen, setFormOpen] = useState(false);
  const [action, setAction] = useState<ActionState>({ status: "idle" });

  const load = useCallback(async (): Promise<PayoutDestination[]> => {
    const list = await memberApi.listPayoutDestinations();
    return [...list.items];
  }, []);

  useEffect(() => {
    let active = true;
    load()
      .then((destinations) => {
        if (active) setState({ status: "ready", destinations });
      })
      .catch((loadError) => {
        if (!active) return;
        const failure = describeMemberApiFailure(loadError);
        setState({ status: "failed", message: failure.message, code: failure.code, correlationId: failure.correlationId });
      });
    return () => {
      active = false;
    };
  }, [load]);

  const submitDraft = async () => {
    if (!draft.bankCode.trim() || !draft.accountNumber.trim() || !draft.accountHolderName.trim()) {
      setAction({ status: "failed", code: "VALIDATION_ERROR", message: "กรอกธนาคาร เลขบัญชี และชื่อบัญชีให้ครบก่อนเพิ่มปลายทาง" });
      return;
    }
    setAction({ status: "working", label: "กำลังเพิ่มปลายทาง" });
    try {
      const created = await memberApi.addPayoutDestination({
        type: draft.type as PayoutDestination["type"],
        bankCode: draft.bankCode.trim(),
        accountNumber: draft.accountNumber.trim(),
        accountHolderName: draft.accountHolderName.trim(),
      });
      setState((current) => (current.status === "ready" ? { status: "ready", destinations: [...current.destinations, created] } : current));
      setDraft(emptyDraft);
      setFormOpen(false);
      setAction({ status: "idle" });
    } catch (error) {
      const failure = describeMemberApiFailure(error);
      setAction({ status: "failed", code: failure.code, message: failure.message, correlationId: failure.correlationId });
    }
  };

  const requestVerification = async (destination: PayoutDestination) => {
    setAction({ status: "working", label: "กำลังขอตรวจสอบปลายทาง" });
    try {
      const verified = await memberApi.verifyPayoutDestination(destination.id);
      setState((current) => current.status === "ready"
        ? { status: "ready", destinations: current.destinations.map((item) => (item.id === verified.id ? verified : item)) }
        : current);
      setAction({ status: "idle" });
    } catch (error) {
      const failure = describeMemberApiFailure(error);
      setAction({ status: "failed", code: failure.code, message: failure.message, correlationId: failure.correlationId });
    }
  };

  if (state.status === "loading") {
    return <main id="main"><div className="breadcrumb"><Link href="/account">บัญชี</Link><span>/</span><span>บัญชีรับเงิน</span></div><section className="panel"><div className="panel-title"><h2>กำลังโหลดบัญชีรับเงิน</h2></div><p className="muted small">กำลังดึงปลายทางรับเงินจาก API…</p></section></main>;
  }

  if (state.status === "failed") {
    return <main id="main"><div className="breadcrumb"><Link href="/account">บัญชี</Link><span>/</span><span>บัญชีรับเงิน</span></div><section className="panel"><div className="panel-title"><h2>โหลดปลายทางไม่สำเร็จ</h2><span className="status danger">{state.code}</span></div><p className="muted small">{state.message}</p>{state.correlationId && <p className="muted small">รหัสอ้างอิง: {state.correlationId}</p>}</section></main>;
  }

  const verifiedCount = state.destinations.filter((destination) => destination.status === "VERIFIED").length;

  return <main id="main">
    <div className="breadcrumb"><Link href="/account">บัญชี</Link><span>/</span><span>บัญชีรับเงิน</span></div>
    <div className="page-head"><div><h1>บัญชีรับเงิน</h1><p>ปลายทางรับเงินด้านล่างคือข้อมูลจริงที่ระบบบันทึกไว้ การเพิ่มปลายทางใหม่จะยังไม่ถือว่าใช้ได้จนกว่าการตรวจสอบของระบบจะผ่าน</p></div><span className={`status ${verifiedCount ? "success" : "warning"}`}>{verifiedCount} ปลายทางที่ยืนยันแล้ว</span></div>
    <section className="grid-2 account-verification-layout"><div className="stack">
      <section className="panel"><div className="panel-title"><h2>ปลายทางของฉัน</h2><span className="muted small">{state.destinations.length} รายการ</span></div>
        {state.destinations.length === 0
          ? <div className="notice warning"><b>!</b><div><strong>ยังไม่มีปลายทางรับเงิน</strong>เพิ่มบัญชีรับเงินก่อนส่งคำขอถอน ระบบจะเก็บเฉพาะเลขบัญชีแบบปิดบังไว้ให้คุณเห็น</div></div>
          : <div className="stack">{state.destinations.map((destination) => {
            const status = describeDestinationStatus(destination.status);
            return <div className="bank-destination-card" key={destination.id}>
              <div className="bank-mark">{(destination.bankCode.trim().charAt(0) || "B").toUpperCase()}</div>
              <div><strong>{destination.bankCode} {destination.accountNumberMasked}</strong><span>{destination.accountHolderName} · {destination.type} · เพิ่มเมื่อ {formatDateTime(destination.createdAt)}</span>{destination.verifiedAt && <span className="muted small">ยืนยันเมื่อ {formatDateTime(destination.verifiedAt)} · หลักฐาน {destination.verificationEvidenceRef ?? "—"}</span>}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                <span className={`status ${status.tone}`}>{status.label}</span>
                {destination.status !== "VERIFIED" && <button className="button secondary" type="button" onClick={() => requestVerification(destination)} disabled={action.status === "working"}>ขอตรวจสอบปลายทางนี้</button>}
              </div>
            </div>;
          })}</div>}
        <button className="button secondary block" type="button" style={{ marginTop: 14 }} onClick={() => { setFormOpen(!formOpen); setAction({ status: "idle" }); }}>{formOpen ? "ปิดแบบฟอร์ม" : "เพิ่มบัญชีรับเงิน"}</button>
      </section>

      {formOpen && <section className="panel"><div className="panel-title"><h2>เพิ่มบัญชีรับเงิน</h2><span className="status info">รอการตรวจสอบ</span></div>
        <div className="form-grid" style={{ marginTop: 14 }}>
          <div className="field"><label htmlFor="destination-type">ประเภทปลายทาง</label><select id="destination-type" className="select" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}>{DESTINATION_TYPES.map((type) => <option value={type} key={type}>{type}</option>)}</select></div>
          <div className="field"><label htmlFor="bank-code">รหัสธนาคาร</label><input id="bank-code" className="input" value={draft.bankCode} onChange={(event) => setDraft({ ...draft, bankCode: event.target.value })} placeholder="เช่น KBANK" /></div>
          <div className="field"><label htmlFor="account-number">เลขบัญชีรับเงิน</label><input id="account-number" className="input" inputMode="numeric" autoComplete="off" value={draft.accountNumber} onChange={(event) => setDraft({ ...draft, accountNumber: event.target.value.replace(/\D/g, "") })} placeholder="กรอกเลขบัญชี 6-40 หลัก" /></div>
          <div className="field"><label htmlFor="account-holder">ชื่อบัญชี</label><input id="account-holder" className="input" value={draft.accountHolderName} onChange={(event) => setDraft({ ...draft, accountHolderName: event.target.value })} placeholder="ชื่อเจ้าของบัญชี" /></div>
        </div>
        <div className="notice info"><b>i</b><div><strong>ระบบเก็บเลขบัญชีแบบไม่เปิดเผย</strong>เลขบัญชีที่คุณกรอกถูกส่งให้ระบบออกเลขอ้างอิงและแสดงกลับมาแบบปิดบัง</div></div>
        {action.status === "failed" && <div className="notice warning" style={{ marginTop: 12 }}><b>!</b><div><strong>{action.code}</strong>{action.message}{action.correlationId ? ` · รหัสอ้างอิง ${action.correlationId}` : ""}</div></div>}
        <div className="verification-actions"><button className="button primary" type="button" onClick={submitDraft} disabled={action.status === "working"}>{action.status === "working" ? action.label + "…" : "ส่งปลายทางใหม่ให้ระบบตรวจ"}</button><button className="button secondary" type="button" onClick={() => { setFormOpen(false); setDraft(emptyDraft); setAction({ status: "idle" }); }}>ยกเลิก</button></div>
      </section>}

      {action.status === "failed" && !formOpen && <div className="notice warning"><b>!</b><div><strong>{action.code}</strong>{action.message}{action.correlationId ? ` · รหัสอ้างอิง ${action.correlationId}` : ""}</div></div>}
    </div>
    <aside className="stack"><section className="panel"><div className="panel-title"><h2>การตรวจแยกกัน</h2></div><div className="notice info"><b>i</b><div><strong>ยืนยันปลายทาง ≠ KYC</strong>สถานะของบัญชีรับเงินเป็นคนละ verification กับ Member/KYC และระบบจะตรวจ eligibility ของปลายทางอีกครั้งก่อนจ่ายเงินจริง</div></div><div className="notice warning" style={{ marginTop: 10 }}><b>!</b><div><strong>ปลายทางใหม่ยังใช้ไม่ได้ทันที</strong>การเพิ่มปลายทางสำเร็จหมายถึงระบบรับเรื่องแล้วเท่านั้น สถานะจะเปลี่ยนเป็นยืนยันแล้วเมื่อการตรวจสอบของระบบผ่าน</div></div></section>
      {action.status === "failed" && <div className="notice warning"><b>!</b><div><strong>รายการล่าสุดไม่สำเร็จ</strong>{describeFailureCode(action.code, action.message)}</div></div>}
      <Link className="button secondary block" href="/account">← กลับบัญชี</Link></aside></section>
  </main>;
}
