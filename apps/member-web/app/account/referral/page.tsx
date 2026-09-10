"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function ReferralPage() {
  const [referralLink, setReferralLink] = useState("/register?ref=LTF8421");
  const [feedback, setFeedback] = useState("รหัสแนะนำของคุณ: LTF8421");
  useEffect(() => setReferralLink(`${window.location.origin}/register?ref=LTF8421`), []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(referralLink); setFeedback("คัดลอกลิงก์แล้ว ส่งให้เพื่อนได้ทันที"); }
    catch { setFeedback("คัดลอกอัตโนมัติไม่ได้ กรุณาคัดลอกจากช่องลิงก์"); }
  };
  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: "สมัครสมาชิก Lottify", text: "สมัครผ่านลิงก์แนะนำของฉัน", url: referralLink }); setFeedback("เปิดเมนูแชร์แล้ว"); return; }
      catch (error) { if (error instanceof Error && error.name === "AbortError") return; }
    }
    await copy();
  };
  return <main id="main">
    <div className="breadcrumb"><Link href="/account">บัญชี</Link><span>/</span><span>แนะนำเพื่อน</span></div>
    <div className="page-head"><div><h1>แนะนำเพื่อน</h1><p>ส่งลิงก์ส่วนตัวให้เพื่อนสมัครสมาชิก ระบบจะบันทึกความสัมพันธ์การแนะนำแบบหนึ่งระดับตามเงื่อนไขแคมเปญที่มีผล</p></div></div>
    <section className="grid-2 referral-layout"><div className="stack"><section className="panel referral-hero"><div className="referral-icon">↗</div><span className="status success">ลิงก์พร้อมใช้งาน</span><h2>ชวนเพื่อนมาสมัคร Lottify</h2><p>เพื่อนต้องเปิดลิงก์นี้เพื่อให้ระบบผูกการแนะนำกับบัญชีของคุณตั้งแต่ขั้นตอนสมัคร</p><div className="referral-link-box"><label htmlFor="referral-link">ลิงก์แนะนำสมาชิก</label><div className="referral-link-row"><input id="referral-link" className="input" readOnly value={referralLink} /><button className="button primary" type="button" onClick={copy}>คัดลอก</button></div><div className="hint"><strong>{feedback}</strong></div></div><div className="referral-actions"><button className="button secondary" type="button" onClick={share}>แชร์ลิงก์</button><Link className="button secondary" href="/register?ref=LTF8421">เปิดหน้าสมัคร →</Link></div></section>
      <section className="panel"><div className="panel-title"><h2>การแนะนำล่าสุด</h2><span className="small muted">ตัวอย่างสถานะ Member-facing</span></div><div className="referral-list"><div className="referral-row"><div><strong>สมาชิก •••• 5912</strong><span>สมัครผ่านลิงก์ของคุณ · 10 ก.ย. 2569</span></div><span className="status info">กำลังตรวจเงื่อนไข</span></div><div className="referral-row"><div><strong>สมาชิก •••• 2274</strong><span>ผ่าน milestone ตามแคมเปญแล้ว</span></div><span className="status success">สำเร็จ</span></div></div></section></div>
      <aside className="stack"><section className="panel"><div className="panel-title"><h2>เงื่อนไขที่ควรรู้</h2></div><div className="notice info"><b>1</b><div><strong>แนะนำได้หนึ่งระดับ</strong>v1 บันทึกความสัมพันธ์ผู้แนะนำกับสมาชิกที่สมัครผ่านลิงก์โดยตรงเท่านั้น</div></div><div className="notice info" style={{ marginTop: 10 }}><b>2</b><div><strong>รางวัลขึ้นกับแคมเปญที่มีผล</strong>milestone และสิทธิ์รางวัลต้องผ่าน eligibility และ anti-abuse ก่อนจึงจะถือว่าได้รับสิทธิ์</div></div><div className="notice warning" style={{ marginTop: 10 }}><b>!</b><div><strong>สถานะสำเร็จไม่เท่ากับเงินเข้าทันที</strong>หากสิทธิ์มีผลทางการเงิน ระบบจะแสดงสำเร็จเมื่อการบันทึกยอดที่เกี่ยวข้องเสร็จสมบูรณ์แล้ว</div></div></section><section className="panel"><div className="panel-title"><h2>โปรโมชั่นของฉัน</h2><Link href="/promotions">ดูทั้งหมด →</Link></div><p className="muted small" style={{ lineHeight: 1.7 }}>ดูโบนัส ยอดเล่น และเงื่อนไขสิทธิ์ที่กำลังมีผลกับบัญชีของคุณ</p></section></aside>
    </section>
  </main>;
}
