"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  memberApi,
  type MemberDraw,
  type MemberProductSummary,
} from "../lib/member-api";
import { describeDrawState, describeMemberApiFailure, formatDateTime } from "../lib/member-display";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; products: MemberProductSummary[]; draws: MemberDraw[] }
  | { status: "failed"; message: string; code: string; correlationId?: string };

const PRODUCT_LIMIT = 20;

export default function BuyPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const page = await memberApi.listProducts({ limit: PRODUCT_LIMIT });
        // Draws are addressed per Product, so discovery fans out one call per
        // published Product. The API stays the only source of what is on sale.
        const perProduct = await Promise.all(
          page.items.map((product) => memberApi.listDraws(product.id, { limit: 20 })),
        );
        if (!active) return;
        setState({ status: "ready", products: page.items, draws: perProduct.flatMap((draws) => draws.items) });
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

  const openDraws = useMemo(
    () => (state.status === "ready" ? state.draws.filter((draw) => draw.state === "OPEN") : []),
    [state],
  );

  return <main id="main">
    <div className="page-head"><div><div className="breadcrumb"><Link href="/">หน้าแรก</Link><span>/</span><span>ซื้อหวย</span></div><h1>เลือกหวยและงวด</h1><p>งวดที่แสดงคือเฉพาะงวดที่ระบบเผยแพร่และยังเปิดรับจริง เลือกงวดเพื่อกรอกเลขและสร้าง Quote</p></div></div>
    <div className="stepper"><div className="step active"><strong>1 · เลือกงวด</strong>Product และ Draw</div><div className="step"><strong>2 · ใส่เลข</strong>Bet Type และจำนวนเงิน</div><div className="step"><strong>3 · ตรวจ Quote</strong>ราคาและแหล่งเงิน</div><div className="step"><strong>4 · ยืนยัน</strong>รับใบรับรายการ</div></div>

    {state.status === "loading" && <section className="panel"><div className="panel-title"><h2>กำลังโหลดงวดที่เปิดรับ</h2></div><p className="muted small">กำลังดึงรายการสินค้าและงวดจาก API…</p></section>}

    {state.status === "failed" && <section className="panel"><div className="panel-title"><h2>โหลดรายการงวดไม่สำเร็จ</h2><span className="status danger">{state.code}</span></div><p className="muted small">{state.message}</p>{state.correlationId && <p className="muted small">รหัสอ้างอิงสำหรับแจ้งเจ้าหน้าที่: {state.correlationId}</p>}</section>}

    {state.status === "ready" && <section className="grid-2">
      <div className="panel"><div className="panel-title"><h2>งวดที่เปิดรับ</h2><span className="status success">เปิดรับ {openDraws.length} งวด</span></div>
        {openDraws.length === 0
          ? <div className="notice warning"><b>!</b><div><strong>ยังไม่มีงวดที่เปิดรับ</strong>เมื่อมีงวดที่เผยแพร่และเปิดรับ ระบบจะแสดงที่นี่โดยดึงจาก API ทุกครั้ง</div></div>
          : <div className="product-list">
            {openDraws.map((draw) => <Link className="product-card" href={`/buy/bet?drawId=${encodeURIComponent(draw.id)}`} key={draw.id}>
              <div className="lottery-icon">{draw.localDate.slice(5)}</div>
              <div><h3>งวด {draw.localDate}</h3><p>สินค้า {draw.productId} · {draw.timezone} · ปิดรับ {formatDateTime(draw.cutoffAt)}</p></div>
              <div className="product-meta"><div className="countdown">{describeDrawState(draw.state).label}</div><span className="button primary">เลือกงวด</span></div>
            </Link>)}
          </div>}
      </div>
      <aside className="stack">
        <section className="panel"><div className="panel-title"><h2>ก่อนเลือกงวด</h2></div>
          <div className="notice info"><b>i</b><div><strong>เวลาปิดรับเป็นเวลาที่ระบบยืนยัน</strong>เมื่อถึง cutoff ระบบจะไม่รับการสร้าง Quote หรือการยืนยันรายการใหม่</div></div>
          <div className="notice warning" style={{ marginTop: 10 }}><b>!</b><div><strong>อัตราจ่ายอาจเปลี่ยนก่อน Quote</strong>อัตราจ่ายที่ใช้จริงคือค่าที่เซิร์ฟเวอร์คืนมาในหน้าตรวจ Quote เท่านั้น</div></div>
        </section>
        <section className="panel"><div className="panel-title"><h2>สินค้าที่เผยแพร่</h2><span className="muted small">{state.products.length} รายการ</span></div>
          {state.products.length === 0
            ? <p className="muted small">ยังไม่มีสินค้าที่เผยแพร่ให้ Member เห็น</p>
            : <div className="menu-list">{state.products.map((product) => <div className="menu-row" key={product.id}><div className="menu-icon">P</div><div><strong>{product.id}</strong><span>{product.versions.length} เวอร์ชันที่เผยแพร่</span></div></div>)}</div>}
        </section>
        <section className="panel"><div className="panel-title"><h2>โพยของฉัน</h2><Link href="/slips">ดูทั้งหมด →</Link></div><p className="muted small">ตรวจรายการที่ยืนยันแล้ว ยกเลิก และดูผลได้จากหน้าโพยของฉัน</p></section>
      </aside>
    </section>}
  </main>;
}
