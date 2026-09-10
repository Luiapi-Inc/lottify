"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthShell } from "../components/auth-shell";

type Readiness = { phone: boolean; terms: boolean; profile: boolean; kyc: boolean };
const empty: Readiness = { phone: false, terms: false, profile: false, kyc: false };

export default function EligibilityPage() {
  const [ready, setReady] = useState<Readiness>(empty);
  useEffect(() => {
    try {
      setReady({
        phone: window.localStorage.getItem("lottify-onboarding-phone") === "verified",
        terms: window.localStorage.getItem("lottify-onboarding-terms") === "accepted",
        profile: window.localStorage.getItem("lottify-onboarding-profile") === "complete",
        kyc: window.localStorage.getItem("lottify-kyc-status") === "verified",
      });
    } catch {}
  }, []);
  const coreReady = ready.phone && ready.terms && ready.profile;
  const firstMissing = !ready.phone ? "/register" : !ready.terms ? "/terms" : !ready.profile ? "/profile" : "/account/kyc";
  const checks: Array<[keyof Omit<Readiness, "kyc">, string, string]> = [["phone", "ยืนยันเบอร์โทรแล้ว", "ผ่าน OTP สำหรับการสมัคร"], ["terms", "ยอมรับ Terms แล้ว", "อ้างอิงเวอร์ชันที่มีผล ณ เวลายอมรับ"], ["profile", "ข้อมูลพื้นฐานครบ", "ระบบใช้ข้อมูลที่จำเป็นตาม policy ที่มีผล"]];
  return <AuthShell title={<>แต่ละบริการ<br />พร้อมไม่พร้อมแยกกัน</>} copy="ระบบประเมินความพร้อมตามข้อกำหนดของแต่ละ capability ไม่ใช้สถานะบัญชีเดียวบล็อกทุกอย่าง" foot="ขั้นตอน 5 จาก 5 · Eligibility">
    <div className="auth-card onboarding-card eligibility-card"><div className="onboarding-step">ตรวจความพร้อมก่อนเริ่มใช้งาน</div><h2>บัญชีพร้อมสำหรับอะไรบ้าง</h2><p>ตัวอย่างนี้ประเมินแบบ capability-specific จากสถานะที่ทำจริงใน frontend preview</p><div className="readiness-checklist">{checks.map(([key, title, detail]) => <div className="readiness-row" key={key}><span className={`readiness-icon ${ready[key] ? "success" : "warning"}`}>{ready[key] ? "✓" : "!"}</span><div><strong>{title}</strong><span>{detail}</span></div><span className={`status ${ready[key] ? "success" : "warning"}`}>{ready[key] ? "ครบแล้ว" : "ยังไม่ครบ"}</span></div>)}</div>
      <div className="capability-grid"><article className={`capability-card ${coreReady ? "" : "warning"}`}><div className="capability-head"><span className="capability-icon">B</span><span className={`status ${coreReady ? "success" : "warning"}`}>{coreReady ? "ใช้งานได้" : "ยังไม่พร้อม"}</span></div><h3>ซื้อหวย</h3><p>{coreReady ? "พร้อมเริ่มเลือกงวด แต่ระบบจะตรวจ Eligibility/Restriction ซ้ำก่อน Quote และ Confirm" : "ต้องทำ requirement พื้นฐานที่ยังขาดก่อน"}</p><Link className="text-link" href={coreReady ? "/buy" : firstMissing}>{coreReady ? "ไปซื้อหวย →" : "ดูสิ่งที่ต้องทำ →"}</Link></article><article className={`capability-card ${coreReady ? "" : "warning"}`}><div className="capability-head"><span className="capability-icon">D</span><span className={`status ${coreReady ? "success" : "warning"}`}>{coreReady ? "ใช้งานได้" : "ยังไม่พร้อม"}</span></div><h3>ฝากเงิน</h3><p>{coreReady ? "พร้อมในตัวอย่างนี้ โดยสถานะเงินจริงยังต้องรอการยืนยันจาก Payments และ Wallet" : "ต้องทำ requirement พื้นฐานที่ยังขาดก่อน"}</p><Link className="text-link" href={coreReady ? "/wallet/deposit" : firstMissing}>{coreReady ? "ไปฝากเงิน →" : "ดูสิ่งที่ต้องทำ →"}</Link></article><article className="capability-card warning"><div className="capability-head"><span className="capability-icon">W</span><span className={`status ${coreReady && ready.kyc ? "success" : "warning"}`}>{coreReady && ready.kyc ? "ใช้งานได้" : "มีเงื่อนไข"}</span></div><h3>ถอนเงิน</h3><p>{!coreReady ? "ต้องทำ requirement พื้นฐานที่ยังขาดก่อน" : ready.kyc ? "KYC ผ่านใน preview แต่ยังต้องประเมิน withdrawal eligibility อีกครั้งตอนทำรายการ" : "ตัวอย่างปัจจุบันต้องยืนยันตัวตนสำหรับการถอน โดยไม่บล็อกการซื้อหวยหรือฝากเงิน"}</p><Link className="text-link" href={!coreReady ? firstMissing : ready.kyc ? "/wallet/withdraw" : "/account/kyc"}>ดูสิ่งที่ต้องทำ →</Link></article></div>
      <div className="notice info"><b>i</b><div><strong>ระบบประเมินซ้ำเมื่อทำรายการสำคัญ</strong>Eligibility เป็นผล ณ เวลาหนึ่ง ไม่ใช่สิทธิ์ถาวร หาก policy/restriction เปลี่ยน ระบบต้องอธิบาย action ถัดไปเฉพาะบริการที่ได้รับผล</div></div><Link className={`button lime block ${coreReady ? "" : "disabled"}`} href={coreReady ? "/" : firstMissing} style={{ marginTop: 18 }}>{coreReady ? "ไปหน้าแรก →" : "ทำขั้นตอนที่ยังขาด →"}</Link></div>
  </AuthShell>;
}
