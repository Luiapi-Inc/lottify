"use client";

import Link from "next/link";
import { AuthorityCallout, WorkflowHero } from "../../components/workflow";
import { useEffect, useState } from "react";
import {
  memberApi,
  type CapabilityReadiness,
  type MemberReadinessResponse,
  type ReadinessCapability,
} from "../../lib/member-api";

type KycViewState = "required" | "review" | "more_info" | "rejected" | "expired" | "verified";

const configs: Record<KycViewState, { label: string; tone: string; title: string; copy: string }> = {
  required: {
    label: "ต้องดำเนินการ",
    tone: "warning",
    title: "ต้องยืนยันตัวตนสำหรับบางบริการ",
    copy: "KYC ยังไม่ผ่านตาม policy ปัจจุบัน บริการที่กำหนด KYC จะยังใช้งานไม่ได้ แต่ capability อื่นยังประเมินแยกกัน",
  },
  review: {
    label: "กำลังตรวจสอบ",
    tone: "warning",
    title: "กำลังตรวจสอบข้อมูล",
    copy: "ระบบมีผล KYC แบบ REVIEW_REQUIRED บริการที่ต้องใช้ KYC จึงยังรอผล ขณะที่ capability อื่นยังใช้ผล eligibility ของตนเอง",
  },
  more_info: {
    label: "ต้องเพิ่มข้อมูล",
    tone: "warning",
    title: "ต้องส่งข้อมูลเพิ่มเติม",
    copy: "ผล KYC ปัจจุบันระบุว่าต้องมีข้อมูลเพิ่มเติมก่อนประเมินต่อ โดยบริการอื่นยังประเมิน eligibility แยกกัน",
  },
  rejected: {
    label: "ไม่ผ่านการตรวจ",
    tone: "danger",
    title: "การยืนยันตัวตนไม่ผ่าน",
    copy: "ผล canonical ของ KYC ปัจจุบันคือ REJECTED บริการที่ต้องใช้ KYC จะยังใช้ไม่ได้จนกว่าจะมีผลใหม่ตามขั้นตอนที่ policy อนุญาต",
  },
  expired: {
    label: "หมดอายุ",
    tone: "warning",
    title: "ผลการยืนยันตัวตนหมดอายุ",
    copy: "ระบบเคยมีผล KYC ที่ยืนยันแล้ว แต่หลักฐานปัจจุบันพ้นช่วง freshness จึงต้องยืนยันใหม่ก่อนใช้ capability ที่กำหนด KYC",
  },
  verified: {
    label: "ยืนยันแล้ว",
    tone: "success",
    title: "ยืนยันตัวตนแล้ว",
    copy: "KYC มีผล VERIFIED และยังอยู่ในช่วง freshness แต่บริการสำคัญจะประเมิน eligibility อีกครั้งเมื่อทำรายการจริง",
  },
};

const capabilityLabels: Record<Exclude<ReadinessCapability, "PROMOTION">, { icon: string; title: string }> = {
  BET: { icon: "B", title: "ซื้อหวย" },
  DEPOSIT: { icon: "D", title: "ฝากเงิน" },
  WITHDRAWAL: { icon: "W", title: "ถอนเงิน" },
};

const shownCapabilities: Array<Exclude<ReadinessCapability, "PROMOTION">> = ["BET", "DEPOSIT", "WITHDRAWAL"];

function resolveKycState(readiness: MemberReadinessResponse): KycViewState {
  const kyc = readiness.requirements.kyc;
  if (kyc.verified) return "verified";
  if (kyc.expired) return "expired";
  if (kyc.status === "REJECTED") return "rejected";
  if (kyc.status === "REVIEW_REQUIRED") return "review";
  if (kyc.status === "MORE_INFO_REQUIRED") return "more_info";
  return "required";
}

