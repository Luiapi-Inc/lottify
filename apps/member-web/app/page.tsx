"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  memberApi,
  type BetOrderList,
  type MemberDraw,
  type MemberProductPage,
  type MemberReadinessResponse,
  type PromotionDiscovery,
  type PromotionEntitlementPage,
  type WalletBalance,
} from "./lib/member-api";
import { ErrorState, LoadingState, Money, PageHeading, Section, StatusBadge } from "./components/presentation";

type HomeData = {
  readiness?: MemberReadinessResponse;
  wallet?: WalletBalance;
  products?: MemberProductPage;
  orders?: BetOrderList;
  promotions?: PromotionDiscovery;
  entitlements?: PromotionEntitlementPage;
  draws: MemberDraw[];
  failures: Record<string, unknown>;
};

const emptyData: HomeData = { draws: [], failures: {} };

function tone(outcome: string): "success" | "warning" | "danger" | "info" {
  if (outcome === "ALLOW") return "success";
  if (outcome === "DENY") return "danger";
  return "warning";
}

export default function HomePage() {
  const [data, setData] = useState<HomeData>(emptyData);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      memberApi.getReadiness(),
      memberApi.getWallet(),
      memberApi.listProducts(undefined, 20),
      memberApi.listOrders({ limit: 5 }),
      memberApi.listPromotions(),
      memberApi.listPromotionEntitlements({ limit: 5 }),
    ]);
    const failures: Record<string, unknown> = {};
    const names = ["readiness", "wallet", "products", "orders", "promotions", "entitlements"] as const;
    results.forEach((result, index) => {
      if (result.status === "rejected") failures[names[index]!] = result.reason;
    });

    const products = results[2].status === "fulfilled" ? results[2].value : undefined;
    const drawResults = products
      ? await Promise.allSettled(products.items.slice(0, 8).map((product) => memberApi.listDraws(product.id, { state: "OPEN", limit: 2 })))
      : [];
    const draws = drawResults.flatMap((result) => result.status === "fulfilled" ? result.value.items : []);
    drawResults.forEach((result, index) => {
      if (result.status === "rejected") failures[`draws:${products?.items[index]?.id ?? index}`] = result.reason;
    });

    setData({
      readiness: results[0].status === "fulfilled" ? results[0].value : undefined,
      wallet: results[1].status === "fulfilled" ? results[1].value : undefined,
      products,
      orders: results[3].status === "fulfilled" ? results[3].value : undefined,
      promotions: results[4].status === "fulfilled" ? results[4].value : undefined,
      entitlements: results[5].status === "fulfilled" ? results[5].value : undefined,
      draws,
      failures,
    });
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const buckets = useMemo(() => Object.fromEntries((data.wallet?.buckets ?? []).map((bucket) => [bucket.bucket, bucket])), [data.wallet]);
  const cash = buckets.CASH;
  const bonus = buckets.BONUS;
  const heldMinor = (data.wallet?.buckets ?? []).reduce((sum, bucket) => sum + BigInt(bucket.reservedMinor || "0"), 0n).toString();

  return <main id="main">
    <PageHeading
      eyebrow="LIVE MEMBER OVERVIEW"
      title="สิ่งที่ต้องรู้ ก่อนทำรายการ"
      description="หน้าแรกอ่านข้อมูลจาก Member API แยกเป็นส่วน ๆ หากบริการหนึ่งมีปัญหา ส่วนอื่นยังคงแสดงข้อมูลจริงที่โหลดสำเร็จ"
      action={<button className="button secondary" type="button" onClick={() => void load()}>รีเฟรชข้อมูล</button>}
    />

    {loading ? <LoadingState /> : null}

    <section className="wallet-hero" aria-label="ยอดเงินในกระเป๋า">
      <div className="wallet-hero-top"><div><p className="eyebrow" style={{ color: "#d9ff53" }}>WALLET · {data.wallet?.currency ?? "THB"}</p><h2>ยอดที่พร้อมใช้</h2></div><Link className="button secondary" href="/wallet">ดูกระเป๋า →</Link></div>
      {data.wallet ? <div className="wallet-grid">
        <div className="wallet-cell"><div className="wallet-label">เงินสดใช้ได้</div><div className="wallet-amount"><Money minor={cash?.availableMinor ?? "0"} /></div></div>
        <div className="wallet-cell"><div className="wallet-label">โบนัสใช้ได้</div><div className="wallet-amount"><Money minor={bonus?.availableMinor ?? "0"} /></div></div>
        <div className="wallet-cell"><div className="wallet-label">ยอดที่กันไว้</div><div className="wallet-amount"><Money minor={heldMinor} /></div></div>
        <div className="wallet-cell"><div className="wallet-label">ข้อมูลล่าสุด</div><div className="wallet-amount" style={{ fontSize: 18 }}>{new Date(data.wallet.dataAsOf).toLocaleString("th-TH")}</div></div>
      </div> : data.failures.wallet ? <ErrorState error={data.failures.wallet} retry={() => void load()} title="โหลด Wallet ไม่สำเร็จ" /> : null}
    </section>

    <section className="grid-2" style={{ marginTop: 18 }}>
      <div className="stack">
        <Section title="งวดที่เปิดรับ" subtitle="Draw state = OPEN จาก Product API" action={<Link href="/buy">ดูทั้งหมด →</Link>}>
          {data.draws.length ? <div className="data-list">{data.draws.slice(0, 6).map((draw) => <div className="data-row" key={draw.id}>
            <div className="data-main"><strong>{draw.occurrenceIdentity}</strong><span>{draw.localDate} · ปิดรับ {new Date(draw.cutoffAt).toLocaleString("th-TH")} · {draw.timezone}</span></div>
            <div className="data-meta"><StatusBadge tone="success">{draw.state}</StatusBadge><span>{draw.betTypes.length} Bet Types</span></div>
            <Link className="button primary" href={`/buy/bet?drawId=${encodeURIComponent(draw.id)}&productId=${encodeURIComponent(draw.productId)}`}>เลือกงวด</Link>
          </div>)}</div> : <div className="state-card"><span className="state-symbol">○</span><div><strong>ไม่มี Draw ที่เปิดรับในตอนนี้</strong><p>ระบบไม่ได้สร้างงวดตัวอย่างแทนข้อมูล backend</p></div></div>}
        </Section>

        <Section title="โพยล่าสุด" subtitle="สถานะจาก Bet Order API" action={<Link href="/slips">ดูโพยทั้งหมด →</Link>}>
          {data.orders?.items.length ? <div className="data-list">{data.orders.items.map((order) => <Link className="data-row" key={order.id} href={`/slips/detail?id=${encodeURIComponent(order.id)}`}>
            <div className="data-main"><strong>Order {order.id}</strong><span>{order.lines.map((line) => line.canonicalNumber).join(", ")} · {new Date(order.createdAt).toLocaleString("th-TH")}</span></div>
            <div className="data-meta"><strong><Money minor={order.totalStakeMinor} /></strong><StatusBadge tone={order.state === "CONFIRMED" || order.state === "SETTLED" ? "success" : order.state === "REJECTED" ? "danger" : "info"}>{order.state}</StatusBadge></div>
          </Link>)}</div> : data.failures.orders ? <ErrorState error={data.failures.orders} retry={() => void load()} /> : <div className="state-card"><span className="state-symbol">○</span><div><strong>ยังไม่มีโพย</strong><p>เมื่อมี Bet Order รายการล่าสุดจะแสดงที่นี่</p></div></div>}
        </Section>
      </div>

      <aside className="stack">
        <Section title="ความพร้อมของบัญชี" subtitle={data.readiness ? `Policy ${data.readiness.policyVersion}` : "Capability-specific readiness"}>
          {data.readiness ? <div className="data-list">{data.readiness.capabilities.map((capability) => <div className="data-row" key={capability.capability}>
            <div className="data-main"><strong>{capability.capability}</strong><span>{capability.reasonCodes.length ? capability.reasonCodes.join(" · ") : "ไม่มีข้อกำหนดค้าง"}</span></div>
            <StatusBadge tone={tone(capability.outcome)}>{capability.outcome}</StatusBadge>
          </div>)}</div> : data.failures.readiness ? <ErrorState error={data.failures.readiness} retry={() => void load()} /> : null}
        </Section>

        <Section title="โปรโมชั่นที่ใช้ได้" subtitle="Eligibility และ Turnover จาก Promotion API" action={<Link href="/promotions">เปิดโปรโมชั่น →</Link>}>
          {data.promotions?.items.length ? <div className="data-list">{data.promotions.items.slice(0, 3).map((promotion) => <div className="data-row" key={promotion.campaignVersionId}>
            <div className="data-main"><strong>{promotion.campaignCode}</strong><span>เป้า Turnover <Money minor={promotion.turnoverTargetMinor} /></span></div>
            <StatusBadge tone={promotion.eligible ? "success" : "warning"}>{promotion.eligible ? "ใช้ได้" : "ติดเงื่อนไข"}</StatusBadge>
          </div>)}</div> : data.failures.promotions ? <ErrorState error={data.failures.promotions} retry={() => void load()} /> : <div className="state-card"><span className="state-symbol">○</span><div><strong>ไม่มีโปรโมชั่นที่เปิดอยู่</strong><p>ระบบไม่แสดงสิทธิ์ตัวอย่างแทน API</p></div></div>}
        </Section>

        <Section title="ทางลัด" subtitle="ไปยังงานที่ใช้บ่อย">
          <div className="action-grid">
            <Link className="action-card" href="/wallet/deposit"><b>+</b><div><strong>เติมเงิน</strong><span>ดูวิธีที่เปิดใช้จริง</span></div></Link>
            <Link className="action-card" href="/wallet/withdraw"><b>↗</b><div><strong>ถอนเงิน</strong><span>Preflight ก่อนยืนยัน</span></div></Link>
            <Link className="action-card" href="/account/security"><b>◎</b><div><strong>ความปลอดภัย</strong><span>Session และ Device</span></div></Link>
            <Link className="action-card" href="/eligibility"><b>✓</b><div><strong>ความพร้อม</strong><span>ดูเหตุผลราย capability</span></div></Link>
          </div>
        </Section>
      </aside>
    </section>
  </main>;
}
