"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthShell } from "../components/auth-shell";
import {
  memberApi,
  type CapabilityReadiness,
  type MemberReadinessResponse,
  type ReadinessCapability,
} from "../lib/member-api";

const capabilityMeta: Record<
  Exclude<ReadinessCapability, "PROMOTION">,
  { icon: string; title: string; successCopy: string; successHref: string }
> = {
  BET: {
    icon: "B",
    title: "ซื้อหวย",
    successCopy: "พร้อมเริ่มเลือกงวด โดยระบบจะประเมิน Eligibility ซ้ำก่อน Quote และ Confirm",
    successHref: "/buy",
  },
  DEPOSIT: {
    icon: "D",
    title: "ฝากเงิน",
    successCopy: "ผ่านข้อกำหนด readiness ปัจจุบัน โดยสถานะรายการเงินจริงยังยืนยันจาก Payments และ Wallet",
    successHref: "/wallet/deposit",
  },
  WITHDRAWAL: {
    icon: "W",
    title: "ถอนเงิน",
    successCopy: "ผ่านข้อกำหนด readiness ปัจจุบัน และจะประเมิน withdrawal eligibility ซ้ำตอนทำรายการ",
    successHref: "/wallet/withdraw",
  },
};

const shownCapabilities: Array<Exclude<ReadinessCapability, "PROMOTION">> = [
  "BET",
  "DEPOSIT",
  "WITHDRAWAL",
];

function statusFor(decision: CapabilityReadiness) {
  switch (decision.outcome) {
    case "ALLOW":
      return { tone: "success", label: "ใช้งานได้" };
    case "REVIEW_REQUIRED":
      return { tone: "warning", label: "กำลังตรวจสอบ" };
    case "CHALLENGE/REAUTH_REQUIRED":
      return { tone: "warning", label: "ต้องยืนยันเพิ่ม" };
    default:
      return { tone: "warning", label: "ยังไม่พร้อม" };
  }
}

function nextRequirementHref(decision: CapabilityReadiness): string {
  if (decision.reasonCodes.includes("TERMS_NOT_ACCEPTED")) return "/terms";
  if (decision.reasonCodes.includes("PROFILE_INCOMPLETE")) return "/profile";
  if (decision.reasonCodes.some((code) => code.startsWith("KYC_"))) return "/account/kyc";
  return "/account";
}

function reasonCopy(decision: CapabilityReadiness): string {
  if (decision.reasonCodes.includes("TERMS_NOT_ACCEPTED")) return "ต้องยอมรับข้อตกลงที่มีผลกับบัญชีนี้ก่อน";
  if (decision.reasonCodes.includes("PROFILE_INCOMPLETE")) return "ต้องกรอกข้อมูลพื้นฐานที่ policy กำหนดให้ครบก่อน";
  if (decision.reasonCodes.includes("KYC_REQUIRED")) return "บริการนี้ต้องยืนยันตัวตน KYC ก่อนใช้งาน";
  if (decision.reasonCodes.includes("KYC_EXPIRED")) return "ผล KYC เดิมหมดอายุและต้องยืนยันใหม่ตาม policy";
  if (decision.reasonCodes.includes("KYC_REJECTED")) return "ผล KYC ปัจจุบันไม่ผ่าน จึงยังใช้บริการนี้ไม่ได้";
  if (decision.reasonCodes.includes("KYC_REVIEW_REQUIRED")) return "KYC อยู่ระหว่างการตรวจสอบ จึงยังต้องรอผลก่อน";
  if (decision.reasonCodes.includes("KYC_MORE_INFO_REQUIRED")) return "KYC ต้องการข้อมูลเพิ่มเติมก่อนประเมินต่อ";
  if (decision.outcome === "CHALLENGE/REAUTH_REQUIRED") return "ต้องยืนยันตัวตนเพิ่มเติมก่อนดำเนินการ";
  return "บริการนี้ยังไม่พร้อมตาม eligibility หรือ restriction ที่มีผลกับบัญชี";
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "ไม่สามารถตรวจความพร้อมของบัญชีได้ กรุณาลองอีกครั้ง";
}

