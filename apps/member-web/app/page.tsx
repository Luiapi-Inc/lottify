"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  memberApi,
  type BetOrder,
  type MemberDraw,
  type WalletBalance,
} from "./lib/member-api";
import {
  describeDrawState,
  describeMemberApiFailure,
  describeOrderState,
  formatBaht,
  formatDateTime,
  sumMinor,
} from "./lib/member-display";

type HomeState =
  | { status: "loading" }
  | { status: "ready"; balance: WalletBalance | null; orders: BetOrder[]; openDraws: MemberDraw[]; partialError: string | null }
  | { status: "failed"; message: string; code: string; correlationId?: string };

export default function HomePage() {
  const [state, setState] = useState<HomeState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [wallet, orderPage, productPage] = await Promise.all([
          memberApi.getWallet(),
          memberApi.listOrders({ limit: 3 }),
          memberApi.listProducts({ limit: 6 }),
        ]);
        // A home summary must degrade per panel rather than blank the page when
        // one of the optional panels (e.g. open Draws) cannot be read.
        let openDraws: MemberDraw[] = [];
        let partialError: string | null = null;
        try {
          const pages = await Promise.all(productPage.items.map((product) => memberApi.listDraws(product.id, { limit: 10 })));
          openDraws = pages.flatMap((page) => page.items).filter((draw) => draw.state === "OPEN").slice(0, 3);
        } catch (drawError) {
          partialError = describeMemberApiFailure(drawError).message;
        }
        if (!active) return;
        setState({ status: "ready", balance: wallet, orders: orderPage.items, openDraws, partialError });
      } catch (error) {
        if (!active) return;
        const failure = describeMemberApiFailure(error);
        setState({ status: "failed", message: failure.message, code: failure.code, correlationId: failure.correlationId });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (state.status === "loading") {
    return <main id="main"><section className="panel"><div className="panel-title"><h2>กำลังโหลดข้อมูลบัญชี</h2></div><p className="muted small">กำลังดึงยอดเงิน งวดที่เปิดรับ และโพยล่าสุดจาก API…</p></section></main>;
  }

  if (state.status === "failed") {
    return <main id="main"><section className="panel"><div className="panel-title"><h2>โหลดหน้าแรกไม่สำเร็จ</h2><span className="status danger">{state.code}</span></div><p className="muted small">{state.message}</p>{state.correlationId && <p className="muted small">รหัสอ้างอิง: {state.correlationId}</p>}</section></main>;
  }

  const { balance, orders, openDraws, partialError } = state;
  const cash = balance?.buckets.find((bucket) => bucket.bucket === "CASH");
  const bonus = balance?.buckets.find((bucket) => bucket.bucket === "BONUS");
  const reservedMinor = sumMinor((balance?.buckets ?? []).map((bucket) => bucket.reservedMinor));

  return <main id="main">
    <div className="wallet-hero">
      <div className="wallet-hero-top"><h2>ยอดเงินในกระเป๋า</h2><Link className="button ghost" href="/wallet">จัดการกระเป๋า →</Link></div>
      <div className="wallet-grid">
        <div className="wallet-cell"><div className="wallet-label">เงินสดที่ใช้ได้</div><div className="wallet-amount">{cash ? formatBaht(cash.availableMinor) : "ยังโหลดไม่ได้"}</div><div className="wallet-actions"><Link className="button secondary" href="/wallet/deposit">เติมเงิน</Link></div></div>
        <div className="wallet-cell"><div className="wallet-label">โบนัสที่ใช้ได้</div><div className="wallet-amount">{bonus ? formatBaht(bonus.availableMinor) : "ยังโหลดไม่ได้"}</div><div className="wallet-actions"><Link className="button secondary" href="/promotions">ดูเงื่อนไข</Link></div></div>
        <div className="wallet-cell"><div className="wallet-label">ยอดที่พักไว้</div><div className="wallet-amount">{formatBaht(reservedMinor)}</div><div className="wallet-actions"><Link className="button secondary" href="/wallet#transactions">ดูรายละเอียด</Link></div></div>
        <div className="wallet-cell"><div className="wallet-label">ยอดที่ถอนได้โดยประมาณ</div><div className="wallet-amount">{cash ? formatBaht(cash.availableMinor) : "ยังโหลดไม่ได้"}</div><div className="wallet-actions"><Link className="button lime" href="/wallet/withdraw">ถอนเงิน</Link></div></div>
      </div>
      {balance && <p className="muted small" style={{ marginTop: 8 }}>ข้อมูล ณ {formatDateTime(balance.dataAsOf)} · ยอดที่ถอนได้จริงถูกตรวจอีกครั้งโดย preflight ก่อนส่งคำขอถอน</p>}
    </div>

    <section className="grid-2" style={{ marginTop: 18 }}>
      <div className="stack">
        <section className="panel"><div className="panel-title"><h2>งวดที่เปิดรับ</h2><Link href="/buy">ดูทั้งหมด →</Link></div>
          {openDraws.length === 0
            ? <div className="notice warning"><b>!</b><div><strong>ยังไม่มีงวดที่เปิดรับ</strong>{partialError ? ` อ่านรายการงวดไม่สำเร็จ: ${partialError}` : " เมื่อมีงวดที่เผยแพร่และเปิดรับ ระบบจะแสดงที่นี่"}</div></div>
            : <div className="draw-list">{openDraws.map((draw) => <div className="draw-row" key={draw.id}><div className="lottery-icon">{draw.localDate.slice(5)}</div><div className="draw-name"><strong>งวด {draw.localDate}</strong><span>สินค้า {draw.productId} · ปิดรับ {formatDateTime(draw.cutoffAt)}</span></div><div className="countdown"><small>สถานะ</small><span>{describeDrawState(draw.state).label}</span></div><Link className="button primary" href={`/buy/bet?drawId=${encodeURIComponent(draw.id)}`}>ซื้อเลย</Link></div>)}</div>}
        </section>
        <section className="panel"><div className="panel-title"><h2>โพยล่าสุดของฉัน</h2><Link href="/slips">ดูทั้งหมด →</Link></div>
          {orders.length === 0
            ? <div className="notice info"><b>i</b><div><strong>ยังไม่มีโพย</strong>เมื่อคุณยืนยันรายการซื้อสำเร็จ โพยจะปรากฏที่นี่</div></div>
            : <div className="activity-list">{orders.map((order) => {
              const status = describeOrderState(order.state);
              return <div className="activity-row" key={order.id}><span>{formatDateTime(order.createdAt)}</span><div><strong>{order.productId}</strong><span className="small muted">{order.lines.map((line) => line.canonicalNumber).join(" · ")} · {order.lines.length} รายการ</span></div><strong>{formatBaht(order.totalStakeMinor)}</strong><span className={`status ${status.tone}`}>{status.label}</span><Link className="text-link" href={`/slips/detail?orderId=${encodeURIComponent(order.id)}`}>ดู →</Link></div>;
            })}</div>}
        </section>
      </div>
      <div className="stack">
        <section className="panel"><div className="panel-title"><h2>ทำรายการต่อ</h2><Link href="/buy">ไปหน้าซื้อหวย →</Link></div><p className="muted small">เริ่มจากเลือกงวดที่เปิดรับ แล้วระบบจะให้กรอกเลขและสร้าง Quote โดยใช้ค่าจริงจากเซิร์ฟเวอร์</p><Link className="button primary" href="/buy" style={{ marginTop: 12 }}>เลือกงวดและซื้อหวย</Link></section>
        <section className="panel" id="alerts"><div className="panel-title"><h2>ทางลัด</h2></div><div className="menu-list">
          <Link className="menu-row" href="/wallet#transactions"><div className="menu-icon">T</div><div><strong>ประวัติรายการกระเป๋า</strong><span>ดูรายการล่าสุดจาก Ledger และกดดูรายละเอียดได้</span></div><span>→</span></Link>
          <Link className="menu-row" href="/promotions"><div className="menu-icon">P</div><div><strong>โปรโมชั่นของฉัน</strong><span>โบนัส ยอดเล่น และเงื่อนไขสิทธิ์ที่มีผล</span></div><span>→</span></Link>
          <Link className="menu-row" href="/account/security"><div className="menu-icon">S</div><div><strong>อุปกรณ์และความปลอดภัย</strong><span>ตรวจและออกจากระบบรายอุปกรณ์</span></div><span>→</span></Link>
        </div></section>
      </div>
    </section>
  </main>;
}