function capabilityStatus(decision: CapabilityReadiness) {
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

function capabilityCopy(decision: CapabilityReadiness): string {
  if (decision.reasonCodes.includes("KYC_REQUIRED")) return "บริการนี้ต้องมี KYC ที่ยืนยันแล้วและยังไม่หมดอายุ";
  if (decision.reasonCodes.includes("KYC_EXPIRED")) return "KYC เดิมหมดอายุ จึงต้องยืนยันใหม่ก่อนใช้บริการนี้";
  if (decision.reasonCodes.includes("KYC_REJECTED")) return "ผล KYC ปัจจุบันไม่ผ่าน จึงยังใช้บริการนี้ไม่ได้";
  if (decision.reasonCodes.includes("KYC_REVIEW_REQUIRED")) return "KYC อยู่ระหว่างตรวจสอบ จึงยังต้องรอผล";
  if (decision.reasonCodes.includes("KYC_MORE_INFO_REQUIRED")) return "KYC ต้องการข้อมูลเพิ่มเติมก่อนประเมินต่อ";
  if (decision.reasonCodes.includes("TERMS_NOT_ACCEPTED")) return "ต้องยอมรับข้อตกลงที่มีผลก่อน";
  if (decision.reasonCodes.includes("PROFILE_INCOMPLETE")) return "ต้องกรอกข้อมูลพื้นฐานที่กำหนดให้ครบก่อน";
  if (decision.outcome === "ALLOW") return "ผ่าน readiness policy ปัจจุบัน";
  return "บริการนี้ยังไม่พร้อมตาม eligibility หรือ restriction ที่มีผล";
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "ไม่สามารถอ่านสถานะ KYC ได้ กรุณาลองอีกครั้ง";
}

export default function KycPage() {
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

  const state = readiness ? resolveKycState(readiness) : "required";
  const config = configs[state];

  return <main id="main">
    <WorkflowHero eyebrow="ACCOUNT · KYC / RISK" title="ยืนยันตัวตนเท่าที่แต่ละบริการต้องใช้" description="KYC เป็น evidence และ policy decision แยกจาก OTP, session และ payout-destination verification ทุก capability ถูกประเมินตามเงื่อนไขของตัวเอง" backHref="/account" backLabel="บัญชี" status={<span className={`status ${loading ? "info" : config.tone}`}>{loading ? "กำลังโหลด" : config.label}</span>}>
      <span>Capability-specific</span><span>Policy {readiness?.policyVersion ?? "—"}</span>
    </WorkflowHero>

    {loading && <div className="notice info"><b>i</b><div><strong>กำลังอ่านสถานะ KYC</strong>กำลังตรวจ readiness และ eligibility ล่าสุดจากระบบ</div></div>}
    {error && <div className="notice warning"><b>!</b><div><strong>อ่านสถานะไม่สำเร็จ</strong>{error}</div></div>}

    {readiness && <section className="grid-2 account-verification-layout">
      <div className="stack">
        <section className="panel">
          <div className="panel-title"><h2>ความพร้อมตามบริการ</h2></div>
          <div className="verification-capabilities">
            {shownCapabilities.map((capability) => {
              const decision = readiness.capabilities.find((entry) => entry.capability === capability);
              if (!decision) return null;
              const meta = capabilityLabels[capability];
              const status = capabilityStatus(decision);
              return <div className="verification-row" key={capability}>
                <div className="menu-icon">{meta.icon}</div>
                <div><strong>{meta.title}</strong><span>{capabilityCopy(decision)}</span></div>
                <span className={`status ${status.tone}`}>{status.label}</span>
              </div>;
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title"><h2>สถานะการยืนยัน</h2><span className={`status ${config.tone}`}>{config.label}</span></div>
          <div className="verification-state-card">
            <h3>{config.title}</h3>
            <p>{config.copy}</p>
            <div className="verification-actions"><Link className="button secondary" href="/eligibility">ดู Eligibility →</Link></div>
          </div>
        </section>
      </div>

      <aside className="stack">
        <section className="panel">
          <div className="panel-title"><h2>หลักการสำคัญ</h2></div><AuthorityCallout>สถานะหน้านี้อ่านจาก readiness/KYC canonical outcome เท่านั้น Member UI ไม่แก้ผล VERIFIED, REJECTED หรือ REVIEW_REQUIRED เอง</AuthorityCallout>
          <div className="notice info"><b>i</b><div><strong>OTP ไม่ใช่ KYC</strong>OTP ใช้ยืนยันการเข้าใช้งานหรือ re-auth ส่วน KYC ใช้ผลการตรวจตาม policy แยกต่างหาก</div></div>
          <div className="notice warning" style={{ marginTop: 10 }}><b>!</b><div><strong>ผล Eligibility มีอายุ</strong>บริการสำคัญจะประเมินสิทธิ์อีกครั้งเมื่อทำรายการ ไม่ถือผล readiness นี้ว่าใช้ได้ถาวร</div></div>
          {!readiness.requirements.kyc.verified && <div className="notice info" style={{ marginTop: 10 }}><b>i</b><div><strong>สถานะมาจากระบบ KYC/Risk</strong>หน้านี้แสดงผล authoritative ปัจจุบันและไม่เปลี่ยนสถานะ KYC จากฝั่ง Member โดยตรง</div></div>}
        </section>
        <Link className="button secondary block" href="/account">← กลับบัญชี</Link>
      </aside>
    </section>}
  </main>;
}
