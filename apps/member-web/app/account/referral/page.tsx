"use client";

import Link from "next/link";

/**
 * Member referral.
 *
 * The Member API on origin/main exposes no referral resource: no
 * `/api/v1/member/referral*` route exists in any Member controller. This page
 * therefore renders no referral code, link or referral list — a fabricated
 * code or a fake list of referred members would be invented data. What it does
 * show is the outcome of the Promotions resource the API really serves
 * (`GET /api/v1/member/promotions/entitlements`), which is where any referral
 * reward would surface, plus the exact missing contract for the Lead.
 */
export default function ReferralPage() {
  return <main id="main">
    <div className="breadcrumb"><Link href="/account">บัญชี</Link><span>/</span><span>แนะนำเพื่อน</span></div>
    <div className="page-head"><div><h1>แนะนำเพื่อน</h1><p>หน้านี้ยังไม่สามารถแสดงรหัสหรือลิงก์แนะนำได้ เพราะ Member API ยังไม่มี endpoint ของการแนะนำสมาชิก</p></div></div>
    <section className="grid-2 referral-layout">
      <div className="stack">
        <section className="panel referral-hero">
          <div className="referral-icon">↗</div>
          <span className="status warning">ยังไม่เปิดใช้งาน</span>
          <h2>ระบบแนะนำสมาชิกยังไม่พร้อมให้ใช้งานบน Member API</h2>
          <p>ตามหลักการไม่ประดิษฐ์สัญญา (no invented contract) หน้านี้จะไม่แสดงรหัสแนะนำ ลิงก์แนะนำ หรือรายการผู้ถูกแนะนำที่ระบบยังไม่ได้รับจากเซิร์ฟเวอร์ เพราะข้อมูลดังกล่าวจะไม่ใช่ข้อมูลจริงของคุณ</p>
          <div className="notice warning" style={{ marginTop: 14 }}><b>!</b><div><strong>endpoint ที่ขาด</strong>Member API ปัจจุบันไม่มี GET /api/v1/member/referral (รหัสและลิงก์แนะนำ) และไม่มี GET /api/v1/member/referrals (รายการแนะนำพร้อมสถานะ) ใน controller ใดบน origin/main จึงยังไม่มีที่มาของข้อมูลให้ผูก</div></div>
          <div className="notice info" style={{ marginTop: 10 }}><b>i</b><div><strong>มีอะไรใช้ได้ตอนนี้</strong>รางวัลจากการแนะนำ (ถ้ามี) จะปรากฏเป็นสิทธิ์โปรโมชั่นของบัญชีคุณ ซึ่งดูได้จากหน้าสิทธิ์โบนัสและยอดเล่น</div></div>
          <div className="referral-actions"><Link className="button secondary" href="/promotions">ดูสิทธิ์โบนัสของฉัน →</Link><Link className="button secondary" href="/account">← กลับบัญชี</Link></div>
        </section>
      </div>
      <aside className="stack">
        <section className="panel"><div className="panel-title"><h2>เงื่อนไขที่ระบบจะใช้</h2></div>
          <div className="notice info"><b>1</b><div><strong>แนะนำได้หนึ่งระดับ</strong>v1 บันทึกความสัมพันธ์ผู้แนะนำกับสมาชิกที่สมัครผ่านลิงก์โดยตรงเท่านั้น</div></div>
          <div className="notice info" style={{ marginTop: 10 }}><b>2</b><div><strong>รางวัลขึ้นกับแคมเปญที่มีผล</strong>milestone และสิทธิ์รางวัลต้องผ่าน eligibility และ anti-abuse ก่อนจึงจะถือว่าได้รับสิทธิ์</div></div>
          <div className="notice warning" style={{ marginTop: 10 }}><b>!</b><div><strong>สถานะสำเร็จไม่เท่ากับเงินเข้าทันที</strong>หากสิทธิ์มีผลทางการเงิน ระบบจะแสดงสำเร็จเมื่อการบันทึกยอดที่เกี่ยวข้องเสร็จสมบูรณ์แล้ว</div></div>
        </section>
        <section className="panel"><div className="panel-title"><h2>โปรโมชั่นของฉัน</h2><Link href="/promotions">ดูทั้งหมด →</Link></div><p className="muted small" style={{ lineHeight: 1.7 }}>ดูโบนัส ยอดเล่น และเงื่อนไขสิทธิ์ที่กำลังมีผลกับบัญชีของคุณจากข้อมูลจริงของระบบโปรโมชั่น</p></section>
      </aside>
    </section>
  </main>;
}
