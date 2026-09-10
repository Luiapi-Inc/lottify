"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type PaymentKind = "deposit" | "withdrawal";
type PaymentState = "pending" | "review_required" | "reconciling" | "completed";
type ConnectionState = "online" | "stale" | "offline";

type StateCopy = {
  badge: string;
  badgeClass: string;
  kicker: string;
  title: string;
  message: string;
  amount: string;
  noteClass: string;
  noteTitle: string;
  note: string;
  steps: Array<["done" | "current" | "future", string, string]>;
};

const COPY: Record<PaymentKind, Record<PaymentState, StateCopy>> = {
  deposit: {
    pending: {
      badge: "กำลังดำเนินการ", badgeClass: "is-pending", kicker: "สถานะล่าสุดจากระบบ",
      title: "กำลังรอการยืนยันการชำระเงิน",
      message: "ยังไม่เพิ่มยอดเข้ากระเป๋าจนกว่าจะยืนยันการชำระและบันทึกเครดิตสำเร็จครบถ้วน",
      amount: "ยังไม่เพิ่มยอด", noteClass: "", noteTitle: "ยังไม่ถือว่าฝากเงินสำเร็จ",
      note: "สถานะ Pending อาจอัปเดตผ่านการเชื่อมต่อแบบเรียลไทม์หรือการตรวจซ้ำ แต่จะไม่สร้างรายการฝากใหม่",
      steps: [["done", "สร้างรายการฝากแล้ว", "ใช้เลขอ้างอิงเดิมติดตามรายการนี้"], ["current", "รอการยืนยันการชำระ", "ยังไม่เพิ่มยอดเงินระหว่างรอผลที่ยืนยันได้"], ["future", "บันทึกยอดเข้ากระเป๋า", "จะแสดงสำเร็จเมื่อการยืนยันและเครดิตในกระเป๋าครบถ้วน"]],
    },
    review_required: {
      badge: "กำลังตรวจสอบ", badgeClass: "is-review", kicker: "ต้องตรวจสอบรายการเพิ่มเติม",
      title: "กำลังตรวจสอบรายการฝากเงิน", message: "พบข้อมูลที่ยังยืนยันไม่ได้ครบ รายการจึงยังไม่ถูกเพิ่มยอดอัตโนมัติ",
      amount: "ยังไม่เพิ่มยอด", noteClass: "is-warning", noteTitle: "เก็บเลขอ้างอิงนี้ไว้",
      note: "ไม่ต้องสร้างรายการใหม่ ระบบจะตรวจสอบรายการเดิมและอัปเดตเมื่อทราบผลที่ยืนยันได้",
      steps: [["done", "สร้างรายการฝากแล้ว", "เลขอ้างอิงยังคงเดิม"], ["current", "กำลังตรวจสอบ", "ยอดยังไม่ถูกเพิ่มเข้ากระเป๋าระหว่างตรวจสอบ"], ["future", "ยืนยันผลและบันทึกยอด", "จะเปลี่ยนเป็นสำเร็จหลังบันทึกเครดิตแล้วเท่านั้น"]],
    },
    reconciling: {
      badge: "กำลังเทียบข้อมูล", badgeClass: "is-reconciling", kicker: "กำลังตรวจสอบผลให้ตรงกัน",
      title: "กำลังยืนยันผลรายการฝากเงิน", message: "ระบบกำลังเทียบข้อมูลของรายการเดิมเพื่อหาผลที่ยืนยันได้ โดยยังไม่เพิ่มยอดซ้ำหรือเพิ่มยอดก่อนทราบผล",
      amount: "ยังไม่เพิ่มยอด", noteClass: "is-warning", noteTitle: "ยังไม่ต้องทำรายการซ้ำ",
      note: "เมื่อผลชัดเจน ระบบจะดำเนินการกับรายการเดิมเพียงครั้งเดียวและเก็บเลขอ้างอิงเดิมไว้สำหรับติดตาม",
      steps: [["done", "รับรายการไว้แล้ว", "รายการเดิมยังอยู่ระหว่างติดตาม"], ["current", "กำลังเทียบข้อมูล", "ยังไม่สรุปสำเร็จจนกว่าผลอ้างอิงจะตรงกัน"], ["future", "บันทึกผลครั้งเดียว", "เครดิตที่มองเห็นจะเกิดครั้งเดียวเมื่อยืนยันครบ"]],
    },
    completed: {
      badge: "ฝากเงินสำเร็จ", badgeClass: "is-completed", kicker: "ยืนยันจากระบบแล้ว", title: "ฝากเงินสำเร็จ",
      message: "การชำระเงินได้รับการยืนยันและยอด 1,000.00 บาทถูกบันทึกเข้ากระเป๋าแล้ว", amount: "+1,000.00 บาท",
      noteClass: "is-success", noteTitle: "เครดิตของรายการนี้แสดงเพียงครั้งเดียว",
      note: "หากระบบได้รับการยืนยันซ้ำ ยอดเงินของรายการนี้จะไม่ถูกเพิ่มซ้ำ",
      steps: [["done", "ยืนยันการชำระแล้ว", "ผลรายการได้รับการยืนยัน"], ["done", "บันทึกเครดิตเข้ากระเป๋าแล้ว", "+1,000.00 บาทสำหรับรายการอ้างอิงนี้"], ["done", "รายการเสร็จสมบูรณ์", "ติดตามย้อนหลังได้ด้วยเลขอ้างอิงเดิม"]],
    },
  },
  withdrawal: {
    pending: {
      badge: "กำลังดำเนินการ", badgeClass: "is-pending", kicker: "สถานะล่าสุดจากระบบ", title: "กำลังดำเนินการถอนเงิน",
      message: "คำขอถูกบันทึกแล้วและยอด 3,000.00 บาทของรายการถูกพักไว้ระหว่างดำเนินการ", amount: "3,000.00 บาท",
      noteClass: "", noteTitle: "ยังไม่ถือว่าถอนเงินสำเร็จ",
      note: "รายการจะสำเร็จเมื่อมีหลักฐานการจ่ายเงินและการบันทึกยอดเสร็จครบถ้วนแล้วเท่านั้น",
      steps: [["done", "ส่งคำขอแล้ว", "ยอด 3,000.00 บาทของรายการถูกพักไว้"], ["done", "ผ่านการตรวจเงื่อนไขของรายการ", "คำขอเข้าสู่ขั้นตอนดำเนินการจ่ายเงิน"], ["current", "กำลังดำเนินการจ่ายเงิน", "ยังไม่สรุปว่าสำเร็จก่อนยืนยันผลและบันทึกยอดครบ"], ["future", "ยืนยันและปิดรายการ", "ต้องมีผลการจ่ายเงินและการบันทึกยอดครบถ้วน"]],
    },
    review_required: {
      badge: "ต้องตรวจสอบ", badgeClass: "is-review", kicker: "รายการต้องได้รับการตรวจสอบเพิ่มเติม", title: "กำลังตรวจสอบคำขอถอนเงิน",
      message: "ยอด 3,000.00 บาทของรายการยังคงพักไว้ระหว่างตรวจสอบ และยังไม่ถือว่าถอนสำเร็จ", amount: "3,000.00 บาท",
      noteClass: "is-warning", noteTitle: "ไม่ต้องส่งคำขอถอนซ้ำ",
      note: "ใช้เลขอ้างอิงเดิมติดตามรายการ ระบบจะอัปเดตเมื่อการตรวจสอบได้ข้อสรุป",
      steps: [["done", "รับคำขอและพักยอดแล้ว", "ยอดของรายการยังคงถูกพักไว้"], ["current", "กำลังตรวจสอบ", "ยังไม่มีผลสำเร็จที่ยืนยันได้"], ["future", "ดำเนินการตามผลที่ยืนยันได้", "รายการเดิมจะดำเนินต่อโดยไม่สร้างคำขอใหม่"], ["future", "ปิดรายการเมื่อครบเงื่อนไข", "สำเร็จหลังการจ่ายเงินและบันทึกยอดครบเท่านั้น"]],
    },
    reconciling: {
      badge: "กำลังตรวจสอบผล", badgeClass: "is-reconciling", kicker: "ผลการจ่ายเงินยังไม่ชัดเจน", title: "กำลังยืนยันผลรายการถอนเงิน",
      message: "ระบบยังยืนยันผลการจ่ายเงินไม่ได้ จึงคงยอด 3,000.00 บาทของรายการไว้ระหว่างตรวจสอบ", amount: "3,000.00 บาท",
      noteClass: "is-warning", noteTitle: "ยอดยังคงพักไว้จนกว่าจะทราบผลแน่นอน",
      note: "ระบบจะไม่คืนยอดหรือสรุปว่าสำเร็จจากผลที่ยังไม่ชัดเจน เมื่อยืนยันผลได้แล้วจึงดำเนินการกับรายการเดิมต่อเพียงครั้งเดียว",
      steps: [["done", "คำขออยู่ระหว่างดำเนินการ", "เลขอ้างอิงเดิมยังใช้ติดตามได้"], ["current", "กำลังตรวจสอบผลการจ่ายเงิน", "ผลยังไม่ชัดเจนและยอดยังคงพักไว้"], ["future", "ยืนยันผลที่ถูกต้อง", "จากนั้นจึงดำเนินการต่อหรือคืนยอดตามผลที่พิสูจน์ได้"], ["future", "บันทึกผลครั้งเดียว", "ไม่ทำรายการซ้ำระหว่างที่ผลยังไม่ชัดเจน"]],
    },
    completed: {
      badge: "ถอนเงินสำเร็จ", badgeClass: "is-completed", kicker: "ยืนยันจากระบบแล้ว", title: "ถอนเงินสำเร็จ",
      message: "ผลการจ่ายเงินได้รับการยืนยันและการบันทึกยอดของรายการเสร็จสมบูรณ์แล้ว", amount: "ดำเนินการครบแล้ว",
      noteClass: "is-success", noteTitle: "รายการปิดสมบูรณ์แล้ว",
      note: "เก็บเลขอ้างอิงไว้ใช้ตรวจสอบย้อนหลังหรือแจ้งฝ่ายช่วยเหลือ",
      steps: [["done", "ส่งคำขอและพักยอดแล้ว", "3,000.00 บาท"], ["done", "ยืนยันผลการจ่ายเงินแล้ว", "มีผลที่ยืนยันได้สำหรับรายการนี้"], ["done", "บันทึกยอดเสร็จแล้ว", "การเปลี่ยนแปลงยอดของรายการเสร็จสมบูรณ์"], ["done", "ถอนเงินสำเร็จ", "รายการปิดด้วยเลขอ้างอิงเดิม"]],
    },
  },
};

