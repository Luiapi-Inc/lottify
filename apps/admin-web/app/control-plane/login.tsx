"use client";

import type { FormEvent } from "react";
import { useCallback, useState } from "react";
import type { components } from "@lottify/contracts";
import { AdminApi } from "./admin-api";

type AdminMe = components["schemas"]["AdminMeResponse"];
type AdminAccessTokenResponse = components["schemas"]["AdminAccessTokenResponse"];

interface SetupState {
  token: string;
  secret: string;
}

/**
 * Session bootstrap for the control plane. Uses only the Admin auth contract
 * (login → MFA challenge / TOTP setup → verify). Keeps the access token in
 * memory and relies on the HttpOnly refresh cookie for subsequent loads.
 */
export function useAdminSession(api: AdminApi) {
  const [admin, setAdmin] = useState<AdminMe | null>(null);
  const [booting, setBooting] = useState(true);

  const loadMe = useCallback(async (): Promise<void> => {
    setBooting(true);
    try {
      // The authoritative Admin contract declares POST /auth/me.
      const me = await api.request<AdminMe>("auth/me", {});
      setAdmin(me);
    } catch (error) {
      setAdmin(null);
      throw error;
    } finally {
      setBooting(false);
    }
  }, [api]);

  return { admin, booting, loadMe };
}

export function AdminLogin({
  api,
  onLogin,
}: {
  api: AdminApi;
  onLogin: () => Promise<void>;
}) {
  const [challenge, setChallenge] = useState("");
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (setup) {
        await api.publicRequest("auth/mfa/confirm", {
          setupToken: setup.token,
          secret: setup.secret,
          code: String(data.get("code") ?? "").trim(),
        });
        setSetup(null);
        setError("เปิดใช้งาน MFA แล้ว กรุณาเข้าสู่ระบบอีกครั้ง");
      } else if (challenge) {
        const verified = await api.publicRequest<AdminAccessTokenResponse>(
          "auth/mfa/verify",
          {
            challengeToken: challenge,
            code: String(data.get("code") ?? "").trim(),
          },
        );
        await api.accept(verified.accessToken);
        await onLogin();
      } else {
        const started = await api.publicRequest<{
          status: string;
          challengeToken?: string;
          setupToken?: string;
        }>("auth/login", {
          email: String(data.get("email") ?? "").trim(),
          password: String(data.get("password") ?? ""),
        });
        if (started.challengeToken) {
          setChallenge(started.challengeToken);
        } else if (started.setupToken) {
          const enrolled = await api.publicRequest<{ secret: string }>("auth/mfa/setup", {
            setupToken: started.setupToken,
          });
          setSetup({ token: started.setupToken, secret: enrolled.secret });
        } else {
          throw new Error("ไม่สามารถเริ่มต้น session ได้");
        }
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง",
      );
    } finally {
      setBusy(false);
    }
  }

  const showCredentials = !challenge && !setup;

  return (
    <section className="cp-login" aria-labelledby="cp-login-title">
      <div className="cp-brand-mark" aria-hidden="true">
        L
      </div>
      <h1 id="cp-login-title">เข้าสู่ระบบ Admin</h1>
      <p>พื้นที่ปฏิบัติงานสำหรับการควบคุมและกำกับดูแลระบบ Lottify</p>
      <form className="cp-login-form" onSubmit={submit}>
        {showCredentials ? (
          <>
            <label>
              <span>อีเมล</span>
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                disabled={busy}
              />
            </label>
            <label>
              <span>รหัสผ่าน</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={busy}
              />
            </label>
          </>
        ) : setup ? (
          <>
            <p className="cp-login-note">
              เพิ่ม secret นี้ในแอป Authenticator แล้วกรอกรหัสยืนยัน 6 หลัก
            </p>
            <code className="cp-secret">{setup.secret}</code>
          </>
        ) : (
          <p className="cp-login-note">ยืนยันรหัส MFA 6 หลักเพื่อเปิด session</p>
        )}

        {!showCredentials ? (
          <label>
            <span>รหัส MFA 6 หลัก</span>
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              disabled={busy}
            />
          </label>
        ) : null}

        {error ? (
          <p className="cp-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="cp-login-actions">
          <button className="cp-button cp-button-primary" disabled={busy}>
            {busy ? "กำลังตรวจสอบ…" : challenge || setup ? "ยืนยัน MFA" : "เข้าสู่ระบบ"}
          </button>
          {!showCredentials ? (
            <button
              type="button"
              className="cp-button"
              disabled={busy}
              onClick={() => {
                setChallenge("");
                setSetup(null);
                setError("");
              }}
            >
              กลับไปเข้าสู่ระบบ
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
