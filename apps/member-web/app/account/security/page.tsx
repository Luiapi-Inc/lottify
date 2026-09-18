"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  memberApi,
  type MemberDeviceView,
  type MemberSessionView,
} from "../../lib/member-api";
import { describeMemberApiFailure, formatDateTime } from "../../lib/member-display";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; sessions: MemberSessionView[]; devices: MemberDeviceView[] }
  | { status: "failed"; message: string; code: string; correlationId?: string };

type ActionState =
  | { status: "idle" }
  | { status: "working"; label: string }
  | { status: "failed"; code: string; message: string; correlationId?: string };

export default function SecurityPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [action, setAction] = useState<ActionState>({ status: "idle" });
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);

  const load = useCallback(async () => {
    // Sessions and devices are two separate reads; both come straight from the
    // identity-access service, so a rendered row always exists on the server.
    const [sessions, devices] = await Promise.all([memberApi.listSessions(), memberApi.listDevices()]);
    return { sessions, devices };
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

  const revokeDevice = async (device: MemberDeviceView) => {
    setAction({ status: "working", label: "กำลังออกจากระบบอุปกรณ์" });
    try {
      await memberApi.revokeDevice(device.deviceId);
      setState(await load().then((data) => ({ status: "ready" as const, ...data })));
      setAction({ status: "idle" });
    } catch (error) {
      const failure = describeMemberApiFailure(error);
      setAction({ status: "failed", code: failure.code, message: failure.message, correlationId: failure.correlationId });
    }
  };

  const revokeSession = async (session: MemberSessionView) => {
    setAction({ status: "working", label: "กำลังยกเลิกเซสชัน" });
    try {
      await memberApi.revokeSession(session.sessionId);
      setState(await load().then((data) => ({ status: "ready" as const, ...data })));
      setAction({ status: "idle" });
    } catch (error) {
      const failure = describeMemberApiFailure(error);
      setAction({ status: "failed", code: failure.code, message: failure.message, correlationId: failure.correlationId });
    }
  };

  const revokeAll = async () => {
    setAction({ status: "working", label: "กำลังออกจากระบบทุกอุปกรณ์" });
    try {
      await memberApi.revokeAllSessions();
      // Every session is gone, including this one: the only honest destination
      // is the sign-in page.
      router.replace("/login");
    } catch (error) {
      const failure = describeMemberApiFailure(error);
      setAction({ status: "failed", code: failure.code, message: failure.message, correlationId: failure.correlationId });
      setConfirmRevokeAll(false);
    }
  };

  if (state.status === "loading") {
    return <main id="main"><div className="breadcrumb"><Link href="/account">บัญชี</Link><span>/</span><span>ความปลอดภัย</span></div><section className="panel"><div className="panel-title"><h2>กำลังโหลดอุปกรณ์และเซสชัน</h2></div><p className="muted small">กำลังดึงรายการเซสชันและอุปกรณ์จาก API…</p></section></main>;
  }

  if (state.status === "failed") {
    return <main id="main"><div className="breadcrumb"><Link href="/account">บัญชี</Link><span>/</span><span>ความปลอดภัย</span></div><section className="panel"><div className="panel-title"><h2>โหลดข้อมูลความปลอดภัยไม่สำเร็จ</h2><span className="status danger">{state.code}</span></div><p className="muted small">{state.message}</p>{state.correlationId && <p className="muted small">รหัสอ้างอิง: {state.correlationId}</p>}</section></main>;
  }

  const { sessions, devices } = state;

  return <main id="main">
    <div className="breadcrumb"><Link href="/account">บัญชี</Link><span>/</span><span>ความปลอดภัย</span></div>
    <div className="page-head"><div><h1>ความปลอดภัย</h1><p>เซสชันและอุปกรณ์ด้านล่างคือรายการจริงที่ระบบยืนยันตัวตนบันทึกไว้สำหรับบัญชีของคุณ</p></div><button className="button danger" type="button" onClick={() => setConfirmRevokeAll(true)} disabled={action.status === "working"}>ออกจากระบบทุกอุปกรณ์</button></div>
    {action.status === "failed" && <div className="notice warning" aria-live="polite"><b>!</b><div><strong>ดำเนินการไม่สำเร็จ ({action.code})</strong>{action.message}{action.correlationId ? ` · รหัสอ้างอิง ${action.correlationId}` : ""}</div></div>}
    <section className="grid-2"><div className="stack">
      <section className="panel"><div className="panel-title"><h2>อุปกรณ์ที่เข้าใช้งาน</h2><span className={`status ${devices.length ? "success" : "neutral"}`}>{devices.length} อุปกรณ์</span></div>
        {devices.length === 0
          ? <div className="notice info"><b>i</b><div><strong>ยังไม่มีอุปกรณ์ที่บันทึกไว้</strong>อุปกรณ์จะปรากฏเมื่อมีการเข้าสู่ระบบพร้อมชื่ออุปกรณ์</div></div>
          : <div className="device-list">{devices.map((device) => <div className="device-row" key={device.deviceId}><div className="device-icon">{device.name ? device.name.slice(0, 2).toUpperCase() : "DV"}</div><div><strong>{device.name ?? "ไม่ระบุชื่ออุปกรณ์"}</strong><span>รหัสอุปกรณ์ {device.deviceId} · ใช้งานล่าสุด {device.lastUsedAt ? formatDateTime(device.lastUsedAt) : "—"} · สร้างเมื่อ {formatDateTime(device.createdAt)}</span></div><button className="button danger" type="button" onClick={() => revokeDevice(device)} disabled={action.status === "working"}>ออกจากระบบอุปกรณ์นี้</button></div>)}</div>}
      </section>
      <section className="panel"><div className="panel-title"><h2>เซสชันที่ยังใช้งานได้</h2><span className={`status ${sessions.length ? "success" : "neutral"}`}>{sessions.length} เซสชัน</span></div>
        {sessions.length === 0
          ? <div className="notice info"><b>i</b><div><strong>ไม่มีเซสชันที่ใช้งานได้</strong>เมื่อคุณเข้าสู่ระบบใหม่ เซสชันจะแสดงที่นี่</div></div>
          : <div className="device-list">{sessions.map((session) => <div className="device-row" key={session.sessionId}><div className="device-icon">SS</div><div><strong>เซสชัน {session.sessionId.slice(0, 8)}…</strong><span>อุปกรณ์ {session.deviceId ?? "ไม่ระบุ"} · หมดอายุ {formatDateTime(session.expiresAt)}</span></div><button className="button danger" type="button" onClick={() => revokeSession(session)} disabled={action.status === "working"}>ยกเลิกเซสชันนี้</button></div>)}</div>}
      </section>
    </div>
    <aside className="stack">
      <section className="panel"><div className="panel-title"><h2>การยืนยันสำหรับรายการสำคัญ</h2></div><div className="notice info"><b>i</b><div><strong>การเปลี่ยนข้อมูลสำคัญและการถอนเงินมีการยืนยันแยก</strong>ระบบจะขอรหัสยืนยันในการทำรายการที่มีความอ่อนไหวเสมอ</div></div><p className="muted small" style={{ marginTop: 10 }}>หน้านี้จัดการเฉพาะเซสชันและอุปกรณ์ รหัสผ่านและกู้คืนบัญชีจัดการได้จากหน้าเข้าสู่ระบบและกู้คืนบัญชี</p><Link className="text-link" href="/forgot-password" style={{ display: "inline-block", marginTop: 10 }}>กู้คืนบัญชี / ตั้งรหัสผ่านใหม่ →</Link></section>
      <Link className="button secondary block" href="/account">← กลับบัญชี</Link>
    </aside></section>

    {confirmRevokeAll && <div className="security-overlay"><section className="security-sheet" role="dialog" aria-modal="true" aria-labelledby="security-flow-title"><button className="security-sheet-close" type="button" aria-label="ปิด" onClick={() => setConfirmRevokeAll(false)}>×</button>
      <div className="security-flow-state"><span className="security-step">ตรวจสอบรายการ</span><h2 id="security-flow-title">ออกจากระบบทุกอุปกรณ์?</h2><p>เซสชันทั้งหมดรวมถึงอุปกรณ์นี้จะถูกยกเลิกทันที และคุณต้องเข้าสู่ระบบใหม่</p><div className="notice warning"><b>!</b><div><strong>รายการสำคัญ</strong><span>คำสั่งนี้เรียกใช้การยกเลิกเซสชันทั้งหมดของบัญชีนี้</span></div></div><div className="security-sheet-actions"><button className="button secondary" type="button" onClick={() => setConfirmRevokeAll(false)}>ยกเลิก</button><button className="button danger" type="button" onClick={revokeAll} disabled={action.status === "working"}>{action.status === "working" ? "กำลังดำเนินการ…" : "ยืนยันยกเลิกทุกเซสชัน"}</button></div></div>
    </section></div>}
  </main>;
}
