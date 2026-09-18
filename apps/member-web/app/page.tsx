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

  return <main id="main" className="home-stage">
    <section className="home-intro" aria-labelledby="home-heading">
      <div className="home-intro-copy">
        <div className="home-kicker">LOTTIFY MEMBER · THB</div>
        <h1 id="home-heading">ทุกงวด ทุกโพย และทุกยอดเงิน อยู่ในที่เดียว</h1>
        <p>เลือกงวดจากสถานะจริงของระบบ ตรวจ Quote ก่อนยืนยัน และติดตามโพยกับกระเป๋าจากข้อมูลล่าสุดของบัญชี</p>
        <div className="home-primary-actions">
          <Link className="button primary" href="/buy">เลือกงวดและซื้อหวย</Link>
          <Link className="button secondary" href="/slips">ดูโพยของฉัน</Link>
        </div>
      </div>
      <div className="home-balance" aria-label="สรุปกระเป๋า">
        <div className="home-balance-label">เงินสดที่ใช้ได้</div>
        <div className="home-balance-amount">{cash ? formatBaht(cash.availableMinor) : "ยังโหลดไม่ได้"}</div>
        <div className="home-balance-meta">
          <div><span>โบนัสที่ใช้ได้</span><strong>{bonus ? formatBaht(bonus.availableMinor) : "—"}</strong></div>
          <div><span>ยอดที่พักไว้</span><strong>{formatBaht(reservedMinor)}</strong></div>
        </div>
        {balance && <p className="small" style={{ margin: "14px 0 0", color: "rgba(248,244,233,.54)" }}>ข้อมูล ณ {formatDateTime(balance.dataAsOf)}</p>}
      </div>
    </section>

    <section className="home-ledger">
      <div className="stack">
        <section className="home-section">
          <div className="home-section-head"><h2>งวดที่เปิดรับ</h2><Link href="/buy">ดูทั้งหมด →</Link></div>
          {openDraws.length === 0
            ? <div className="notice warning"><b>!</b><div><strong>ยังไม่มีงวดที่เปิดรับ</strong>{partialError ? ` อ่านรายการงวดไม่สำเร็จ: ${partialError}` : " เมื่อมีงวดที่เผยแพร่และเปิดรับ ระบบจะแสดงที่นี่"}</div></div>
            : <div>{openDraws.map((draw) => {
              const status = describeDrawState(draw.state);
              return <div className="home-draw-row" key={draw.id}>
                <div className="home-draw-date">{draw.localDate.slice(5)}</div>
                <div className="home-draw-name"><strong>งวด {draw.localDate}</strong><span>สินค้า {draw.productId} · ปิดรับ {formatDateTime(draw.cutoffAt)}</span></div>
                <span className={`status ${status.tone}`}>{status.label}</span>
                <Link className="button primary" href={`/buy/bet?drawId=${encodeURIComponent(draw.id)}`}>ซื้อเลย</Link>
              </div>;
            })}</div>}
        </section>

        <section className="home-section">
          <div className="home-section-head"><h2>โพยล่าสุด</h2><Link href="/slips">ดูทั้งหมด →</Link></div>
          {orders.length === 0
            ? <div className="notice info"><b>i</b><div><strong>ยังไม่มีโพย</strong>เมื่อคุณยืนยันรายการซื้อสำเร็จ โพยจะปรากฏที่นี่</div></div>
            : <div>{orders.map((order) => {
              const status = describeOrderState(order.state);
              return <div className="home-slip-row" key={order.id}>
                <span>{formatDateTime(order.createdAt)}</span>
                <div><strong>{order.productId}</strong><span className="small muted">{order.lines.map((line) => line.canonicalNumber).join(" · ")} · {order.lines.length} รายการ</span></div>
                <strong>{formatBaht(order.totalStakeMinor)}</strong>
                <span className={`status ${status.tone}`}>{status.label}</span>
                <Link className="text-link" href={`/slips/detail?orderId=${encodeURIComponent(order.id)}`}>ดู →</Link>
              </div>;
            })}</div>}
        </section>
      </div>

      <aside className="home-aside">
        <section className="home-aside-block ticket">
          <h2>กระเป๋าของฉัน</h2>
          <p>ยอดถอนจริงจะถูกตรวจด้วย withdrawal preflight ก่อนส่งคำขอทุกครั้ง</p>
          <div className="home-primary-actions">
            <Link className="button secondary" href="/wallet/deposit">เติมเงิน</Link>
            <Link className="button primary" href="/wallet/withdraw">ถอนเงิน</Link>
          </div>
        </section>
        <section className="home-aside-block" id="alerts">
          <h2>ทางลัด</h2>
          <div className="home-shortcuts">
            <Link className="home-shortcut" href="/wallet#transactions"><b>01</b><div><strong>ประวัติกระเป๋า</strong><span>รายการเงินล่าสุดและรายละเอียด</span></div><span>→</span></Link>
            <Link className="home-shortcut" href="/promotions"><b>02</b><div><strong>โปรโมชั่นของฉัน</strong><span>โบนัส ยอดเล่น และเงื่อนไขสิทธิ์</span></div><span>→</span></Link>
            <Link className="home-shortcut" href="/account/security"><b>03</b><div><strong>ความปลอดภัย</strong><span>เซสชัน อุปกรณ์ และการออกจากระบบ</span></div><span>→</span></Link>
          </div>
        </section>
      </aside>
    </section>
  </main>;
}
