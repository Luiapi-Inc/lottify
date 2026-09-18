"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  memberApi,
  type MemberBetType,
  type MemberBetTypePage,
  type MemberDraw,
  type MemberDrawEligibility,
  type MemberDrawPage,
  type MemberProduct,
  type MemberProductPage,
} from "../lib/member-api";
import { ErrorState, LoadingState, PageHeading, Section, StatusBadge } from "../components/presentation";

type Selection = {
  product?: MemberProduct;
  draws?: MemberDrawPage;
  draw?: MemberDraw;
  eligibility?: MemberDrawEligibility;
  betTypes: MemberBetType[];
};

export default function BuyPage() {
  const [products, setProducts] = useState<MemberProductPage | null>(null);
  const [catalogBetTypes, setCatalogBetTypes] = useState<MemberBetTypePage | null>(null);
  const [selection, setSelection] = useState<Selection>({ betTypes: [] });
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedDrawId, setSelectedDrawId] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [productPage, betTypePage] = await Promise.all([
        memberApi.listProducts(undefined, 50),
        memberApi.listBetTypes(undefined, 100),
      ]);
      setProducts(productPage);
      setCatalogBetTypes(betTypePage);
      if (productPage.items[0]) setSelectedProductId((current) => current || productPage.items[0]!.id);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProduct = useCallback(async (productId: string) => {
    if (!productId) return;
    setDetailLoading(true);
    setError(null);
    try {
      const [product, draws] = await Promise.all([
        memberApi.getProduct(productId),
        memberApi.listDraws(productId, { limit: 50 }),
      ]);
      setSelection({ product, draws, betTypes: [] });
      const preferred = draws.items.find((draw) => draw.state === "OPEN") ?? draws.items[0];
      setSelectedDrawId(preferred?.id ?? "");
    } catch (cause) {
      setError(cause);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadDraw = useCallback(async (drawId: string) => {
    if (!drawId) return;
    setDetailLoading(true);
    setError(null);
    try {
      const [draw, eligibility] = await Promise.all([
        memberApi.getDraw(drawId),
        memberApi.getDrawEligibility(drawId),
      ]);
      const betTypes = await Promise.all(draw.betTypes.map((entry) => memberApi.getBetType(entry.betTypeId)));
      setSelection((current) => ({ ...current, draw, eligibility, betTypes }));
    } catch (cause) {
      setError(cause);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);
  useEffect(() => { if (selectedProductId) void loadProduct(selectedProductId); }, [selectedProductId, loadProduct]);
  useEffect(() => { if (selectedDrawId) void loadDraw(selectedDrawId); }, [selectedDrawId, loadDraw]);

  const canContinue = Boolean(selection.draw && selection.eligibility?.eligible && selection.draw.state === "OPEN");

  return <main id="main">
    <PageHeading
      eyebrow="BETTING · STEP 1"
      title="เลือก Product และ Draw จากระบบ"
      description="ไม่มีวันงวดหรืออัตราจ่ายที่ hard-code ในหน้าเว็บ ทุกตัวเลือกมาจาก Catalog/Draw API และตรวจ eligibility ของ Draw ก่อนเริ่มกรอกเลข"
      action={<button className="button secondary" type="button" onClick={() => void loadCatalog()}>โหลด Catalog ใหม่</button>}
    />
    <div className="stepper">
      <div className="step active"><strong>1 · เลือกงวด</strong>Product / Draw</div>
      <div className="step"><strong>2 · ใส่เลข</strong>Canonical lines</div>
      <div className="step"><strong>3 · Quote</strong>Server-resolved terms</div>
      <div className="step"><strong>4 · Confirm</strong>Order / Receipt</div>
    </div>

    {loading ? <LoadingState label="กำลังโหลด Product และ Bet Type…" /> : null}
    {error ? <div style={{ marginBottom: 16 }}><ErrorState error={error} retry={() => void loadCatalog()} /></div> : null}

    <section className="grid-2">
      <div className="stack">
        <Section title="Lottery Products" subtitle={products ? `${products.items.length} รายการจาก /products` : "กำลังอ่านข้อมูล"}>
          <div className="data-list">
            {(products?.items ?? []).map((product) => {
              const published = product.versions.find((version) => version.state === "PUBLISHED") ?? product.versions[0];
              return <button
                key={product.id}
                className="data-row"
                type="button"
                style={{ width: "100%", textAlign: "left", borderTop: 0, borderLeft: 0, borderRight: 0, background: selectedProductId === product.id ? "var(--mint)" : "transparent", cursor: "pointer" }}
                onClick={() => setSelectedProductId(product.id)}
              >
                <div className="data-main"><strong>{product.id}</strong><span>{published ? `Version ${published.version} · ${published.state}` : "ยังไม่มี version"}</span></div>
                <StatusBadge tone={published?.state === "PUBLISHED" ? "success" : "warning"}>{published?.state ?? "UNKNOWN"}</StatusBadge>
              </button>;
            })}
          </div>
        </Section>

        <Section title="Draws" subtitle={selection.product ? `Product ${selection.product.id}` : "เลือก Product ก่อน"}>
          {detailLoading && !selection.draws ? <LoadingState /> : null}
          <div className="data-list">
            {(selection.draws?.items ?? []).map((draw) => <button
              key={draw.id}
              type="button"
              className="data-row"
              style={{ width: "100%", textAlign: "left", borderTop: 0, borderLeft: 0, borderRight: 0, background: selectedDrawId === draw.id ? "var(--mint)" : "transparent", cursor: "pointer" }}
              onClick={() => setSelectedDrawId(draw.id)}
            >
              <div className="data-main"><strong>{draw.occurrenceIdentity}</strong><span>{draw.localDate} · ปิด {new Date(draw.cutoffAt).toLocaleString("th-TH")} · {draw.timezone}</span></div>
              <StatusBadge tone={draw.state === "OPEN" ? "success" : draw.state === "CANCELLED" ? "danger" : "neutral"}>{draw.state}</StatusBadge>
            </button>)}
          </div>
        </Section>
      </div>

      <aside className="stack">
        <Section title="สถานะ Draw ที่เลือก" subtitle="GET draw + eligibility">
          {selection.draw ? <>
            <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
              <div className="kpi"><div className="kpi-label">สถานะ</div><div className="kpi-value" style={{ fontSize: 20 }}>{selection.draw.state}</div><div className="kpi-meta">version {selection.draw.version}</div></div>
              <div className="kpi"><div className="kpi-label">รับเดิมพันได้</div><div className="kpi-value" style={{ fontSize: 20 }}>{selection.eligibility?.eligible ? "YES" : "NO"}</div><div className="kpi-meta">{selection.eligibility ? `Server ${new Date(selection.eligibility.serverNow).toLocaleTimeString("th-TH")}` : "กำลังตรวจ"}</div></div>
            </div>
            <div className="notice info" style={{ marginTop: 12 }}><b>i</b><div><strong>{selection.draw.occurrenceIdentity}</strong>Cutoff {new Date(selection.draw.cutoffAt).toLocaleString("th-TH")} · Bet Types {selection.draw.betTypes.length}</div></div>
          </> : <div className="state-card"><span className="state-symbol">○</span><div><strong>ยังไม่ได้เลือก Draw</strong><p>เลือกงวดจากรายการด้านซ้าย</p></div></div>}
        </Section>

        <Section title="Bet Types ที่ผูกกับ Draw" subtitle={catalogBetTypes ? `Catalog มี ${catalogBetTypes.items.length} Bet Types` : "อ่านจาก API"}>
          {selection.draw?.betTypes.length ? <div className="data-list">{selection.draw.betTypes.map((item) => {
            const detail = selection.betTypes.find((entry) => entry.id === item.betTypeId);
            const version = detail?.versions.find((entry) => entry.id === item.betTypeVersionId) ?? detail?.versions[0];
            return <div className="data-row" key={item.betTypeId}>
              <div className="data-main"><strong>{item.betTypeCode}</strong><span>{item.canonicalNumberFormat} · stake {item.minStakeMinor}–{item.maxStakeMinor} minor</span></div>
              <div className="data-meta"><StatusBadge tone="info">v{item.betTypeVersionId.slice(0, 6)}</StatusBadge><span>{version?.validationPattern ?? item.validationPattern}</span></div>
            </div>;
          })}</div> : <div className="state-card"><span className="state-symbol">○</span><div><strong>ไม่มี Bet Type</strong><p>Draw นี้ยังไม่มี Bet Type ที่ backend เปิดให้ใช้งาน</p></div></div>}
        </Section>

        {selection.draw ? <Link
          className={`button lime block ${canContinue ? "" : "disabled"}`}
          aria-disabled={!canContinue}
          href={canContinue ? `/buy/bet?drawId=${encodeURIComponent(selection.draw.id)}&productId=${encodeURIComponent(selection.draw.productId)}` : "#"}
        >กรอกเลขสำหรับ Draw นี้ →</Link> : null}
      </aside>
    </section>
  </main>;
}
