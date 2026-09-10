"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type KycState = "required" | "submitted" | "review" | "more_info" | "rejected" | "verified";

const configs: Record<KycState, { label: string; tone: string; title: string; copy: string; next?: KycState; action?: string }> = {
  required: { label: "ต้องดำเนินการ", tone: "warning", title: "ต้องยืนยันตัวตนสำหรับบริการนี้", copy: "เริ่มคำขอ KYC เมื่อคุณต้องใช้ capability ที่ policy ปัจจุบันกำหนด โดยไม่ปิดบริการอื่นที่ยังผ่านเงื่อนไข", next: "submitted", action: "เริ่มยืนยันตัวตน" },
  submitted: { label: "ส่งข้อมูลแล้ว", tone: "info", title: "รับข้อมูลแล้ว", copy: "ระบบรับข้อมูลสำหรับ Verification Case นี้แล้ว และยังไม่ถือว่ายืนยันสำเร็จจนกว่าผลการตรวจจะเป็น authoritative", next: "review", action: "ดูสถานะถัดไป" },
  review: { label: "กำลังตรวจสอบ", tone: "warning", title: "กำลังตรวจสอบข้อมูล", copy: "ยังไม่มีผลยืนยันสุดท้าย บริการที่ต้องใช้ KYC ยังคงรอ ส่วน capability อื่นใช้ได้ตาม eligibility ของตนเอง", next: "verified", action: "จำลองผลยืนยัน" },
  more_info: { label: "ต้องเพิ่มข้อมูล", tone: "warning", title: "ต้องส่งข้อมูลเพิ่มเติม", copy: "Verification Case ต้องการข้อมูลเพิ่มก่อนประเมินต่อ ระบบควรบอกสิ่งที่ต้องทำโดยไม่แสดง provider-specific code", next: "submitted", action: "ส่งข้อมูลเพิ่มเติม" },
  rejected: { label: "ไม่ผ่านการตรวจ", tone: "danger", title: "การยืนยันตัวตนไม่ผ่าน", copy: "ผล canonical ของ Verification Case นี้คือ REJECTED บริการที่ต้องใช้ KYC ยังคงใช้ไม่ได้จนกว่าจะมีผลใหม่ตามขั้นตอนที่ policy อนุญาต โดยบริการอื่นยังประเมิน eligibility แยกกัน" },
  verified: { label: "ยืนยันแล้ว", tone: "success", title: "ยืนยันตัวตนแล้ว", copy: "มีผล KYC ที่ยืนยันแล้วสำหรับ case นี้ แต่ capability สำคัญยังต้องประเมิน eligibility และ freshness อีกครั้งเมื่อทำรายการ" },
};

const states: Array<[KycState, string]> = [["required", "ต้องยืนยัน"], ["submitted", "ส่งข้อมูลแล้ว"], ["review", "กำลังตรวจสอบ"], ["more_info", "ต้องเพิ่มข้อมูล"], ["rejected", "ไม่ผ่าน"], ["verified", "ยืนยันแล้ว"]];

export default function KycPage() {
  const [state, setState] = useState<KycState>("required");
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("lottify-kyc-status") as KycState | null;
      if (stored && stored in configs) setState(stored);
    } catch {}
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem("lottify-kyc-status", state); } catch {}
  }, [state]);
  const config = configs[state];

  return <main id="main">
    <div className="breadcrumb"><Link href="/account">บัญชี</Link><span>/</span><span>การยืนยันตัวตน</span></div>
    <div className="page-head"><div><h1>การยืนยันตัวตน</h1><p>ระบบขอ KYC เฉพาะบริการหรือระดับความเสี่ยงที่ policy กำหนด ไม่ได้ใช้เป็นเงื่อนไขเดียวบล็อกทั้งบัญชี</p></div><span className={`status ${config.tone}`}>{config.label}</span></div>
    <section className="grid-2 account-verification-layout">
      <div className="stack">
        <section className="panel"><div className="panel-title"><h2>ความพร้อมตามบริการ</h2></div><div className="verification-capabilities"><div className="verification-row"><div className="menu-icon">B</div><div><strong>ซื้อหวย</strong><span>ไม่ถูกบล็อกเพียงเพราะ KYC ยังไม่เสร็จในตัวอย่างนี้; ระบบตรวจ eligibility อีกครั้งตอนทำรายการ</span></div><span className="status success">พร้อม</span></div><div className="verification-row"><div className="menu-icon">D</div><div><strong>ฝากเงิน</strong><span>พร้อมในตัวอย่างนี้ โดย policy อาจประเมินเพิ่มตามรายการจริง</span></div><span className="status success">พร้อม</span></div><div className="verification-row"><div className="menu-icon">W</div><div><strong>ถอนเงิน</strong><span>ตัวอย่างปัจจุบันต้องผ่านการยืนยันตัวตนก่อนใช้ capability นี้</span></div><span className={state === "verified" ? "status success" : "status warning"}>{state === "verified" ? "พร้อม" : "ต้อง KYC"}</span></div></div></section>
        <section className="panel"><div className="panel-title"><h2>สถานะการยืนยัน</h2><div className="verification-state-switcher">{states.map(([value, label]) => <button className={`chip-btn ${state === value ? "active" : ""}`} type="button" key={value} aria-pressed={state === value} onClick={() => setState(value)}>{label}</button>)}</div></div><div className="verification-state-card"><h3>{config.title}</h3><p>{config.copy}</p><div className="verification-actions">{config.next && <button className="button primary" type="button" onClick={() => setState(config.next!)}>{config.action}</button>}{!config.next && <Link className="button secondary" href="/account">กลับบัญชี</Link>}</div></div></section>
      </div>
      <aside className="stack"><section className="panel"><div className="panel-title"><h2>หลักการสำคัญ</h2></div><div className="notice info"><b>i</b><div><strong>OTP ไม่ใช่ KYC</strong>OTP ยืนยันการครอบครองช่องทางสำหรับ authentication/re-auth เท่านั้น การยืนยันตัวตนใช้หลักฐานและ policy ของ KYC/Risk แยกต่างหาก</div></div><div className="notice warning" style={{ marginTop: 10 }}><b>!</b><div><strong>ผล Eligibility มีอายุ</strong>บริการสำคัญจะประเมินสิทธิ์อีกครั้งเมื่อทำรายการ ไม่ถือผลเดิมว่าใช้ได้ถาวร</div></div></section><Link className="button secondary block" href="/account">← กลับบัญชี</Link></aside>
    </section>
  </main>;
}
