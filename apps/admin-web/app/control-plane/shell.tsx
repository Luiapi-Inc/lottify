"use client";

import type { components } from "@lottify/contracts";
import Link from "next/link";
import type { ReactNode } from "react";
import { AdminApi } from "./admin-api";
import { NAVIGATION_AREAS, hasAnyCapability, roleLabel } from "./navigation";

type AdminMe = components["schemas"]["AdminMeResponse"];

/**
 * Best-effort Admin sign-out. The login/dashboard routes all use it so the
 * behaviour cannot drift per route: the API call may fail, the local session
 * is cleared either way.
 */
export function adminLogout(api: AdminApi, reload: () => Promise<void>) {
  return async (): Promise<void> => {
    try {
      await api.publicRequest("auth/logout");
    } catch {
      // Logout is best-effort; clear the local session regardless.
    }
    api.clear();
    await reload();
  };
}

/**
 * The single Admin chrome for every Admin route. Before this component existed
 * each route shipped its own sidebar (control plane `cp-shell`,
 * accounting-period `admin-shell`, lottery `lot-shell`), so the same session
 * saw different navigation depending on the URL.
 */
export function AdminShell({
  admin,
  activeKey,
  onLogout,
  breadcrumb,
  title,
  subtitle,
  extraClassName,
  children,
}: {
  admin: AdminMe;
  activeKey: string;
  onLogout: () => void;
  breadcrumb: string;
  title: string;
  subtitle?: string;
  /** Extra class on the shell root so a route can keep its own CSS scope. */
  extraClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className={extraClassName ? `cp-shell ${extraClassName}` : "cp-shell"}>
      <AdminSidebar admin={admin} activeKey={activeKey} onLogout={onLogout} />
      <main className="cp-main">
        <header className="cp-topbar">
          <div>
            <p className="cp-breadcrumb">{breadcrumb}</p>
            <h1>{title}</h1>
            {subtitle ? <p className="cp-subtitle">{subtitle}</p> : null}
          </div>
          <div className="cp-identity">
            <strong>{admin.name}</strong>
            <span>{roleLabel(admin.role)}</span>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

/**
 * Sidebar shared by every Admin route. Items without a real route are rendered
 * as explicitly unavailable ("รอ API" / "รอหน้าจอ" / "ไม่มีสิทธิ์") instead of
 * pointing at an unrelated page.
 */
export function AdminSidebar({
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
            area.serviceExposed && area.uiExposed && Boolean(area.href) && permitted;
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
          if (clickable && area.href) {
            return (
              <Link
                key={area.key}
                className={isActive ? "cp-nav-item cp-nav-item-active" : "cp-nav-item"}
                href={area.href}
                aria-current={isActive ? "page" : undefined}
              >
                {inner}
              </Link>
            );
          }
          return (
            <span
              key={area.key}
              className={
                isActive
                  ? "cp-nav-item cp-nav-item-disabled cp-nav-item-active"
                  : "cp-nav-item cp-nav-item-disabled"
              }
              title={
                !area.serviceExposed
                  ? "Service ยังไม่มี REST contract ใน checkpoint นี้"
                  : !area.uiExposed
                    ? "มี REST contract แล้ว แต่ยังไม่มีหน้าจอปฏิบัติการ"
                    : "คุณไม่มีสิทธิ์เปิดพื้นที่นี้"
              }
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
