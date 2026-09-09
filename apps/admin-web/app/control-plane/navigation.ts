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
  /** One-line plain description for the sidebar tooltip / empty states. */
  description: string;
  /** Read capability used to decide whether the area may be opened at all. */
  readCapability?: AdminCapability;
}

/**
 * Issue 12 orders navigation by operational responsibility. Only two areas
 * currently have an authoritative Admin REST contract on this checkpoint:
 * lottery configuration (/lottery) and accounting period / finance
 * (/accounting-periods). Every remaining operational area is declared
 * explicitly as not-yet-exposed so the operator is never shown invented data.
 */
export const NAVIGATION_AREAS: readonly NavigationArea[] = [
  {
    key: "overview",
    label: "ภาพรวม",
    href: "/",
    capabilities: [],
    serviceExposed: true,
    description: "งานปฏิบัติการที่รอการดำเนินการ และจุดเข้าคิวของแต่ละพื้นที่",
  },
  {
    key: "lottery",
    label: "หวยและงวด",
    href: "/lottery",
    capabilities: ["lottery-configuration.read"],
    readCapability: "lottery-configuration.read",
    serviceExposed: true,
    description: "ตั้งค่าผลิตภัณฑ์หวยและประเภทเดิมพัน (เวอร์ชันแบบกำกับ)",
  },
  {
    key: "betting-risk",
    label: "การเดิมพันและความเสี่ยง",
    capabilities: [],
    serviceExposed: false,
    description: "Exposure / liability ของงวด — ยังไม่มี REST contract ใน checkpoint นี้",
  },
  {
    key: "finance",
    label: "การเงิน",
    href: "/accounting-periods",
    capabilities: ["accounting-period.read"],
    readCapability: "accounting-period.read",
    serviceExposed: true,
    description: "Accounting Period, การอนุมัติและปิดรอบอย่างเป็นทางการ",
  },
  {
    key: "results-settlement",
    label: "ผลรางวัลและ Settlement",
    capabilities: [],
    serviceExposed: false,
    description: "Result intake / settlement exceptions — ยังไม่มี REST contract",
  },
  {
    key: "members-kyc",
    label: "สมาชิกและ KYC",
    capabilities: [],
    serviceExposed: false,
    description: "KYC / member support — ยังไม่มี REST contract",
  },
  {
    key: "promotions",
    label: "โปรโมชั่น",
    capabilities: [],
    serviceExposed: false,
    description: "Campaign / entitlement — ยังไม่มี REST contract",
  },
  {
    key: "reconciliation",
    label: "Reconciliation",
    capabilities: [],
    serviceExposed: false,
    description: "Discrepancy-first reconciliation — ยังไม่มี REST contract",
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
    description: "รายการที่รอการอนุมัติข้ามพื้นที่ที่ระบบรองรับ",
  },
  {
    key: "system-config",
    label: "ระบบและตั้งค่า",
    href: "/lottery",
    capabilities: ["lottery-configuration.read", "accounting-period.read"],
    readCapability: "lottery-configuration.read",
    serviceExposed: true,
    description: "การตั้งค่าสำคัญแบบ DRAFT → REVIEW → PUBLISHED",
  },
  {
    key: "audit-reports",
    label: "Audit / Reports",
    capabilities: [],
    serviceExposed: false,
    description: "Audit / report read models — ยังไม่มี REST contract",
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
