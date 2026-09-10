"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Device = { id: string; icon: string; name: string; detail: string; current?: boolean };
type Action = { type: "revoke"; device: Device } | { type: "logout-all" } | { type: "recovery" };
type Stage = "closed" | "review" | "verify" | "success";

const initialDevices: Device[] = [
  { id: "current", icon: "PC", name: "Hermes Desktop · อุปกรณ์นี้", detail: "กรุงเทพฯ · ใช้งานล่าสุดเมื่อสักครู่", current: true },
  { id: "android", icon: "MB", name: "Chrome on Android", detail: "กรุงเทพฯ · 10 ก.ย. 08:10" },
  { id: "ipad", icon: "TB", name: "Safari on iPad", detail: "ปทุมธานี · 8 ก.ย. 19:44" },
];

function config(action: Action | null) {
  if (!action) return null;
  if (action.type === "revoke") return { title: `ออกจากระบบ ${action.device.name}?`, copy: "อุปกรณ์นี้จะใช้เซสชันเดิมต่อไม่ได้ และต้องเข้าสู่ระบบใหม่หากต้องการใช้งานอีกครั้ง", note: "เพื่อป้องกันการออกจากระบบโดยไม่ตั้งใจ ระบบจะขอ OTP ก่อนดำเนินการ", verify: true, successTitle: "ออกจากระบบอุปกรณ์แล้ว", successCopy: `${action.device.name} ถูกยกเลิกเซสชันเรียบร้อยแล้ว` };
  if (action.type === "logout-all") return { title: "ออกจากระบบทุกอุปกรณ์?", copy: "เซสชันทั้งหมดรวมถึงอุปกรณ์นี้จะถูกยกเลิก หลังดำเนินการคุณต้องเข้าสู่ระบบใหม่", note: "รายการนี้กระทบทุกอุปกรณ์ ระบบจะขอ OTP ก่อนดำเนินการ", verify: true, successTitle: "ออกจากระบบทุกอุปกรณ์แล้ว", successCopy: "เซสชันทั้งหมดถูกยกเลิกแล้ว กรุณาเข้าสู่ระบบใหม่เมื่อต้องการใช้งาน" };
  return { title: "เริ่มคำขอกู้คืนบัญชี?", copy: "ใช้กรณีที่คุณเข้าถึงช่องทางเดิมไม่ได้ ระบบจะบันทึกคำขอและแจ้งข้อมูลหรือหลักฐานที่ต้องใช้ในขั้นตอนถัดไป", note: "การยืนยันเบอร์ใหม่เพียงอย่างเดียวไม่ถือว่ากู้คืนสำเร็จ และระบบจะไม่เปลี่ยนข้อมูลสำคัญจนกว่าการตรวจสอบจะเสร็จ", verify: false, successTitle: "สร้างคำขอกู้คืนแล้ว", successCopy: "เก็บเลขอ้างอิงนี้ไว้เพื่อตรวจสถานะหรือใช้เมื่อติดต่อเจ้าหน้าที่" };
}