export default function EligibilityPage() {
  const [readiness, setReadiness] = useState<MemberReadinessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    memberApi.getReadiness()
      .then((result) => {
        if (!active) return;
        setReadiness(result);
        setError("");
      })
      .catch((cause) => {
        if (!active) return;
        setError(messageFrom(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const termsReady = readiness?.requirements.termsSatisfied ?? false;
  const profileReady = readiness?.requirements.profileComplete ?? false;
  const checks = readiness
    ? [
        [true, "ยืนยันการเข้าใช้งานแล้ว", "เซสชันปัจจุบันผ่านการยืนยันตัวตนสำหรับการเข้าใช้งาน"],
        [termsReady, "ยอมรับ Terms แล้ว", "อ้างอิงเอกสารและเวอร์ชันที่มีผลจากระบบ"],
        [profileReady, "ข้อมูลพื้นฐานครบ", "ระบบตรวจ mandatory profile fields ตาม policy ปัจจุบัน"],
      ] as const
    : [];

  return (
    <AuthShell
      title={<>แต่ละบริการ<br />พร้อมไม่พร้อมแยกกัน</>}
      copy="ระบบประเมินความพร้อมตามข้อกำหนดของแต่ละ capability ไม่ใช้สถานะบัญชีเดียวบล็อกทุกอย่าง"
      foot="ขั้นตอน 5 จาก 5 · Eligibility"
    >
      <div className="auth-card onboarding-card eligibility-card">
        <div className="onboarding-step">ตรวจความพร้อมก่อนเริ่มใช้งาน</div>
        <h2>บัญชีพร้อมสำหรับอะไรบ้าง</h2>
        <p>ผลด้านล่างมาจาก readiness policy ของระบบและมีอายุจำกัด</p>

        {loading && <div className="notice info"><b>i</b><div><strong>กำลังตรวจความพร้อม</strong>กำลังอ่าน Terms, Profile, KYC และ Eligibility ล่าสุดจากระบบ</div></div>}
        {error && <div className="notice warning"><b>!</b><div><strong>ตรวจความพร้อมไม่สำเร็จ</strong>{error}</div></div>}

        {readiness && <>
          <div className="readiness-checklist">
            {checks.map(([ready, title, detail]) => (
              <div className="readiness-row" key={title}>
                <span className={`readiness-icon ${ready ? "success" : "warning"}`}>{ready ? "✓" : "!"}</span>
                <div><strong>{title}</strong><span>{detail}</span></div>
                <span className={`status ${ready ? "success" : "warning"}`}>{ready ? "ครบแล้ว" : "ยังไม่ครบ"}</span>
              </div>
            ))}
          </div>

          <div className="capability-grid">
            {shownCapabilities.map((capability) => {
              const meta = capabilityMeta[capability];
              const decision = readiness.capabilities.find((entry) => entry.capability === capability);
              if (!decision) return null;
              const status = statusFor(decision);
              const allowed = decision.outcome === "ALLOW";
              return (
                <article className={`capability-card ${allowed ? "" : "warning"}`} key={capability}>
                  <div className="capability-head">
                    <span className="capability-icon">{meta.icon}</span>
                    <span className={`status ${status.tone}`}>{status.label}</span>
                  </div>
                  <h3>{meta.title}</h3>
                  <p>{allowed ? meta.successCopy : reasonCopy(decision)}</p>
                  <Link className="text-link" href={allowed ? meta.successHref : nextRequirementHref(decision)}>
                    {allowed ? `ไป${meta.title} →` : "ดูสิ่งที่ต้องทำ →"}
                  </Link>
                </article>
              );
            })}
          </div>

          <div className="notice info">
            <b>i</b>
            <div><strong>ระบบประเมินซ้ำเมื่อทำรายการสำคัญ</strong>ผลนี้อ้างอิง policy {readiness.policyVersion} และใช้ได้ถึงเวลาที่ decision ระบุ หาก policy หรือ restriction เปลี่ยน ระบบจะประเมินใหม่</div>
          </div>
          <Link className="button lime block" href="/" style={{ marginTop: 18 }}>ไปหน้าแรก →</Link>
        </>}
      </div>
    </AuthShell>
  );
}
