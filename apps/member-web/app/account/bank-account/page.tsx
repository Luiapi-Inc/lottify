"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  memberApi,
  type AddPayoutDestinationRequest,
  type PayoutDestination,
} from "../../lib/member-api";
import { ErrorState, LoadingState, PageHeading, Section, StatusBadge } from "../../components/presentation";

const emptyDraft: AddPayoutDestinationRequest = {
  type: "BANK_ACCOUNT",
  bankCode: "",
  accountNumber: "",
  accountHolderName: "",
};

export default function BankAccountPage() {
  const [items, setItems] = useState<PayoutDestination[]>([]);
  const [selected, setSelected] = useState<PayoutDestination | null>(null);
  const [draft, setDraft] = useState<AddPayoutDestinationRequest>(emptyDraft);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await memberApi.listPayoutDestinations();
      setItems(result.items);
      if (result.items[0]) {
        const detail = await memberApi.getPayoutDestination(result.items[0].id);
        setSelected(detail);
      } else {
        setSelected(null);
      }
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function selectDestination(id: string) {
    setError(null);
    try {
      setSelected(await memberApi.getPayoutDestination(id));
    } catch (cause) {
      setError(cause);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!draft.bankCode.trim() || !draft.accountNumber.trim() || !draft.accountHolderName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await memberApi.addPayoutDestination({
        type: "BANK_ACCOUNT",
        bankCode: draft.bankCode.trim().toUpperCase(),
        accountNumber: draft.accountNumber.replace(/\D/g, ""),
        accountHolderName: draft.accountHolderName.trim(),
      });
      setDraft(emptyDraft);
      setShowForm(false);
      const detail = await memberApi.getPayoutDestination(created.id);
      setSelected(detail);
      const result = await memberApi.listPayoutDestinations();
      setItems(result.items);
    } catch (cause) {
      setError(cause);
    } finally {
      setSubmitting(false);
    }
  }

  async function verify() {
    if (!selected || selected.status === "VERIFIED") return;
    setVerifying(true);
    setError(null);
    try {
      const result = await memberApi.verifyPayoutDestination(selected.id);
      setSelected(result);
      setItems((current) => current.map((item) => item.id === result.id ? result : item));
    } catch (cause) {
      setError(cause);
    } finally {
      setVerifying(false);
    }
  }

  return <main id="main">
    <PageHeading
      eyebrow="PAYOUT DESTINATIONS"
      title="บัญชีรับเงิน"
      description="เลขบัญชีเต็มใช้เฉพาะตอนส่งฟอร์มเพิ่มปลายทาง หลังจากนั้น UI แสดงเฉพาะค่าที่ API mask ให้ และสถานะ verification เป็นคนละเรื่องกับ KYC"
      action={<button className="button primary" type="button" onClick={() => setShowForm((value) => !value)}>{showForm ? "ปิดฟอร์ม" : "+ เพิ่มบัญชีรับเงิน"}</button>}
    />

    {loading ? <LoadingState label="กำลังโหลดบัญชีรับเงิน…" /> : null}
    {error ? <div style={{ marginBottom: 16 }}><ErrorState error={error} retry={() => void load()} /></div> : null}

    <section className="grid-2">
      <div className="stack">
        {showForm ? <Section title="เพิ่ม BANK_ACCOUNT" subtitle="ข้อมูลเลขบัญชีเต็มจะไม่ถูกเก็บใน localStorage หรือ state หลังส่งสำเร็จ">
          <form className="form-grid" onSubmit={add}>
            <div className="field"><label htmlFor="bank-code">รหัสธนาคาร</label><input id="bank-code" value={draft.bankCode} placeholder="KBANK" onChange={(event) => setDraft((current) => ({ ...current, bankCode: event.target.value }))} /></div>
            <div className="field"><label htmlFor="holder-name">ชื่อเจ้าของบัญชี</label><input id="holder-name" value={draft.accountHolderName} autoComplete="name" onChange={(event) => setDraft((current) => ({ ...current, accountHolderName: event.target.value }))} /></div>
            <div className="field full"><label htmlFor="account-number">เลขบัญชี</label><input id="account-number" inputMode="numeric" autoComplete="off" value={draft.accountNumber} onChange={(event) => setDraft((current) => ({ ...current, accountNumber: event.target.value.replace(/\D/g, "") }))} /></div>
            <div className="field full"><button className="button lime block" disabled={submitting} type="submit">{submitting ? "กำลังเพิ่ม…" : "ส่งบัญชีรับเงินให้ API"}</button></div>
          </form>
        </Section> : null}

        <Section title="ปลายทางทั้งหมด" subtitle={`${items.length} รายการจาก payout-destinations`}>
          {items.length ? <div className="data-list">{items.map((item) => <button
            type="button"
            key={item.id}
            className="data-row"
            style={{ width: "100%", textAlign: "left", borderTop: 0, borderLeft: 0, borderRight: 0, cursor: "pointer", background: selected?.id === item.id ? "var(--mint)" : "transparent" }}
            onClick={() => void selectDestination(item.id)}
          >
            <div className="data-main"><strong>{bankLabel(item.bankCode)} · {item.accountNumberMasked}</strong><span>{item.accountHolderName} · {item.id}</span></div>
            <StatusBadge tone={item.status === "VERIFIED" ? "success" : item.status === "REJECTED" ? "danger" : "warning"}>{item.status}</StatusBadge>
          </button>)}</div> : !loading ? <div className="state-card"><span className="state-symbol">+</span><div><strong>ยังไม่มีบัญชีรับเงิน</strong><p>เพิ่มบัญชีเพื่อใช้เป็น Payout Destination สำหรับ Withdrawal</p></div></div> : null}
        </Section>
      </div>

      <aside className="stack">
        <Section title="รายละเอียดปลายทาง" subtitle="อ่านจาก GET /payout-destinations/{id}">
          {selected ? <div className="data-list">
            <div className="data-row"><div className="data-main"><strong>{bankLabel(selected.bankCode)} · {selected.accountNumberMasked}</strong><span>{selected.accountHolderName}</span></div><StatusBadge tone={selected.status === "VERIFIED" ? "success" : selected.status === "REJECTED" ? "danger" : "warning"}>{selected.status}</StatusBadge></div>
            <div className="data-row"><div className="data-main"><strong>Currency</strong><span>{selected.currency}</span></div><div className="data-meta"><strong>v{selected.version}</strong></div></div>
            <div className="data-row"><div className="data-main"><strong>Verification evidence</strong><span>{selected.verificationEvidenceRef ?? "ยังไม่มีหลักฐาน verification"}</span></div><div className="data-meta"><strong>{selected.verifiedAt ? new Date(selected.verifiedAt).toLocaleString("th-TH") : "—"}</strong></div></div>
          </div> : <div className="state-card"><span className="state-symbol">○</span><div><strong>เลือกบัญชีรับเงิน</strong><p>รายละเอียดและสถานะจะโหลดจาก API</p></div></div>}
        </Section>

        {selected && selected.status !== "VERIFIED" ? <button className="button primary block" type="button" disabled={verifying} onClick={() => void verify()}>{verifying ? "กำลังตรวจสอบ…" : "ส่งตรวจ Payout Destination"}</button> : null}
        <div className="notice info"><b>i</b><div><strong>Verification ≠ KYC</strong>ปลายทางที่ VERIFIED ยังต้องผ่าน Withdrawal eligibility และ risk policy ณ เวลาถอนเงิน</div></div>
        <Link className="button secondary block" href="/wallet/withdraw">ไปหน้าถอนเงิน →</Link>
      </aside>
    </section>
  </main>;
}

function bankLabel(code: string): string {
  const labels: Record<string, string> = { KBANK: "กสิกรไทย", SCB: "ไทยพาณิชย์", KTB: "กรุงไทย", BBL: "กรุงเทพ", BAY: "กรุงศรี" };
  return labels[code] ?? code;
}
