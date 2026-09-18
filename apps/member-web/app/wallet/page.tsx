"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  memberApi,
  type WalletBalance,
  type WalletBucket,
  type WalletTransaction,
} from "../lib/member-api";
import {
  describeMemberApiFailure,
  describeOperationType,
  describeWalletBucket,
  formatBaht,
  formatDateTime,
  formatSignedMinor,
  sumMinor,
} from "../lib/member-display";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; balance: WalletBalance; transactions: WalletTransaction[]; nextCursor: string | null }
  | { status: "failed"; message: string; code: string; correlationId?: string };

const PAGE_SIZE = 20;

function bucketOf(balance: WalletBalance, name: string): WalletBucket | undefined {
  return balance.buckets.find((bucket) => bucket.bucket === name);
}

export default function WalletPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [openTransaction, setOpenTransaction] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    // Balance and ledger history are two independent reads; the page shows both
    // or fails honestly, never a placeholder balance.
    const [balance, page] = await Promise.all([memberApi.getWallet(), memberApi.listWalletTransactions({ limit: PAGE_SIZE })]);
    return { balance, transactions: page.items, nextCursor: page.nextCursor };
  }, []);

  useEffect(() => {
    let active = true;
    load()
      .then((data) => {
        if (active) setState({ status: "ready", ...data });
      })
      .catch((loadError) => {
        if (!active) return;
        const failure = describeMemberApiFailure(loadError);
        setState({ status: "failed", message: failure.message, code: failure.code, correlationId: failure.correlationId });
      });
    return () => {
      active = false;
    };
  }, [load]);

  const loadMore = async () => {
    if (state.status !== "ready" || !state.nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await memberApi.listWalletTransactions({ limit: PAGE_SIZE, cursor: state.nextCursor });
      setState({ status: "ready", balance: state.balance, transactions: [...state.transactions, ...page.items], nextCursor: page.nextCursor });
    } catch (loadError) {
      const failure = describeMemberApiFailure(loadError);
      setState({ status: "failed", message: failure.message, code: failure.code, correlationId: failure.correlationId });
    } finally {
      setLoadingMore(false);
    }
  };

  if (state.status === "loading") {
    return <main id="main">
      <div className="page-head"><div><h1>กระเป๋า</h1><p>ยอดเงินและประวัติรายการด้านล่างดึงจาก Wallet &amp; Ledger ของบัญชีคุณโดยตรง</p></div></div>
      <section className="panel"><div className="panel-title"><h2>กำลังโหลดยอดเงิน</h2></div><p className="muted small">กำลังดึงยอดคงเหลือและประวัติรายการ…</p></section>
    </main>;
  }

  if (state.status === "failed") {
    return <main id="main">
      <div className="page-head"><div><h1>กระเป๋า</h1><p>ยอดเงินและประวัติรายการด้านล่างดึงจาก Wallet &amp; Ledger ของบัญชีคุณโดยตรง</p></div></div>
      <section className="panel"><div className="panel-title"><h2>โหลดข้อมูลกระเป๋าไม่สำเร็จ</h2><span className="status danger">{state.code}</span></div><p className="muted small">{state.message}</p>{state.correlationId && <p className="muted small">รหัสอ้างอิง: {state.correlationId}</p>}</section>
    </main>;
  }

  const { balance, transactions } = state;
  const cash = bucketOf(balance, "CASH");
  const bonus = bucketOf(balance, "BONUS");
  const reservedMinor = sumMinor(balance.buckets.map((bucket) => bucket.reservedMinor));

  return <main id="main">
    <div className="page-head"><div><h1>กระเป๋า</h1><p>ยอดเงินและประวัติรายการด้านล่างดึงจาก Wallet &amp; Ledger ของบัญชีคุณโดยตรง ข้อมูล ณ {formatDateTime(balance.dataAsOf)}</p></div><div style={{ display: "flex", gap: 8 }}><Link className="button secondary" href="/wallet/deposit">ฝากเงิน</Link><Link className="button primary" href="/wallet/withdraw">ถอนเงิน</Link></div></div>
    <section className="balance-strip">
      <div><span>เงินสดที่ใช้ได้</span><strong>{formatBaht(cash?.availableMinor ?? "0")}</strong></div>
      <div><span>โบนัสที่ใช้ได้</span><strong>{formatBaht(bonus?.availableMinor ?? "0")}</strong></div>
      <div><span>ยอดที่พักไว้ (ทุก bucket)</span><strong>{formatBaht(reservedMinor)}</strong></div>
      <div><span>ยอดที่ถอนได้โดยประมาณ</span><strong>{formatBaht(cash?.availableMinor ?? "0")}</strong></div>
    </section>
    <section className="grid-2" style={{ marginTop: 18 }}>
      <div className="stack">
        <section className="panel"><div className="panel-title"><h2>รายละเอียดแต่ละ bucket</h2><span className="muted small">{balance.buckets.length} bucket</span></div>
          <div className="table-wrap"><table><thead><tr><th>Bucket</th><th>คงเหลือ (posted)</th><th>พักไว้</th><th>ใช้ได้</th></tr></thead><tbody>
            {balance.buckets.map((bucket) => <tr key={bucket.bucket}><td><strong>{describeWalletBucket(bucket.bucket)}</strong><br /><span className="muted small">{bucket.bucket}</span></td><td>{formatBaht(bucket.postedMinor)}</td><td>{formatBaht(bucket.reservedMinor)}</td><td>{formatBaht(bucket.availableMinor)}</td></tr>)}
          </tbody></table></div>
          <p className="muted small" style={{ marginTop: 10 }}>ยอดที่ถอนได้จริงจะถูกคำนวณอีกครั้งโดยการตรวจสอบก่อนถอน (preflight) ซึ่งรวมเงื่อนไขและข้อจำกัดของบัญชี ณ เวลานั้น</p>
        </section>
        <section className="panel" id="transactions">
          <div className="panel-title"><h2>ประวัติรายการ</h2><span className="muted small">แสดง {transactions.length} รายการ</span></div>
          {transactions.length === 0
            ? <div className="notice info"><b>i</b><div><strong>ยังไม่มีรายการในกระเป๋า</strong>เมื่อมีรายการทางการเงิน รายการจะปรากฏที่นี่จาก Ledger โดยตรง</div></div>
            : <div className="txn-list">{transactions.map((transaction) => {
              const negative = transaction.netImpactMinor.trim().startsWith("-");
              const open = openTransaction === transaction.id;
              return <div key={transaction.id}>
                <button className="txn-row" type="button" style={{ width: "100%", textAlign: "left", background: "none", border: 0, cursor: "pointer" }} aria-expanded={open} onClick={() => setOpenTransaction(open ? null : transaction.id)}>
                  <div className="txn-icon">{negative ? "−" : "+"}</div>
                  <div><strong>{describeOperationType(transaction.operationType)}</strong><span>{formatDateTime(transaction.postedAt)} · {transaction.operationType}</span></div>
                  <div className={`txn-amount ${negative ? "" : "positive"}`}>{formatSignedMinor(transaction.netImpactMinor)}</div>
                </button>
                {open && <div className="notice info" style={{ marginBottom: 10 }}>
                  <b>i</b>
                  <div>
                    <strong>รายละเอียดรายการ</strong>
                    <table className="small" style={{ marginTop: 7 }}><tbody>
                      <tr><td>รหัสรายการ Ledger</td><td>{transaction.id}</td></tr>
                      <tr><td>รหัสธุรกรรมทางธุรกิจ</td><td>{transaction.businessTransactionId}</td></tr>
                      <tr><td>ประเภทธุรกรรม</td><td>{transaction.operationType}</td></tr>
                      <tr><td>รหัสอ้างอิง (correlation)</td><td>{transaction.correlationId}</td></tr>
                      <tr><td>บันทึกเมื่อ</td><td>{formatDateTime(transaction.postedAt)}</td></tr>
                      <tr><td>มีผลเมื่อ</td><td>{formatDateTime(transaction.effectiveAt)}</td></tr>
                      <tr><td>ผลกระทบสุทธิ</td><td>{formatSignedMinor(transaction.netImpactMinor)} บาท</td></tr>
                    </tbody></table>
                  </div>
                </div>}
              </div>;
            })}</div>}
          {state.nextCursor && <button className="button secondary" type="button" style={{ marginTop: 14 }} onClick={loadMore} disabled={loadingMore}>{loadingMore ? "กำลังโหลด…" : "โหลดรายการเพิ่มเติม"}</button>}
        </section>
      </div>
      <aside className="stack">
        <section className="panel"><div className="panel-title"><h2>ทำรายการ</h2></div><Link className="button lime block" href="/wallet/deposit">+ ฝากเงิน</Link><Link className="button secondary block" href="/wallet/withdraw" style={{ marginTop: 8 }}>ถอนเงิน</Link></section>
        <section className="promo-card"><strong>โบนัสไม่สามารถถอนโดยตรง</strong><p className="muted small" style={{ marginTop: 7 }}>ตรวจยอดเล่น เงื่อนไข และวันหมดอายุของแต่ละสิทธิ์ก่อนใช้งาน</p><Link className="text-link" href="/promotions" style={{ display: "inline-block", marginTop: 10 }}>ดูโปรโมชั่นของฉัน →</Link></section>
      </aside>
    </section>
  </main>;
}