const labels: Array<[PaymentState, string]> = [["pending", "กำลังดำเนินการ"], ["review_required", "ต้องตรวจสอบ"], ["reconciling", "กำลังเทียบข้อมูล"], ["completed", "สำเร็จ"]];

export function PaymentStatus({ kind }: { kind: PaymentKind }) {
  const [state, setState] = useState<PaymentState>("pending");
  const [connection, setConnection] = useState<ConnectionState>("online");
  const [refreshText, setRefreshText] = useState("ยังไม่ได้ตรวจซ้ำ");
  const copy = COPY[kind][state];
  const reference = kind === "deposit" ? "DEP-20260910-91208" : "WD-20260910-11840";
  const amountLabel = kind === "deposit" ? "ยอดเข้ากระเป๋า" : "ยอดของรายการที่พักไว้";
  const amount = kind === "deposit" ? "1,000.00 บาท" : "3,000.00 บาท";
  const backHref = kind === "deposit" ? "/wallet/deposit" : "/wallet/withdraw";
  const title = kind === "deposit" ? "ฝากเงิน" : "ถอนเงิน";
  const connectionCopy = useMemo(() => connection === "stale" ? "ข้อมูลที่เห็นอาจเก่า กดตรวจสถานะล่าสุดเพื่ออ่าน authoritative state อีกครั้ง" : connection === "offline" ? "การเชื่อมต่อขาดหาย สถานะที่เห็นยังไม่ใช่หลักฐานว่าสำเร็จ ระบบจะอ่านรายการเดิมเมื่อกลับมาเชื่อมต่อ" : "", [connection]);

  const refresh = () => {
    setRefreshText(new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    setConnection("online");
  };

  return <main id="main" className="payment-status-page">
    <div className="breadcrumb"><Link href="/wallet">กระเป๋า</Link><span>/</span><Link href={backHref}>{title}</Link><span>/</span><span>สถานะ</span></div>
    <section className="payment-status-shell">
      {connection !== "online" && <div className={`payment-connection is-${connection}`} role="status" aria-live="polite">{connectionCopy}</div>}
      <div className="payment-status-grid">
        <section className="panel payment-status-main" aria-labelledby="status-title">
          <div className="payment-status-heading"><div><p className="payment-eyebrow">{copy.kicker}</p><h1 id="status-title">{copy.title}</h1><p className="muted">{copy.message}</p></div><span className={`payment-status-badge ${copy.badgeClass}`}>{copy.badge}</span></div>
          <div className="payment-reference-card"><div><span>เลขอ้างอิง</span><strong>{reference}</strong></div><div><span>{kind === "deposit" ? "ยอดชำระ" : "ยอดถอน"}</span><strong>{amount}</strong></div><div><span>{amountLabel}</span><strong>{copy.amount}</strong></div></div>
          <div className={`payment-state-note ${copy.noteClass}`} role="status" aria-live="polite"><strong>{copy.noteTitle}</strong><span>{copy.note}</span></div>
          <ol className="payment-timeline" aria-label={`ความคืบหน้ารายการ${title}`}>{copy.steps.map(([tone, stepTitle, detail], index) => <li className={tone} key={`${state}-${index}`}><span className="payment-step-marker">{index + 1}</span><div><strong>{stepTitle}</strong><span>{detail}</span></div></li>)}</ol>
          <div className="payment-refresh-row"><button className="button primary payment-status-refresh" type="button" onClick={refresh}>ตรวจสถานะล่าสุด</button><p>หากการอัปเดตขาดหายหรือข้อมูลเก่า ให้กดตรวจอีกครั้ง ระบบจะอ่านสถานะรายการเดิมจากแหล่งข้อมูลอ้างอิง</p></div>
          <p className="payment-updated">ตรวจสถานะล่าสุด: <strong>{refreshText}</strong></p>
        </section>
        <aside className="stack payment-status-aside">
          <section className="summary-box"><div className="summary-row"><span>รายการ</span><strong>{title}</strong></div><div className="summary-row"><span>{kind === "deposit" ? "ช่องทาง" : "ปลายทาง"}</span><strong>{kind === "deposit" ? "PromptPay QR" : "กสิกรไทย ••••4821"}</strong></div><div className="summary-row"><span>{kind === "deposit" ? "ยอดชำระ" : "ยอดถอน"}</span><strong>{amount}</strong></div><div className="summary-row"><span>เลขอ้างอิง</span><strong>{reference}</strong></div></section>
          <section className="panel payment-review-panel"><div className="panel-title"><h2>ตรวจสถานะ</h2></div><div className="payment-review-links" aria-label={`จำลองสถานะ${title}`}>{labels.map(([value, label]) => <button type="button" className={state === value ? "active" : ""} key={value} onClick={() => setState(value)}>{label}</button>)}</div><div className="payment-review-links" style={{ marginTop: 10 }}><button type="button" onClick={() => setConnection("stale")}>ข้อมูลเก่า</button><button type="button" onClick={() => setConnection("offline")}>ขาดการเชื่อมต่อ</button></div></section>
          <Link className="button secondary block" href="/wallet">กลับกระเป๋า</Link>
        </aside>
      </div>
    </section>
  </main>;
}
