"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { memberApi, type WalletBalance, type WalletTransactionPage, type WithdrawalList } from "../lib/member-api";
import { ErrorState, LoadingState, Money, PageHeading, Section, StatusBadge } from "../components/presentation";

export default function WalletPage() {
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [transactions, setTransactions] = useState<WalletTransactionPage | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalList | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, unknown>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [walletResult, txResult, withdrawalResult] = await Promise.allSettled([
      memberApi.getWallet(),
      memberApi.listWalletTransactions(undefined, 30),
      memberApi.listWithdrawals(undefined, 5),
    ]);
    const nextErrors: Record<string, unknown> = {};
    if (walletResult.status === "fulfilled") setWallet(walletResult.value); else nextErrors.wallet = walletResult.reason;
    if (txResult.status === "fulfilled") setTransactions(txResult.value); else nextErrors.transactions = txResult.reason;
    if (withdrawalResult.status === "fulfilled") setWithdrawals(withdrawalResult.value); else nextErrors.withdrawals = withdrawalResult.reason;
    setErrors(nextErrors);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const bucket = (name: "CASH" | "BONUS" | "LOCKED") => wallet?.buckets.find((item) => item.bucket === name);
  const reservedMinor = wallet?.buckets.reduce((sum, item) => sum + BigInt(item.reservedMinor || "0"), 0n).toString() ?? "0";

  async function loadMoreTransactions() {
    if (!transactions?.nextCursor) return;
    setMoreLoading(true);
    try {
      const next = await memberApi.listWalletTransactions(transactions.nextCursor, 30);
      setTransactions({ items: [...transactions.items, ...next.items], nextCursor: next.nextCursor });
    } catch (cause) {
      setErrors((current) => ({ ...current, transactions: cause }));
    } finally {
      setMoreLoading(false);
    }
  }

  return <main id="main">
    <PageHeading
      eyebrow="WALLET"
      title="กระเป๋าที่อ่านจาก Ledger projection"
      description="แยก CASH, BONUS, LOCKED, reserved และ available ตาม Wallet API โดยไม่แสดง debit/credit ภายใน Ledger"
      action={<div style={{ display: "flex", gap: 8 }}><Link className="button secondary" href="/wallet/deposit">ฝากเงิน</Link><Link className="button primary" href="/wallet/withdraw">ถอนเงิน</Link></div>}
    />

    {loading ? <LoadingState label="กำลังอ่าน Wallet และรายการล่าสุด…" /> : null}

    {wallet ? <section className="wallet-hero">
      <div className="wallet-hero-top"><div><p className="eyebrow" style={{ color: "#d9ff53" }}>BALANCE · {wallet.currency}</p><h2>ยอดล่าสุดจากระบบ</h2></div><small>{new Date(wallet.dataAsOf).toLocaleString("th-TH")}</small></div>
      <div className="wallet-grid">
        <div className="wallet-cell"><div className="wallet-label">CASH ใช้ได้</div><div className="wallet-amount"><Money minor={bucket("CASH")?.availableMinor ?? "0"} /></div></div>
        <div className="wallet-cell"><div className="wallet-label">BONUS ใช้ได้</div><div className="wallet-amount"><Money minor={bucket("BONUS")?.availableMinor ?? "0"} /></div></div>
        <div className="wallet-cell"><div className="wallet-label">ยอดที่กันไว้</div><div className="wallet-amount"><Money minor={reservedMinor} /></div></div>
        <div className="wallet-cell"><div className="wallet-label">LOCKED ใช้ได้</div><div className="wallet-amount"><Money minor={bucket("LOCKED")?.availableMinor ?? "0"} /></div></div>
      </div>
    </section> : errors.wallet ? <ErrorState error={errors.wallet} retry={() => void load()} title="อ่าน Wallet ไม่สำเร็จ" /> : null}

    <section className="grid-2" style={{ marginTop: 18 }}>
      <Section title="ประวัติรายการ" subtitle="Member-facing financial projection" action={<button className="text-button" type="button" onClick={() => void load()}>รีเฟรช</button>}>
        {transactions?.items.length ? <div className="data-list">{transactions.items.map((item) => <div className="data-row" key={item.id}>
          <div className="data-main"><strong>{transactionLabel(item.operationType)}</strong><span>{new Date(item.effectiveAt).toLocaleString("th-TH")} · {item.businessTransactionId}</span></div>
          <div className="data-meta"><strong>{BigInt(item.netImpactMinor) > 0n ? "+" : ""}<Money minor={item.netImpactMinor} /></strong><span>อ้างอิง {item.correlationId}</span></div>
        </div>)}</div> : errors.transactions ? <ErrorState error={errors.transactions} retry={() => void load()} title="อ่านประวัติ Wallet ไม่สำเร็จ" /> : !loading ? <div className="state-card"><span className="state-symbol">○</span><div><strong>ยังไม่มีรายการ</strong><p>ระบบไม่สร้างธุรกรรมตัวอย่างแทนข้อมูลจริง</p></div></div> : null}
        {transactions?.nextCursor ? <button className="button secondary block" style={{ marginTop: 14 }} type="button" disabled={moreLoading} onClick={() => void loadMoreTransactions()}>{moreLoading ? "กำลังโหลด…" : "โหลดรายการเพิ่ม"}</button> : null}
      </Section>

      <aside className="stack">
        <Section title="คำขอถอนล่าสุด" subtitle="ติดตาม state โดยไม่อนุมานผลจ่าย">
          {withdrawals?.items.length ? <div className="data-list">{withdrawals.items.map((item) => <Link className="data-row" key={item.id} href={`/wallet/withdraw/status?id=${encodeURIComponent(item.id)}`}>
            <div className="data-main"><strong><Money minor={item.amountMinor} /></strong><span>{item.id} · {new Date(item.createdAt).toLocaleString("th-TH")}</span></div>
            <StatusBadge tone={item.state === "COMPLETED" ? "success" : item.state === "FAILED" || item.state === "REJECTED" ? "danger" : item.state === "RECONCILING" ? "warning" : "info"}>{item.state}</StatusBadge>
          </Link>)}</div> : errors.withdrawals ? <ErrorState error={errors.withdrawals} retry={() => void load()} title="อ่านคำขอถอนไม่สำเร็จ" /> : <div className="state-card"><span className="state-symbol">○</span><div><strong>ยังไม่มีคำขอถอน</strong><p>สร้างคำขอใหม่ได้เมื่อ preflight อนุญาต</p></div></div>}
        </Section>

        <Section title="ทำรายการ">
          <div className="action-grid">
            <Link className="action-card" href="/wallet/deposit"><b>+</b><div><strong>ฝากเงิน</strong><span>ดู method และ fee ล่าสุด</span></div></Link>
            <Link className="action-card" href="/wallet/withdraw"><b>↗</b><div><strong>ถอนเงิน</strong><span>ตรวจ destination + preflight</span></div></Link>
            <Link className="action-card" href="/account/bank-account"><b>◎</b><div><strong>บัญชีรับเงิน</strong><span>เพิ่มและตรวจสถานะ</span></div></Link>
            <Link className="action-card" href="/promotions"><b>✦</b><div><strong>โบนัส</strong><span>ดู turnover จริง</span></div></Link>
          </div>
        </Section>
      </aside>
    </section>
  </main>;
}

function transactionLabel(operationType: string): string {
  const labels: Record<string, string> = {
    DEPOSIT: "ฝากเงิน",
    BET_PURCHASE: "ซื้อหวย",
    BET_REFUND: "คืนเงินโพย",
    SETTLEMENT_PAYOUT: "เงินรางวัล",
    BONUS_GRANT: "รับโบนัส",
    BONUS_RELEASE: "ปลดโบนัส",
    WITHDRAWAL: "ถอนเงิน",
  };
  return labels[operationType] ?? operationType;
}
