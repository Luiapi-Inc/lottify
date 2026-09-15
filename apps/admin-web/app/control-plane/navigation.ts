"use client";

import type { components } from "@lottify/contracts";

export type AdminCapability = components["schemas"]["AdminMeResponse"]["capabilities"][number];
export type AdminRole = components["schemas"]["AdminMeResponse"]["role"];

export interface NavigationArea {
  /** Stable identity used for active-state and ordering. */
  key: string;
  /** Thai label shown in the sidebar (Issue 12 operational responsibility). */
  label: string;
  /** Optional next route. Absent when the area has no dedicated screen. */
  href?: string;
  /**
   * Permission-aware gating. When capabilities is non-empty, the admin must
   * hold at least one listed capability (read-level) for the area to be shown.
   */
  capabilities: readonly AdminCapability[];
  /**
   * True only when an authoritative Admin REST contract/queue actually exists
   * for this operational area. False areas are surfaced as "service not yet
   * exposed" rather than silently dropped or fabricated.
   */
  serviceExposed: boolean;
  /** True only when this checkpoint has a dedicated operator screen. */
  uiExposed: boolean;
  /** One-line plain description for the sidebar tooltip / empty states. */
  description: string;
  /** Read capability used to decide whether the area may be opened at all. */
  readCapability?: AdminCapability;
}

/**
 * Issue 12 orders navigation by operational responsibility. API exposure and
 * UI exposure are tracked separately so an existing contract is not reported
 * as missing merely because its dedicated screen has not shipped yet.
 */
export const NAVIGATION_AREAS: readonly NavigationArea[] = [
  {
    key: "overview",
    label: "ภาพรวม",
    href: "/",
    capabilities: [],
    serviceExposed: true,
    uiExposed: true,
    description: "งานปฏิบัติการที่รอการดำเนินการ และจุดเข้าคิวของแต่ละพื้นที่",
  },
  {
    key: "lottery",
    label: "หวยและงวด",
    href: "/lottery",
    capabilities: ["lottery-configuration.read"],
    readCapability: "lottery-configuration.read",
    serviceExposed: true,
    uiExposed: true,
    description: "ตั้งค่าผลิตภัณฑ์หวยและประเภทเดิมพัน (เวอร์ชันแบบกำกับ)",
  },
  {
    key: "betting-risk",
    label: "การเดิมพันและความเสี่ยง",
    capabilities: [],
    serviceExposed: false,
    uiExposed: false,
    description: "Exposure / liability ของงวด — ยังไม่มี REST contract ใน checkpoint นี้",
  },
  {
    key: "finance",
    label: "การเงิน",
    href: "/accounting-periods",
    capabilities: ["accounting-period.read"],
    readCapability: "accounting-period.read",
    serviceExposed: true,
    uiExposed: true,
    description: "Accounting Period, การอนุมัติและปิดรอบอย่างเป็นทางการ",
  },
  {
    key: "withdrawals",
    label: "Withdrawals",
    capabilities: ["withdrawal.read"],
    readCapability: "withdrawal.read",
    serviceExposed: true,
    uiExposed: false,
    description: "มี Withdrawal review / payout / reconciliation REST contract แล้ว แต่ยังไม่มีหน้าจอเฉพาะ",
  },
  {
    key: "results-settlement",
    label: "ผลรางวัลและ Settlement",
    serviceExposed: true,
    uiExposed: false,
    capabilities: ["result.read", "settlement.read"],
    readCapability: "result.read",
    description: "มี Result และ Settlement REST contract แล้ว แต่ยังไม่มีหน้าจอปฏิบัติการเฉพาะ",
  },
  {
    key: "members-kyc",
    label: "สมาชิกและ KYC",
    serviceExposed: true,
    uiExposed: false,
    capabilities: ["member-terms.read", "member-readiness.read"],
    readCapability: "member-terms.read",
    description: "มี Member Terms และ Readiness REST contract แล้ว แต่ยังไม่มีหน้าจอเฉพาะ",
  },
  {
    key: "promotions",
    label: "โปรโมชั่น",
    serviceExposed: true,
    uiExposed: false,
    capabilities: ["promotion.read"],
    readCapability: "promotion.read",
    description: "มี Promotion REST contract แล้ว แต่ยังไม่มีหน้าจอปฏิบัติการเฉพาะ",
  },
  {
    key: "reconciliation",
    label: "Reconciliation",
    serviceExposed: true,
    uiExposed: false,
    capabilities: ["reconciliation.read"],
    readCapability: "reconciliation.read",
    description: "มี Reconciliation REST contract แล้ว แต่ยังไม่มีหน้าจอ discrepancy เฉพาะ",
  },
  {
    key: "approvals",
    label: "Approvals",
    capabilities: [
      "accounting-period.approve",
      "lottery-configuration.approve",
      "accounting-period.submit",
      "lottery-configuration.submit",
    ],
    serviceExposed: true,
    uiExposed: true,
    description: "รายการที่รอการอนุมัติข้ามพื้นที่ที่ระบบรองรับ",
  },
  {
    key: "system-config",
    label: "ระบบและตั้งค่า",
    href: "/lottery",
    capabilities: ["lottery-configuration.read", "accounting-period.read"],
    readCapability: "lottery-configuration.read",
    serviceExposed: true,
    uiExposed: true,
    description: "การตั้งค่าสำคัญแบบ DRAFT → REVIEW → PUBLISHED",
  },
  {
    key: "audit-reports",
    label: "Audit / Reports",
    serviceExposed: true,
    uiExposed: false,
    capabilities: ["report.read", "audit.read"],
    readCapability: "report.read",
    description: "มี Audit และ Reporting REST contract แล้ว แต่ยังไม่มีหน้าจอเฉพาะ",
  },
];

/** Areas that may contain human-review work on this checkpoint. */
export const QUEUE_AREAS = {
  accountingPeriodApproval: {
    key: "approvals-accounting-period",
    label: "Accounting Period",
    queueLabel: "คำขอ Custom / ปิดรอบที่รอการดำเนินการ",
  },
  lotteryConfiguration: {
    key: "approvals-lottery-configuration",
    label: "Lottery Configuration",
    queueLabel: "เวอร์ชัน Lottery Config ที่รอส่งตรวจ / อนุมัติ",
  },
} as const;

export function hasAnyCapability(
  granted: readonly AdminCapability[] | undefined,
  required: readonly AdminCapability[],
): boolean {
  if (!granted) return false;
  if (required.length === 0) return true;
  return required.some((capability) => granted.includes(capability));
}

export function roleLabel(role: AdminRole): string {
  switch (role) {
    case "SUPER_ADMIN":
      return "ผู้ดูแลระบบสูงสุด";
    case "ADMIN":
      return "ผู้ดูแลระบบ";
    case "AUDITOR":
      return "ผู้ตรวจสอบ";
  }
}
