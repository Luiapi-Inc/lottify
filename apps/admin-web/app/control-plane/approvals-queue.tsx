"use client";

import type { components } from "@lottify/contracts";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminApi, ApiFailure } from "./admin-api";

type AdminMe = components["schemas"]["AdminMeResponse"];
type AccountingPeriod = components["schemas"]["AccountingPeriodResponse"];
type AccountingPeriodList = components["schemas"]["AccountingPeriodListResponse"];

interface LotterySummaryVersion {
  id: string;
  version: number;
  revision: number;
  state: string;
  effectiveFrom: string;
  effectiveUntil?: string | null;
}

interface LotteryItem {
  id: string;
  code?: string;
  versions: LotterySummaryVersion[];
}

export interface ApprovalQueueEntry {
  id: string;
  area: string;
  label: string;
  kind: string;
  state: string;
  detail: string;
  evidence: string | null;
  allowedAction?: string;
  href?: string;
}

function dateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 10)}…` : value;
}

const ACCOUNTING_PERIOD_AREA_HREF = "/accounting-periods";
const LOTTERY_AREA_HREF = "/lottery";

/**
 * Reads the maker-checker queue from the authoritative Admin contracts only
 * (Accounting Period + Lottery Configuration). No entry is synthesised when a
 * contract is missing.
 */
export function useApprovalsQueue(api: AdminApi, admin: AdminMe | null) {
  const [accounts, setAccounts] = useState<AccountingPeriod[]>([]);
  const [reviewItems, setReviewItems] = useState<{
    products: LotteryItem[];
    betTypes: LotteryItem[];
  }>({ products: [], betTypes: [] });
  const [checking, setChecking] = useState(false);
  const [loadError, setLoadError] = useState("");

  const reload = useCallback(async () => {
    if (!admin) return;
    setChecking(true);
    setLoadError("");
    const canReadAccounting = admin.capabilities.includes("accounting-period.read");
    const canReadLottery = admin.capabilities.includes("lottery-configuration.read");
    try {
      if (canReadAccounting) {
        const loadedPeriods: AccountingPeriod[] = [];
        let cursor: string | null = null;
        do {
          const params = new URLSearchParams({ limit: "100" });
          if (cursor) params.set("cursor", cursor);
          const page = await api.request<AccountingPeriodList>(
            `accounting-periods?${params.toString()}`,
          );
          loadedPeriods.push(...page.items);
          cursor = page.nextCursor ?? null;
        } while (cursor);
        setAccounts(loadedPeriods);
      }

      if (canReadLottery) {
        const [products, betTypes] = await Promise.all([
          api
            .request<{ items: LotteryItem[]; nextCursor: string | null }>(
              `lottery/products?limit=100&state=REVIEW`,
            )
            .catch(() => ({ items: [] as LotteryItem[], nextCursor: null })),
          api
            .request<{ items: LotteryItem[]; nextCursor: string | null }>(
              `lottery/bet-types?limit=100&state=REVIEW`,
            )
            .catch(() => ({ items: [] as LotteryItem[], nextCursor: null })),
        ]);
        setReviewItems({ products: products.items, betTypes: betTypes.items });
      }
    } catch (caught) {
      setLoadError(
        caught instanceof ApiFailure
          ? `${caught.message}${caught.correlationId ? ` (${caught.correlationId})` : ""}`
          : caught instanceof Error
            ? caught.message
            : "โหลดข้อมูลไม่สำเร็จ",
      );
    } finally {
      setChecking(false);
    }
  }, [admin, api]);

  useEffect(() => {
    if (admin) void reload();
  }, [admin, reload]);

  const canCancelAccounting = admin?.capabilities.includes("accounting-period.cancel") === true;
  const canCloseAccounting = admin?.capabilities.includes("accounting-period.close") === true;
  const canApproveLottery = admin?.capabilities.includes("lottery-configuration.approve") === true;

  const queue = useMemo<ApprovalQueueEntry[]>(() => {
    const entries: ApprovalQueueEntry[] = [];
    for (const period of accounts) {
      const area = "approvals";
      if (period.state === "PENDING_APPROVAL") {
        entries.push({
          id: period.id,
          area,
          label: `${dateTime(period.effectiveStart)} → ${dateTime(period.effectiveEnd)}`,
          kind: "Custom Accounting Period",
          state: period.state,
          detail: period.reason ?? "Custom Accounting Period รอการอนุมัติ",
          evidence: `Requester ${period.createdByAdminId ? shortId(period.createdByAdminId) : "ไม่ระบุ"} · Version ${period.version}`,
          allowedAction: period.allowedActions.includes("approve") ? "approve" : undefined,
          href: ACCOUNTING_PERIOD_AREA_HREF,
        });
      }
      if (period.state === "SCHEDULED" && period.cancellationRequestedByAdminId) {
        entries.push({
          id: period.id,
          area,
          label: `${dateTime(period.effectiveStart)} → ${dateTime(period.effectiveEnd)}`,
          kind: "Cancellation (SCHEDULED)",
          state: period.state,
          detail: period.cancellationReason ?? "ส่งคำขอยกเลิกช่วง SCHEDULED แล้ว",
          evidence: `ร้องขอโดย ${shortId(period.cancellationRequestedByAdminId)}`,
          allowedAction:
            canCancelAccounting && period.allowedActions.includes("cancel")
              ? "approve-cancel"
              : undefined,
          href: ACCOUNTING_PERIOD_AREA_HREF,
        });
      }
      if (period.state === "CLOSING" && period.closeRequestedByAdminId) {
        entries.push({
          id: period.id,
          area,
          label: `${dateTime(period.effectiveStart)} → ${dateTime(period.effectiveEnd)}`,
          kind: "Period Close (CLOSING)",
          state: period.state,
          detail: period.closeReason ?? "รอการอนุมัติปิดรอบบัญชี",
          evidence: `ร้องขอปิดโดย ${shortId(period.closeRequestedByAdminId)}`,
          allowedAction:
            canCloseAccounting && period.allowedActions.includes("close") ? "close" : undefined,
          href: ACCOUNTING_PERIOD_AREA_HREF,
        });
      }
    }
    for (const item of reviewItems.products) {
      for (const version of item.versions) {
        if (version.state !== "REVIEW") continue;
        entries.push({
          id: `${item.id}:${version.id}`,
          area: "approvals",
          label: `Lottery Product ${item.id.slice(0, 8)}…`,
          kind: "Product Version",
          state: version.state,
          detail: `v${version.version} · revision ${version.revision}`,
          evidence: `เริ่มใช้ ${dateTime(version.effectiveFrom)}`,
          allowedAction: canApproveLottery ? "approve" : undefined,
          href: LOTTERY_AREA_HREF,
        });
      }
    }
    for (const item of reviewItems.betTypes) {
      for (const version of item.versions) {
        if (version.state !== "REVIEW") continue;
        entries.push({
          id: `${item.id}:${version.id}`,
          area: "approvals",
          label: `Bet Type ${item.code ?? item.id.slice(0, 8)}`,
          kind: "Bet Type Version",
          state: version.state,
          detail: `v${version.version} · revision ${version.revision}`,
          evidence: `เริ่มใช้ ${dateTime(version.effectiveFrom)}`,
          allowedAction: canApproveLottery ? "approve" : undefined,
          href: LOTTERY_AREA_HREF,
        });
      }
    }
    return entries;
  }, [accounts, reviewItems, canCancelAccounting, canCloseAccounting, canApproveLottery]);

  const openItems = useMemo(() => queue.filter((entry) => entry.allowedAction), [queue]);
  const awaitingItems = useMemo(() => queue.filter((entry) => !entry.allowedAction), [queue]);

  return { openItems, awaitingItems, queue, checking, loadError, reload };
}

export type ApprovalsQueueState = ReturnType<typeof useApprovalsQueue>;

/** Maker-checker queue as it appears on the overview and on `/approvals`. */
export function ApprovalsSection({ queue }: { queue: ApprovalsQueueState }) {
  const { openItems, awaitingItems, checking, loadError, reload } = queue;

  return (
    <>
      <button type="button" className="cp-refresh" onClick={() => void reload()} disabled={checking}>
        {checking ? "กำลังโหลด…" : "รีเฟรช"}
      </button>

      {loadError ? (
        <div className="cp-error" role="alert">
          <strong>ไม่สามารถโหลดข้อมูลได้</strong>
          <span>{loadError}</span>
          <button type="button" onClick={() => void reload()}>
            ลองอีกครั้ง
          </button>
        </div>
      ) : null}

      <section aria-labelledby="approval-heading" className="cp-section">
        <div className="cp-section-heading">
          <div>
            <h2 id="approval-heading">รอการอนุมัติ / ตรวจสอบ</h2>
            <p>
              รายการที่รอการตรวจสอบตาม maker-checker — คิวที่ระบบให้สิทธิ์คุณ
              ดำเนินการได้จริงแสดงก่อน ส่วนรายการที่รอผู้มีสิทธิ์รายอื่นแยกไว้ด้านล่าง
            </p>
          </div>
        </div>
        <WorkQueue
          title="คิวที่คุณดำเนินการได้"
          items={openItems}
          loading={checking}
          emptyTitle="ไม่มีรายการที่คุณดำเนินการได้"
        />
        {awaitingItems.length > 0 ? (
          <WorkQueue
            title="รอผู้มีสิทธิ์รายอื่นดำเนินการ (maker-checker)"
            items={awaitingItems}
            loading={false}
            emptyTitle="ไม่มีรายการที่รอผู้มีสิทธิ์รายอื่น"
          />
        ) : null}
      </section>
    </>
  );
}

function WorkQueue({
  title,
  items,
  loading,
  emptyTitle,
}: {
  title?: string;
  items: ApprovalQueueEntry[];
  loading: boolean;
  emptyTitle?: string;
}) {
  if (loading) {
    return <p className="cp-empty">กำลังโหลดคิว…</p>;
  }
  if (items.length === 0) {
    return (
      <div className="cp-empty-state">
        {title ? <h3>{title}</h3> : <h3>{emptyTitle ?? "ไม่มีรายการ"}</h3>}
        <p>ไม่พบรายการที่รอการดำเนินการในคิวนี้</p>
      </div>
    );
  }
  return (
    <div className="cp-queue">
      {title ? <h3 className="cp-queue-title">{title}</h3> : null}
      {items.map((item) => (
        <article className="cp-queue-item" key={item.id}>
          <div className="cp-queue-summary">
            <div>
              <span className={`cp-state cp-state-${item.state.toLowerCase()}`}>{item.state}</span>
              <h4>{item.label}</h4>
              <p className="cp-queue-kind">
                {item.kind} · {item.detail}
              </p>
            </div>
            {item.href ? (
              <Link className="cp-queue-action" href={item.href}>
                เปิดคิว →
              </Link>
            ) : null}
          </div>
          <dl className="cp-queue-evidence">
            <div>
              <dt>หลักฐาน / เหตุผล</dt>
              <dd>{item.detail}</dd>
            </div>
            <div>
              <dt>รายละเอียดอ้างอิง</dt>
              <dd>{item.evidence ?? "—"}</dd>
            </div>
            <div>
              <dt>คำสั่งที่อนุญาต</dt>
              <dd>{item.allowedAction ?? (item.href ? "รอผู้มีสิทธิ์รายอื่น" : "—")}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}
