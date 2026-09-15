"use client";

import type { components } from "@lottify/contracts";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminApi, ApiFailure } from "./admin-api";
import { AdminLogin, useAdminSession } from "./login";
import {
  NAVIGATION_AREAS,
  hasAnyCapability,
  roleLabel,
} from "./navigation";

type AdminMe = components["schemas"]["AdminMeResponse"];
type AccountingPeriod = components["schemas"]["AccountingPeriodResponse"];
type AccountingPeriodList = components["schemas"]["AccountingPeriodListResponse"];

type Capability = AdminMe["capabilities"][number];

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

interface OverviewSource {
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

export default function OverviewPage() {
  const [api] = useState(() => new AdminApi());
  const { admin, booting, loadMe } = useAdminSession(api);
  const [loadError, setLoadError] = useState("");
  const [accounts, setAccounts] = useState<AccountingPeriod[]>([]);
  const [reviewItems, setReviewItems] = useState<{
    products: LotteryItem[];
    betTypes: LotteryItem[];
  }>({ products: [], betTypes: [] });
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    void loadMe().catch(() => {
      api.clear();
    });
  }, [api, loadMe]);

  const can = useCallback(
    (capability: Capability) =>
      admin?.capabilities.includes(capability) === true,
    [admin],
  );

  const loadWork = useCallback(async () => {
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
    if (admin) void loadWork();
  }, [admin, loadWork]);

  const canCancelAccounting = can("accounting-period.cancel");
  const canCloseAccounting = can("accounting-period.close");
  const canApproveLottery = can("lottery-configuration.approve");

  const approvalsQueue = useMemo<OverviewSource[]>(() => {
    const entries: OverviewSource[] = [];
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
          allowedAction: period.allowedActions.includes("approve")
            ? "approve"
            : undefined,
          href: ACCOUNTING_PERIOD_AREA_HREF,
        });
      }
      if (
        period.state === "SCHEDULED" &&
        period.cancellationRequestedByAdminId
      ) {
        entries.push({
          id: period.id,
          area,
          label: `${dateTime(period.effectiveStart)} → ${dateTime(period.effectiveEnd)}`,
          kind: "Cancellation (SCHEDULED)",
          state: period.state,
          detail: period.cancellationReason ?? "ส่งคำขอยกเลิกช่วง SCHEDULED แล้ว",
          evidence: `ร้องขอโดย ${shortId(period.cancellationRequestedByAdminId)}`,
          allowedAction: canCancelAccounting &&
            period.allowedActions.includes("cancel")
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
          allowedAction: canCloseAccounting &&
            period.allowedActions.includes("close")
            ? "close"
            : undefined,
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
  }, [
    accounts,
    reviewItems,
    canCancelAccounting,
    canCloseAccounting,
    canApproveLottery,
  ]);

  const openItems = useMemo<OverviewSource[]>(
    () => approvalsQueue.filter((entry) => entry.allowedAction),
    [approvalsQueue],
  );

  const awaitingItems = useMemo<OverviewSource[]>(
    () => approvalsQueue.filter((entry) => !entry.allowedAction),
    [approvalsQueue],
  );

  if (booting) {
    return (
      <main className="cp-center">
        <p role="status">กำลังตรวจสอบ Admin session…</p>
      </main>
    );
  }

  if (!admin) {
    return (
      <main className="cp-center">
        <AdminLogin api={api} onLogin={async () => void loadMe()} />
      </main>
    );
  }

  return (
    <div className="cp-shell">
      <ControlPlaneNav admin={admin} activeKey="overview" onLogout={logout(api, loadMe)} />
      <main className="cp-main">
        <header className="cp-topbar">
          <div>
            <p className="cp-breadcrumb">ภาพรวมปฏิบัติงาน</p>
            <h1>ภาพรวม</h1>
            <p className="cp-subtitle">
              งานที่รอการดำเนินการและจุดเข้าคิวของแต่ละพื้นที่ · ข้อมูลจากสัญญา API ที่มีจริง
              เท่านั้น ไม่มีการสร้างตัวเลขขึ้นเอง
            </p>
          </div>
          <div className="cp-identity">
            <strong>{admin.name}</strong>
            <span>{roleLabel(admin.role)}</span>
          </div>
        </header>

        <button type="button" className="cp-refresh" onClick={() => void loadWork()} disabled={checking}>
          {checking ? "กำลังโหลด…" : "รีเฟรช"}
        </button>

        {loadError ? (
          <div className="cp-error" role="alert">
            <strong>ไม่สามารถโหลดข้อมูลได้</strong>
            <span>{loadError}</span>
            <button type="button" onClick={() => void loadWork()}>
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

        <section aria-labelledby="areas-heading" className="cp-section">
          <div className="cp-section-heading">
            <div>
              <h2 id="areas-heading">พื้นที่ปฏิบัติงานตามความรับผิดชอบ</h2>
              <p>
                แต่ละพื้นที่แสดงสถานะของ service ที่แท้จริงบน checkpoint นี้
                ระบบที่ยังไม่มี API จะแสดงสถานะไม่พร้อมใช้งานโดยไม่สร้างข้อมูลแทน
              </p>
            </div>
          </div>
          <div className="cp-area-grid">
            {NAVIGATION_AREAS.filter((area) => area.key !== "overview").map((area) => {
              const permitted = hasAnyCapability(admin.capabilities, area.capabilities);
              const live =
                area.serviceExposed && area.uiExposed && (area.href || area.key === "approvals");
              return (
                <AreaCard
                  key={area.key}
                  label={area.label}
                  description={area.description}
                  href={area.href ?? (area.key === "approvals" ? "/" : undefined)}
                  exposed={area.serviceExposed}
                  uiExposed={area.uiExposed}
                  permitted={permitted}
                  active={area.key === "approvals" && approvalsQueue.length > 0}
                />
              );
            })}
          </div>
        </section>

        {!can("accounting-period.read") &&
        !can("lottery-configuration.read") ? (
          <section aria-labelledby="ro-heading" className="cp-section">
            <div className="cp-section-heading">
              <h2 id="ro-heading">บทบาทของคุณ</h2>
            </div>
            <p className="cp-note">
              session นี้ไม่มีสิทธิ์อ่านพื้นที่ที่มีข้อมูลจริงใน checkpoint นี้
              (Accounting Period / Lottery Configuration) หากต้องการเปิดข้อมูล
              ให้ติดต่อผู้ดูแลระบบเพื่อเพิ่ม capability
            </p>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function logout(api: AdminApi, loadMe: () => Promise<void>) {
  return async () => {
    try {
      await api.publicRequest("auth/logout");
    } catch {
      // Logout is best-effort; clear the local session regardless.
    }
    api.clear();
    await loadMe();
  };
}

function ControlPlaneNav({
  admin,
  activeKey,
  onLogout,
}: {
  admin: AdminMe;
  activeKey: string;
  onLogout: () => void;
}) {
  return (
    <aside className="cp-sidebar" aria-label="Admin navigation">
      <div className="cp-brand">
        <span className="cp-brand-mark" aria-hidden="true">
          L
        </span>
        <span>Lottify Admin</span>
      </div>
      <p className="cp-nav-label">พื้นที่ปฏิบัติงาน</p>
      <nav>
        {NAVIGATION_AREAS.map((area) => {
          const permitted = hasAnyCapability(admin.capabilities, area.capabilities);
          const isActive = area.key === activeKey;
          const clickable =
            area.serviceExposed && area.uiExposed && (area.href || area.key === "approvals") && permitted;
          const inner = (
            <>
              <span className="cp-nav-label-text">{area.label}</span>
              {!area.serviceExposed ? (
                <span className="cp-nav-tag cp-nav-tag-warn">รอ API</span>
              ) : !area.uiExposed ? (
                <span className="cp-nav-tag cp-nav-tag-warn">รอหน้าจอ</span>
              ) : permitted ? null : (
                <span className="cp-nav-tag">ไม่มีสิทธิ์</span>
              )}
            </>
          );
          if (clickable) {
            const href = area.href ?? (area.key === "approvals" ? "/" : undefined);
            if (href) {
              return (
                <Link
                  key={area.key}
                  className={isActive ? "cp-nav-item cp-nav-item-active" : "cp-nav-item"}
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                >
                  {inner}
                </Link>
              );
            }
          }
          return (
            <span
              key={area.key}
              className={
                isActive ? "cp-nav-item cp-nav-item-disabled cp-nav-item-active" : "cp-nav-item cp-nav-item-disabled"
              }
              title={!area.serviceExposed ? "Service ยังไม่มี REST contract ใน checkpoint นี้" : !area.uiExposed ? "มี REST contract แล้ว แต่ยังไม่มีหน้าจอปฏิบัติการ" : "คุณไม่มีสิทธิ์เปิดพื้นที่นี้"}
            >
              {inner}
            </span>
          );
        })}
      </nav>
      <div className="cp-sidebar-foot">
        <div className="cp-nav-user">
          <strong>{admin.name}</strong>
          <span>{admin.email}</span>
          <small>{roleLabel(admin.role)}</small>
        </div>
        <button type="button" onClick={onLogout}>
          ออกจากระบบ
        </button>
      </div>
    </aside>
  );
}

function AreaCard({
  label,
  description,
  href,
  exposed,
  uiExposed,
  permitted,
  active,
}: {
  label: string;
  description: string;
  href?: string;
  exposed: boolean;
  uiExposed: boolean;
  permitted: boolean;
  active: boolean;
}) {
  const disabled = !exposed || !uiExposed || !permitted;
  const tag = !exposed
    ? "Service ยังไม่พร้อม"
    : !uiExposed
      ? "มี API แต่ยังไม่มีหน้าจอ"
    : !permitted
      ? "ไม่มีสิทธิ์"
      : active
        ? "มีงานรอ"
        : "พร้อมใช้งาน";
  const body = (
    <div className={disabled ? "cp-area-card cp-area-card-disabled" : "cp-area-card"}>
      <div className="cp-area-head">
        <h3>{label}</h3>
        <span
          className={
            !exposed || !uiExposed
              ? "cp-tag cp-tag-warn"
              : !permitted
                ? "cp-tag"
                : active
                  ? "cp-tag cp-tag-alert"
                  : "cp-tag cp-tag-ok"
          }
        >
          {tag}
        </span>
      </div>
      <p>{description}</p>
    </div>
  );
  if (disabled || !href) return body;
  return <Link className="cp-area-link" href={href}>{body}</Link>;
}

function WorkQueue({
  title,
  items,
  loading,
  emptyTitle,
}: {
  title?: string;
  items: OverviewSource[];
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
              <span className={`cp-state cp-state-${item.state.toLowerCase()}`}>
                {item.state}
              </span>
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
              <dd>
                {item.allowedAction ??
                  (item.href ? "รอผู้มีสิทธิ์รายอื่น" : "—")}
              </dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}
