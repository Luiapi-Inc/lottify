"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MemberApiFailure, memberApi, type MemberDraw } from "../lib/member-api";
import { formatDateTime, formatRemaining, productLabel, shortId } from "./live-data";

export default function BuyPage() {
  const router = useRouter();
  const [draws, setDraws] = useState<MemberDraw[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const catalog = await memberApi.listProducts();
        const pages = await Promise.all(
          catalog.items.map((product) => memberApi.listProductDraws(product.id, "OPEN")),
        );
        if (!active) return;
        setDraws(
          pages
            .flatMap((page) => page.items)
            .filter((draw) => draw.state === "OPEN")
            .sort((left, right) => left.cutoffAt.localeCompare(right.cutoffAt)),
        );
      } catch (caught) {
        if (!active) return;
        if (caught instanceof MemberApiFailure && caught.code === "SESSION_REQUIRED") {
          router.replace("/login");
          return;
        }
        setError(caught instanceof Error ? caught.message : "โหลดงวดที่เปิดรับไม่สำเร็จ");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [router]);

  return <main id="main">
    <div className="page-head"><div><div className="breadcrumb"><Link href="/">หน้าแรก</Link><span>/</span><span>ซื้อหวย</span></div><h1>เลือกหวยและงวด</h1><p>เลือกงวดที่ยังเปิดรับ ระบบจะแสดงเวลาปิดรับและประเภทเดิมพันจากข้อมูลล่าสุดของงวด</p></div></div>
    <div className="stepper"><div className="step active"><strong>1 · เลือกงวด</strong>Product และ Draw</div><div className="step"><strong>2 · ใส่เลข</strong>Bet Type และจำนวนเงิน</div><div className="step"><strong>3 · ตรวจ Quote</strong>ราคาและข้อจำกัด</div><div className="step"><strong>4 · ยืนยัน</strong>รับใบรับรายการ</div></div>

    {error ? <div className="notice warning" role="alert"><b>!</b><div><strong>โหลดงวดไม่สำเร็จ</strong>{error}</div></div> : null}

    <section className="grid-2">
      <div className="panel"><div className="panel-title"><h2>งวดที่เปิดรับ</h2>{!loading && <span className="status success">เปิดรับ {draws.length} งวด</span>}</div><div className="product-list">
        {loading ? <p role="status">กำลังโหลดงวดที่เปิดรับ…</p> : draws.length ? draws.map((draw) => <Link className="product-card" href={`/buy/bet?drawId=${encodeURIComponent(draw.id)}`} key={draw.id}><div className="lottery-icon">L</div><div><h3>{productLabel(draw.productId)}</h3><p>งวด {draw.localDate} · ปิดรับ {formatDateTime(draw.cutoffAt, draw.timezone)} · {draw.timezone}</p><span className="small muted">Draw {shortId(draw.id)} · {draw.betTypes.length} ประเภทเดิมพัน</span></div><div className="product-meta"><div className="countdown"><small>ปิดรับใน</small>{formatRemaining(draw.cutoffAt, draw.serverNow)}</div><span className="button primary">เลือกงวด</span></div></Link>) : <div className="notice info"><b>i</b><div><strong>ยังไม่มีงวดที่เปิดรับ</strong>เมื่อ Draw อยู่ในสถานะ OPEN ระบบจะแสดงที่หน้านี้โดยอัตโนมัติ</div></div>}
      </div></div>
      <aside className="stack"><section className="panel"><div className="panel-title"><h2>ก่อนเลือกงวด</h2></div><div className="notice info"><b>i</b><div><strong>เวลาปิดรับเป็นเวลาที่ระบบยืนยัน</strong>เมื่อถึง cutoff จะไม่สามารถสร้าง Quote หรือยืนยันรายการใหม่ได้</div></div><div className="notice warning" style={{ marginTop: 10 }}><b>!</b><div><strong>อัตราจ่ายอาจเปลี่ยนก่อน Quote</strong>คุณจะเห็นอัตราจ่ายที่ระบบยอมรับจริงอีกครั้งในหน้าตรวจ Quote</div></div></section></aside>
    </section>
  </main>;
}
