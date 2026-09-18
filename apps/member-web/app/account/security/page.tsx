"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  memberApi,
  type MemberDeviceView,
  type MemberSessionView,
  type NotificationPreferences,
} from "../../lib/member-api";
import { useMemberSession } from "../../lib/member-session-client";
import { ErrorState, LoadingState, PageHeading, Section, StatusBadge } from "../../components/presentation";

export default function SecurityPage() {
  const router = useRouter();
  const memberSession = useMemberSession();
  const [sessions, setSessions] = useState<MemberSessionView[]>([]);
  const [devices, setDevices] = useState<MemberDeviceView[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoverySent, setRecoverySent] = useState(false);
  const [recoveryEvidence, setRecoveryEvidence] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [sessionResult, deviceResult, preferenceResult] = await Promise.allSettled([
      memberApi.listSessions(),
      memberApi.listDevices(),
      memberApi.getNotificationPreferences(),
    ]);
    const failures: unknown[] = [];
    if (sessionResult.status === "fulfilled") setSessions(sessionResult.value); else failures.push(sessionResult.reason);
    if (deviceResult.status === "fulfilled") setDevices(deviceResult.value); else failures.push(deviceResult.reason);
    if (preferenceResult.status === "fulfilled") setPreferences(preferenceResult.value); else failures.push(preferenceResult.reason);
    if (failures.length) setError(failures[0]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function revokeSession(id: string) {
    setBusyId(`session:${id}`);
    setError(null);
    try {
      await memberApi.revokeSession(id);
      setSessions((current) => current.filter((item) => item.sessionId !== id));
    } catch (cause) {
      setError(cause);
    } finally {
      setBusyId("");
    }
  }

  async function revokeDevice(id: string) {
    setBusyId(`device:${id}`);
    setError(null);
    try {
      await memberApi.revokeDevice(id);
      setDevices((current) => current.filter((item) => item.deviceId !== id));
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusyId("");
    }
  }

  async function revokeAll() {
    setBusyId("all");
    setError(null);
    try {
      await memberApi.revokeAll();
      router.replace("/login");
    } catch (cause) {
      setError(cause);
      setBusyId("");
    }
  }

  async function togglePreference(index: number) {
    if (!preferences) return;
    const items = preferences.items.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: !item.enabled } : item);
    setBusyId(`preference:${index}`);
    setError(null);
    try {
      setPreferences(await memberApi.updateNotificationPreferences({ preferences: items }));
    } catch (cause) {
      setError(cause);
    } finally {
      setBusyId("");
    }
  }

  async function requestRecoveryEvidence() {
    if (memberSession.status !== "authenticated") return;
    setBusyId("recovery-request");
    setError(null);
    setRecoveryEvidence("");
    try {
      await memberApi.requestRecoveryOtp(memberSession.session.phone);
      setRecoverySent(true);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusyId("");
    }
  }

  async function verifyRecoveryEvidence() {
    if (memberSession.status !== "authenticated" || recoveryCode.length !== 6) return;
    setBusyId("recovery-verify");
    setError(null);
    try {
      const result = await memberApi.verifyRecoveryOtp(memberSession.session.phone, recoveryCode);
      setRecoveryEvidence(result.evidenceRef);
      setRecoveryCode("");
      setRecoverySent(false);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusyId("");
    }
  }

  return <main id="main">
    <PageHeading
      eyebrow="SECURITY"
      title="เซสชัน อุปกรณ์ และช่องทางแจ้งเตือน"
      description="ข้อมูลทั้งหมดอ่านจาก server การ revoke ทำกับ resource จริง และ recovery OTP ด้านล่างสร้าง possession evidence เท่านั้น ไม่ถือว่ากู้คืนบัญชีสำเร็จ"
      action={<button className="button danger" type="button" disabled={busyId === "all"} onClick={() => void revokeAll()}>{busyId === "all" ? "กำลังยกเลิก…" : "ออกจากระบบทุกอุปกรณ์"}</button>}
    />

    {loading ? <LoadingState label="กำลังโหลด Session, Device และ Notification preferences…" /> : null}
    {error ? <div style={{ marginBottom: 16 }}><ErrorState error={error} retry={() => void load()} /></div> : null}

    <section className="grid-2">
      <div className="stack">
        <Section title="Sessions" subtitle={`${sessions.length} active session records`}>
          {sessions.length ? <div className="data-list">{sessions.map((item) => <div className="data-row" key={item.sessionId}>
            <div className="data-main"><strong>Session {item.sessionId}</strong><span>Device {item.deviceId ?? "ไม่ผูกอุปกรณ์"} · หมดอายุ {new Date(item.expiresAt).toLocaleString("th-TH")}</span></div>
            <button className="button danger" type="button" disabled={busyId === `session:${item.sessionId}`} onClick={() => void revokeSession(item.sessionId)}>{busyId === `session:${item.sessionId}` ? "กำลังยกเลิก…" : "ออกจากระบบ"}</button>
          </div>)}</div> : !loading ? <div className="state-card"><span className="state-symbol">○</span><div><strong>ไม่พบ Session</strong><p>รายการนี้สะท้อนข้อมูลจาก server เท่านั้น</p></div></div> : null}
        </Section>

        <Section title="Devices" subtitle={`${devices.length} recognized devices`}>
          {devices.length ? <div className="data-list">{devices.map((device) => <div className="data-row" key={device.deviceId}>
            <div className="data-main"><strong>{device.name ?? "อุปกรณ์ไม่ระบุชื่อ"}</strong><span>สร้าง {new Date(device.createdAt).toLocaleString("th-TH")} · ใช้ล่าสุด {device.lastUsedAt ? new Date(device.lastUsedAt).toLocaleString("th-TH") : "—"}</span></div>
            <button className="button danger" type="button" disabled={busyId === `device:${device.deviceId}`} onClick={() => void revokeDevice(device.deviceId)}>{busyId === `device:${device.deviceId}` ? "กำลังยกเลิก…" : "ยกเลิกอุปกรณ์"}</button>
          </div>)}</div> : !loading ? <div className="state-card"><span className="state-symbol">○</span><div><strong>ไม่พบ Device record</strong><p>Device ไม่ถูกใช้เป็นหลักฐานยืนยันตัวตนด้วยตัวเอง</p></div></div> : null}
        </Section>
      </div>

      <aside className="stack">
        <Section title="การแจ้งเตือน" subtitle="Notification preferences จาก API">
          {preferences ? <div className="data-list">{preferences.items.map((item, index) => <div className="data-row" key={`${item.topic}:${item.channel}`}>
            <div className="data-main"><strong>{topicLabel(item.topic)} · {item.channel}</strong><span>version {item.version} · อัปเดต {item.updatedAt ? new Date(item.updatedAt).toLocaleString("th-TH") : "ยังไม่เคยบันทึก"}</span></div>
            <button className="button secondary" type="button" disabled={busyId === `preference:${index}`} onClick={() => void togglePreference(index)}>{item.enabled ? "เปิดอยู่" : "ปิดอยู่"}</button>
          </div>)}</div> : null}
        </Section>

        <Section title="Recovery possession evidence" subtitle="ใช้ recovery/otp/request + recovery/otp/verify">
          {memberSession.status === "authenticated" ? <>
            {!recoverySent && !recoveryEvidence ? <button className="button secondary block" type="button" disabled={busyId === "recovery-request"} onClick={() => void requestRecoveryEvidence()}>{busyId === "recovery-request" ? "กำลังส่ง OTP…" : "ส่ง OTP เพื่อพิสูจน์การครอบครองเบอร์"}</button> : null}
            {recoverySent ? <div className="stack">
              <div className="notice warning"><b>!</b><div><strong>OTP นี้ใช้สร้างหลักฐานเท่านั้น</strong>ไม่เปลี่ยนเบอร์ ไม่เปลี่ยนข้อมูล Member และไม่ถือว่า account recovery สำเร็จ</div></div>
              <div className="field"><label htmlFor="recovery-code">OTP 6 หลัก</label><input id="recovery-code" inputMode="numeric" maxLength={6} value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></div>
              <button className="button primary block" type="button" disabled={recoveryCode.length !== 6 || busyId === "recovery-verify"} onClick={() => void verifyRecoveryEvidence()}>{busyId === "recovery-verify" ? "กำลังยืนยัน…" : "ยืนยัน possession evidence"}</button>
            </div> : null}
            {recoveryEvidence ? <div className="notice success"><b>✓</b><div><strong>สร้าง possession evidence แล้ว</strong><span style={{ overflowWrap: "anywhere" }}>{recoveryEvidence}</span><br />ขั้นตอน recovery ที่ต้องใช้ KYC/Risk/manual review ยังเป็นคนละ workflow</div></div> : null}
          </> : <div className="state-card"><span className="state-symbol">!</span><div><strong>ต้องมี Member session</strong><p>เข้าสู่ระบบก่อนสร้าง recovery evidence จากบัญชีนี้</p></div></div>}
        </Section>

        <div className="notice info"><b>i</b><div><strong>Server เป็นผู้ตัดสินสิทธิ์</strong>Device, OTP และ session เป็น evidence คนละชนิด ไม่ถูกนำมารวมเป็น boolean “trusted” ใน client</div></div>
        <Link className="button secondary block" href="/account">← กลับบัญชี</Link>
      </aside>
    </section>
  </main>;
}

function topicLabel(topic: string): string {
  const labels: Record<string, string> = {
    TRANSACTIONAL: "ธุรกรรม",
    SECURITY: "ความปลอดภัย",
    PROMOTIONAL: "โปรโมชั่น",
    RESULT: "ผลหวย",
  };
  return labels[topic] ?? topic;
}
