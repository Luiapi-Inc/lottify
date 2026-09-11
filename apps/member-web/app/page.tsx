"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  MemberApiFailure,
  memberApi,
  type BetOrderList,
  type MemberDraw,
  type PromotionDiscovery,
  type WalletBalance,
} from "./lib/member-api";
import {
  formatDateTime,
  formatMinor,
  formatRemaining,
  productLabel,
  shortId,
} from "./buy/live-data";

function orderStatus(state: string): { label: string; tone: string } {
  switch (state) {
    case "CONFIRMED": return { label: "ยืนยันแล้ว", tone: "info" };
    case "SETTLED": return { label: "ประมวลผลแล้ว", tone: "success" };
    case "CANCELLED": return { label: "ยกเลิกแล้ว", tone: "neutral" };
    case "CANCELLING": return { label: "กำลังยกเลิก", tone: "warning" };
    case "REJECTED": return { label: "ไม่ผ่าน", tone: "warning" };
    case "EXPIRED": return { label: "หมดอายุ", tone: "neutral" };
    case "CONFIRMING": return { label: "กำลังยืนยัน", tone: "info" };
    default: return { label: state, tone: "info" };
  }
}

export default function HomePage() {
  const router = useRouter();
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [orders, setOrders] = useState<BetOrderList | null>(null);
  const [promotions, setPromotions] = useState<PromotionDiscovery | null>(null);
  const [draws, setDraws] = useState<MemberDraw[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      setLoading(true);
      setError("");
      try {
        const [walletResult, orderResult, promotionResult, catalog] = await Promise.all([
          memberApi.getWallet(),
          memberApi.getOrders(3),
          memberApi.getPromotions(),
          memberApi.listProducts(),
        ]);
        const drawPages = await Promise.all(
          catalog.items.map((product) => memberApi.listProductDraws(product.id, "OPEN")),
        );
        if (!active) return;
        setWallet(walletResult);
        setOrders(orderResult);
        setPromotions(promotionResult);
        setDraws(
          drawPages
            .flatMap((page) => page.items)
            .filter((draw) => draw.state === "OPEN")
            .sort((left, right) => left.cutoffAt.localeCompare(right.cutoffAt))
            .slice(0, 3),
        );
      } catch (caught) {
        if (!active) return;
        if (caught instanceof MemberApiFailure && caught.code === "SESSION_REQUIRED") {
          router.replace("/login");
          return;
        }
        setError(caught instanceof Error ? caught.message : "โหลดหน้าแรกไม่สำเร็จ");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadDashboard();
    return () => {
      active = false;
    };
  }, [router]);

  const balances = useMemo(() => {
    const buckets = new Map((wallet?.buckets ?? []).map((bucket) => [bucket.bucket, bucket]));
    const cash = buckets.get("CASH");
    const bonus = buckets.get("BONUS");
    const reservedMinor = (wallet?.buckets ?? []).reduce(
      (sum, bucket) => sum + BigInt(bucket.reservedMinor),
      0n,
    );
    return {
      cashPosted: cash?.postedMinor ?? "0",
      cashAvailable: cash?.availableMinor ?? "0",
      bonusAvailable: bonus?.availableMinor ?? "0",
      reserved: reservedMinor.toString(),
    };
  }, [wallet]);

  const featuredPromotion = promotions?.items.find((item) => item.eligible) ?? promotions?.items[0] ?? null;

  if (loading) {
    return <main id="main"><section className="panel"><p role="status">กำลังโหลดข้อมูลสมาชิกจากระบบ…</p></section></main>;
  }

  return <main id="main">
    {error && <div className="notice warning" role="alert"><b>!</b><div><strong>โหลดข้อมูลหน้าแรกไม่สำเร็จ</strong>{error}</div></div>}

    <div className="wallet-hero">
      <div className="wallet-hero-top"><h2>ยอดเงินในกระเป๋า</h2><Link className="button ghost" href="/wallet">จัดการกระเป๋า →</Link></div>
      <div className="wallet-grid">
        <div className="wallet-cell"><div className="wallet-label">เงินสดคงเหลือ</div><div className="wallet-amount">{formatMinor(balances.cashPosted)}<small>บาท</small></div><div className="wallet-actions"><Link className="button secondary" href="/wallet/deposit">เติมเงิน</Link></div></div>
        <div className="wallet-cell"><div className="wallet-label">โบนัสพร้อมใช้</div><div className="wallet-amount">{formatMinor(balances.bonusAvailable)}<small>บาท</small></div><div className="wallet-actions"><Link className="button secondary" href="/promotions">ดูเงื่อนไข</Link></div></div>
        <div className="wallet-cell"><div className="wallet-label">ยอดที่พักไว้</div><div className="wallet-amount">{formatMinor(balances.reserved)}<small>บาท</small></div><div className="wallet-actions"><Link className="button secondary" href="/wallet">ดูรายละเอียด</Link></div></div>
        <div className="wallet-cell"><div className="wallet-label">เงินสดพร้อมใช้</div><div className="wallet-amount">{formatMinor(balances.cashAvailable)}<small>บาท</small></div><div className="wallet-actions"><Link className="button lime" href="/wallet/withdraw">ถอนเงิน</Link></div></div>
      </div>
      {wallet && <p className="small muted" style={{ marginTop: 12 }}>ข้อมูลกระเป๋า ณ {formatDateTime(wallet.dataAsOf)}</p>}
    </div>

    <section className="grid-2" style={{ marginTop: 18 }}>
      <div className="stack">
        <section className="panel"><div className="panel-title"><h2>งวดที่เปิดรับ</h2><Link href="/buy">ดูทั้งหมด →</Link></div><div className="draw-list">
          {draws.length ? draws.map((draw) => <div className="draw-row" key={draw.id}><div className="lottery-icon">L</div><div className="draw-name"><strong>{productLabel(draw.productId)}</strong><span>งวด {draw.localDate} · ปิดรับ {formatDateTime(draw.cutoffAt, draw.timezone)}</span></div><div className="countdown"><small>ปิดรับใน</small><span>{formatRemaining(draw.cutoffAt, draw.serverNow)}</span></div><Link className="button primary" href={`/buy/bet?drawId=${encodeURIComponent(draw.id)}`}>ซื้อเลย</Link></div>) : <div className="notice info"><b>i</b><div><strong>ยังไม่มีงวดที่เปิดรับ</strong>เมื่อ Draw อยู่ในสถานะ OPEN ระบบจะแสดงที่นี่</div></div>}
        </div></section>

        <section className="panel"><div className="panel-title"><h2>โพยล่าสุดของฉัน</h2><Link href="/slips">ดูทั้งหมด →</Link></div><div className="activity-list">
          {orders?.items.length ? orders.items.map((order) => {
            const status = orderStatus(order.state);
            return <div className="activity-row" key={order.id}><span>{formatDateTime(order.createdAt)}</span><div><strong>Draw {shortId(order.drawId)}</strong><span className="small muted">{order.lines.length} รายการ · {order.lines.slice(0, 3).map((line) => line.canonicalNumber).join(", ") || "—"}</span></div><strong>{formatMinor(order.totalStakeMinor)} บาท</strong><span className={`status ${status.tone}`}>{status.label}</span></div>;
          }) : <div className="notice info"><b>i</b><div><strong>ยังไม่มีโพย</strong>รายการที่สร้างจากบัญชีนี้จะแสดงที่นี่</div></div>}
        </div></section>
      </div>

      <div className="stack">
        <section className="promo-card"><div className="panel-title"><h2>โปรโมชั่น</h2><Link href="/promotions">ดูทั้งหมด →</Link></div>{featuredPromotion ? <><strong>{featuredPromotion.campaignCode}</strong><p className="muted small">รางวัล {formatMinor(featuredPromotion.rewardAmountMinor)} บาท · {featuredPromotion.eligible ? "ใช้สิทธิ์ได้" : "ยังไม่เข้าเงื่อนไข"}</p><p className="small muted">หมดอายุ {formatDateTime(featuredPromotion.expiresAt)}</p></> : <p className="muted small">ยังไม่มีโปรโมชั่นที่เผยแพร่สำหรับบัญชีนี้</p>}</section>

        <section className="panel"><div className="panel-title"><h2>สถานะบัญชี</h2></div><div className="menu-row"><div className="menu-icon">A</div><div><strong>ตรวจความพร้อมก่อนทำรายการ</strong><span>Terms, Profile, KYC และสิทธิ์จะถูกตรวจตาม policy ปัจจุบัน</span></div><Link className="button primary" href="/eligibility">ตรวจสอบ</Link></div></section>

        <section className="panel" id="alerts"><div className="panel-title"><h2>ทางลัด</h2></div><div className="alert-list">
          <div className="alert-row"><div className="alert-icon">i</div><div><strong>ดูประวัติกระเป๋า</strong><span>ตรวจยอดและรายการจาก Ledger ของบัญชี</span></div><Link className="text-link" href="/wallet">ดูกระเป๋า</Link></div>
          <div className="alert-row"><div className="alert-icon success">✓</div><div><strong>ดูโพยของฉัน</strong><span>ตรวจสถานะ Order และใบรับรายการ</span></div><Link className="text-link" href="/slips">ดูโพย</Link></div>
        </div></section>
      </div>
    </section>
  </main>;
}