export default function SecurityPage() {
  const router = useRouter();
  const [devices, setDevices] = useState(initialDevices);
  const [action, setAction] = useState<Action | null>(null);
  const [stage, setStage] = useState<Stage>("closed");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const activeConfig = config(action);
  const open = (next: Action) => { setAction(next); setStage("review"); setOtp(""); setError(""); };
  const close = () => { setAction(null); setStage("closed"); setOtp(""); setError(""); };
  const complete = () => {
    if (!action) return;
    if (action.type === "revoke") setDevices((items) => items.filter((item) => item.id !== action.device.id));
    if (action.type === "logout-all") setDevices([]);
    setStage("success");
  };
  const start = () => activeConfig?.verify ? setStage("verify") : complete();
  const verify = () => {
    if (otp.length !== 6) return setError("กรอกรหัส OTP ให้ครบ 6 หลัก");
    setError(""); complete();
  };

  return <main id="main">
    <div className="breadcrumb"><Link href="/account">บัญชี</Link><span>/</span><span>ความปลอดภัย</span></div>
    <div className="page-head"><div><h1>ความปลอดภัย</h1><p>ตรวจอุปกรณ์ที่เข้าใช้งาน ออกจากระบบรายอุปกรณ์ ออกจากระบบทั้งหมด และเริ่มกู้คืนบัญชีเมื่อจำเป็น</p></div><button className="button danger" type="button" onClick={() => open({ type: "logout-all" })}>ออกจากระบบทุกอุปกรณ์</button></div>
    <section className="grid-2"><div className="stack"><section className="panel"><div className="panel-title"><h2>อุปกรณ์และการเข้าสู่ระบบ</h2><span className={`status ${devices.length ? "success" : "neutral"}`}>{devices.length} เซสชัน</span></div>
      {devices.some((device) => device.id === "android") && <div className="notice warning security-device-alert"><b>!</b><div><strong>มีการเข้าสู่ระบบจาก Chrome on Android วันนี้ 08:10</strong>หากเป็นคุณไม่ต้องทำอะไร หากไม่ใช่คุณให้ออกจากระบบอุปกรณ์นั้นและยืนยันตัวตนอีกครั้ง</div></div>}
      <div className="device-list">{devices.length ? devices.map((device) => <div className="device-row" key={device.id}><div className="device-icon">{device.icon}</div><div><strong>{device.name}</strong><span>{device.detail}</span></div>{device.current ? <span className="status success">ปัจจุบัน</span> : <button className="button danger" type="button" onClick={() => open({ type: "revoke", device })}>ออกจากระบบ</button>}</div>) : <div className="notice success"><b>✓</b><div><strong>ออกจากระบบทุกอุปกรณ์แล้ว</strong>เซสชันทั้งหมดถูกยกเลิก กรุณาเข้าสู่ระบบใหม่</div></div>}</div>
    </section></div><aside className="stack"><section className="panel"><div className="panel-title"><h2>การยืนยันสำหรับรายการสำคัญ</h2></div><div className="notice info"><b>i</b><div><strong>ระบบอาจขอ OTP หรือยืนยันซ้ำ</strong>ใช้สำหรับเปลี่ยนข้อมูลสำคัญ ถอนเงิน และจัดการอุปกรณ์ ตามสิทธิ์ที่คุณยังเข้าถึงได้</div></div></section><section className="panel" id="recovery"><div className="panel-title"><h2>กู้คืนบัญชี</h2></div><p className="muted small" style={{ lineHeight: 1.8 }}>หากเข้าถึงเบอร์โทรเดิมไม่ได้ สามารถเริ่มคำขอกู้คืน ระบบจะขอข้อมูลหรือหลักฐานที่จำเป็นตามสถานการณ์ การยืนยันเบอร์ใหม่เพียงอย่างเดียวไม่ถือว่ากู้คืนสำเร็จ</p><button className="button secondary block" type="button" style={{ marginTop: 14 }} onClick={() => open({ type: "recovery" })}>เริ่มคำขอกู้คืนบัญชี</button></section></aside></section>

    {stage !== "closed" && activeConfig && <div className="security-overlay"><section className="security-sheet" role="dialog" aria-modal="true" aria-labelledby="security-flow-title"><button className="security-sheet-close" type="button" aria-label="ปิด" onClick={close}>×</button>
      {stage === "review" && <div className="security-flow-state"><span className="security-step">ตรวจสอบรายการ</span><h2 id="security-flow-title">{activeConfig.title}</h2><p>{activeConfig.copy}</p><div className="notice warning"><b>!</b><div><strong>รายการสำคัญ</strong><span>{activeConfig.note}</span></div></div><div className="security-sheet-actions"><button className="button secondary" type="button" onClick={close}>ยกเลิก</button><button className="button primary" type="button" onClick={start}>{activeConfig.verify ? "ส่ง OTP เพื่อยืนยัน" : "เริ่มคำขอ"}</button></div></div>}
      {stage === "verify" && <div className="security-flow-state"><span className="security-step">ขั้นตอนยืนยันตัวตน</span><h2>ยืนยันว่าเป็นคุณ</h2><p>กรอกรหัส OTP 6 หลักที่ส่งไปยังเบอร์โทรที่ยืนยันไว้ รหัสใช้ได้ครั้งเดียว</p><div className="otp-grid security-otp">{Array.from({ length: 6 }, (_, index) => <input key={index} inputMode="numeric" maxLength={1} aria-label={`OTP หลักที่ ${index + 1}`} value={otp[index] ?? ""} onChange={(event) => { const digit = event.target.value.replace(/\D/g, "").slice(0, 1); setOtp(`${otp.slice(0, index)}${digit}${otp.slice(index + 1)}`.slice(0, 6)); }} />)}</div><div className="field-error">{error}</div><div className="security-sheet-actions"><button className="button secondary" type="button" onClick={() => setStage("review")}>ย้อนกลับ</button><button className="button primary" type="button" onClick={verify}>ยืนยันและดำเนินการ</button></div></div>}
      {stage === "success" && <div className="security-flow-state security-flow-success"><div className="security-success-icon">✓</div><span className="security-step">ดำเนินการสำเร็จ</span><h2>{activeConfig.successTitle}</h2><p>{activeConfig.successCopy}</p>{action?.type === "recovery" && <div className="security-reference"><strong>เลขอ้างอิง REC-20260910-001</strong>สถานะ: รับคำขอแล้ว · รอขั้นตอนตรวจสอบถัดไป</div>}<div className="security-sheet-actions"><button className="button primary block" type="button" onClick={() => action?.type === "logout-all" ? router.push("/login") : close()}>{action?.type === "logout-all" ? "ไปหน้าเข้าสู่ระบบ" : "เสร็จสิ้น"}</button></div></div>}
    </section></div>}
  </main>;
}
