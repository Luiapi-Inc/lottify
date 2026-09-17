"use client";

import type { components } from "@lottify/contracts";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { accountingPeriodCancellationUi } from "./accounting-period-cancellation-ui";
import { AdminApi, ApiFailure } from "./control-plane/admin-api";
import { AdminShell, adminLogout } from "./control-plane/shell";

type AccountingPeriod = components["schemas"]["AccountingPeriodResponse"];
type AccountingPeriodCommand = components["schemas"]["AccountingPeriodCommandResponse"];
type ApiError = components["schemas"]["ApiErrorResponse"];
type AdminMe = components["schemas"]["AdminMeResponse"];
type CreateCustomBody = components["schemas"]["CreateCustomAccountingPeriodBody"];
type SubmitBody = components["schemas"]["SubmitAccountingPeriodBody"];
type ApproveBody = components["schemas"]["ApproveAccountingPeriodBody"];
type CancelBody = components["schemas"]["CancelAccountingPeriodBody"];
type CancellationResponse = components["schemas"]["AccountingPeriodCancellationResponse"];

type BusyAction =
  | "session"
  | "create"
  | "submit"
  | "approve"
  | "cancel"
  | "refresh"
  | null;

const ACCOUNTING_PERIOD_APPROVAL_ACTION_CLASS = "accounting-period.approve";
const ACCOUNTING_PERIOD_CANCELLATION_ACTION_CLASS = "accounting-period.cancel";

export default function AccountingPeriodWorkspace() {
  const [api] = useState(() => new AdminApi());
  const [admin, setAdmin] = useState<AdminMe | null>(null);
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [draft, setDraft] = useState<AccountingPeriodCommand | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [approvalPeriodId, setApprovalPeriodId] = useState<string | null>(null);
  const [approvalCode, setApprovalCode] = useState("");
  const [cancellationPeriodId, setCancellationPeriodId] = useState<string | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancellationCode, setCancellationCode] = useState("");
  const [busy, setBusy] = useState<BusyAction>("session");
  const [error, setError] = useState<ApiError | null>(null);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);

  const loadPeriods = useCallback(async () => {
    const loaded: AccountingPeriod[] = [];
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams({ limit: "100" });
      if (cursor) params.set("cursor", cursor);
      const page = await api.request<components["schemas"]["AccountingPeriodListResponse"]>(
        `accounting-periods?${params}`,
      );
      loaded.push(...page.items);
      cursor = page.nextCursor ?? null;
    } while (cursor);
    setPeriods(loaded);
  }, [api]);

  const initializeSession = useCallback(async () => {
    setBusy("session");
    setError(null);
    setSessionUnavailable(false);
    try {
      const me = await api.request<AdminMe>("auth/me", {});
      setAdmin(me);
      await loadPeriods();
    } catch {
      api.clear();
      setAdmin(null);
      setSessionUnavailable(true);
    } finally {
      setBusy(null);
    }
  }, [api, loadPeriods]);

  useEffect(() => {
    void initializeSession();
  }, [initializeSession]);

  const canCreate =
    admin?.capabilities.includes("accounting-period.create-custom") === true;

  async function createCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload: CreateCustomBody = { startDate, endDate, reason };
    setBusy("create");
    setError(null);
    try {
      const result = await api.request<AccountingPeriodCommand>(
        "accounting-periods/create-custom",
        payload,
        true,
      );
      setDraft(result);
      await loadPeriods();
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function submitDraft() {
    if (!draft) return;
    const payload: SubmitBody = { expectedVersion: draft.period.version };
    setBusy("submit");
    setError(null);
    try {
      const result = await api.request<AccountingPeriodCommand>(
        `accounting-periods/${encodeURIComponent(draft.period.id)}/submit`,
        payload,
        true,
      );
      setDraft(result);
      await loadPeriods();
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function approvePending(period: AccountingPeriod) {
    if (!/^\d{6}$/.test(approvalCode)) {
      setError({
        code: "VALIDATION_ERROR",
        message: "กรอกรหัส MFA 6 หลักเพื่อยืนยันการอนุมัติ",
        details: { field: "code" },
        correlationId: "client-validation",
      });
      return;
    }
    const payload: ApproveBody = { expectedVersion: period.version };
    setBusy("approve");
    setError(null);
    try {
      await api.request("auth/reauth", {
          actionClass: ACCOUNTING_PERIOD_APPROVAL_ACTION_CLASS,
          code: approvalCode,
        });

      const result = await api.request<AccountingPeriodCommand>(
        `accounting-periods/${encodeURIComponent(period.id)}/approve`,
        payload,
        true,
      );
      if (draft?.period.id === period.id) setDraft(result);
      setApprovalPeriodId(null);
      setApprovalCode("");
      await loadPeriods();
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function cancelPeriod(period: AccountingPeriod) {
    const reason = cancellationReason.trim();
    const cancellationUi = accountingPeriodCancellationUi(period);
    const approvingCancellation = cancellationUi?.requiresMfa === true;
    if (!reason) {
      setError({
        code: "VALIDATION_ERROR",
        message: "ระบุเหตุผลสำหรับการยกเลิกหรือถอนคำขอ",
        details: { field: "reason" },
        correlationId: "client-validation",
      });
      return;
    }
    if (approvingCancellation && !/^\d{6}$/.test(cancellationCode)) {
      setError({
        code: "VALIDATION_ERROR",
        message: "กรอกรหัส MFA 6 หลักเพื่ออนุมัติการยกเลิกช่วงที่ SCHEDULED",
        details: { field: "code" },
        correlationId: "client-validation",
      });
      return;
    }

    const payload: CancelBody = { expectedVersion: period.version, reason };
    setBusy("cancel");
    setError(null);
    try {
      if (approvingCancellation) {
        await api.request("auth/reauth", {
            actionClass: ACCOUNTING_PERIOD_CANCELLATION_ACTION_CLASS,
            code: cancellationCode,
          });
      }

      const result = await api.request<CancellationResponse>(
        `accounting-periods/${encodeURIComponent(period.id)}/cancel`,
        payload,
        true,
      );
      if (draft?.period.id === period.id) setDraft(null);
      setPeriods((current) =>
        current.map((item) => (item.id === result.period.id ? result.period : item)),
      );
      setCancellationPeriodId(null);
      setCancellationReason("");
      setCancellationCode("");
      await loadPeriods();
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setBusy(null);
    }
  }

  function beginAnotherDraft() {
    setDraft(null);
    setStartDate("");
    setEndDate("");
    setReason("");
    setError(null);
    api.clear();
  }

  async function signOut() {
    await adminLogout(api, async () => {
      setAdmin(null);
      setSessionUnavailable(true);
    })();
  }

  if (busy === "session") {
    return <div className="shell-state">กำลังตรวจสอบ Admin session…</div>;
  }

  if (sessionUnavailable || !admin) {
    return (
      <main className="session-required">
        <section className="session-panel" aria-labelledby="session-title">
          <h1 id="session-title">ต้องมี Admin session ที่ยืนยัน MFA แล้ว</h1>
          <p>
            หน้านี้ใช้ session และ HttpOnly refresh credential ของ Admin API เดิม
            โดยไม่เก็บ access token แบบถาวรใน browser
          </p>
          <button type="button" className="primary-button" onClick={() => void initializeSession()}>
            ตรวจสอบ session อีกครั้ง
          </button>
        </section>
      </main>
    );
  }

  return (
    <AdminShell
      admin={admin}
      activeKey="finance"
      onLogout={() => void signOut()}
      breadcrumb="การเงิน / Accounting Period"
      title="Accounting Period"
      subtitle="ช่วงบัญชีที่ระบบรับรอง การอนุมัติ และการปิดรอบอย่างเป็นทางการ · เวลาอ้างอิง Asia/Bangkok"
    >
        {error ? (
          <div className="error-banner" role="alert">
            <strong>{error.code}</strong>
            <span>{error.message}</span>
            <small>Correlation: {error.correlationId}</small>
          </div>
        ) : null}

        <section className="coverage-section" aria-labelledby="coverage-title">
          <div className="section-heading">
            <div>
              <h2 id="coverage-title">ช่วงบัญชีที่ระบบรับรอง</h2>
              <p>เวลาอ้างอิง Asia/Bangkok · ช่วงเวลาเป็นแบบ [start, end)</p>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={busy !== null}
              onClick={() => {
                setBusy("refresh");
                setError(null);
                void loadPeriods()
                  .catch((caught) => setError(normalizeError(caught)))
                  .finally(() => setBusy(null));
              }}
            >
              {busy === "refresh" ? "กำลังโหลด…" : "รีเฟรช"}
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ช่วงเวลา</th>
                  <th>โหมด</th>
                  <th>สถานะ</th>
                  <th>Version</th>
                  <th>คำสั่ง</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => (
                  <tr key={period.id}>
                    <td>
                      <strong>{formatBangkok(period.effectiveStart)}</strong>
                      <span className="range-end">ถึง {formatBangkok(period.effectiveEnd)}</span>
                    </td>
                    <td>{period.mode === "AUTOMATIC_WEEKLY" ? "Automatic weekly" : "Custom"}</td>
                    <td>
                      <span className={`state state-${period.state.toLowerCase()}`}>
                        {period.state}
                      </span>
                    </td>
                    <td>v{period.version}</td>
                    <td>
                      {period.allowedActions.includes("cancel") ? (
                        <button
                          type="button"
                          className="secondary-button compact-button"
                          disabled={busy !== null}
                          onClick={() => {
                            setCancellationPeriodId(period.id);
                            setCancellationReason(period.cancellationReason ?? "");
                            setCancellationCode("");
                            setError(null);
                          }}
                        >
                          {cancelActionLabel(period)}
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {cancellationPeriodId ? (
            <CancellationPanel
              period={periods.find((period) => period.id === cancellationPeriodId) ?? null}
              reason={cancellationReason}
              code={cancellationCode}
              busy={busy}
              onReasonChange={setCancellationReason}
              onCodeChange={setCancellationCode}
              onDismiss={() => {
                setCancellationPeriodId(null);
                setCancellationReason("");
                setCancellationCode("");
              }}
              onConfirm={(period) => void cancelPeriod(period)}
            />
          ) : null}
        </section>

        <section className="approval-section" aria-labelledby="approval-title">
          <div className="section-heading">
            <div>
              <h2 id="approval-title">คำขอรออนุมัติ</h2>
              <p>ตรวจสอบช่วงเวลา เหตุผล ผู้ร้องขอ และ version ปัจจุบันก่อนยืนยันด้วย MFA</p>
            </div>
          </div>
          <div className="approval-list">
            {periods.filter((period) => period.state === "PENDING_APPROVAL").length === 0 ? (
              <p className="approval-empty">ไม่มี Custom Accounting Period ที่รออนุมัติ</p>
            ) : (
              periods
                .filter((period) => period.state === "PENDING_APPROVAL")
                .map((period) => {
                  const canApprove = period.allowedActions.includes("approve");
                  const selected = approvalPeriodId === period.id;
                  return (
                    <article className="approval-item" key={period.id}>
                      <div className="approval-summary">
                        <div>
                          <span className="state state-pending_approval">PENDING_APPROVAL</span>
                          <h3>
                            {formatBangkok(period.effectiveStart)} → {formatBangkok(period.effectiveEnd)}
                          </h3>
                        </div>
                        <span className="version">Version {period.version}</span>
                      </div>
                      <dl className="approval-evidence">
                        <div>
                          <dt>เหตุผล</dt>
                          <dd>{period.reason}</dd>
                        </div>
                        <div>
                          <dt>Requester</dt>
                          <dd>{period.createdByAdminId ? shortId(period.createdByAdminId) : "ไม่ระบุ"}</dd>
                        </div>
                      </dl>
                      {canApprove ? (
                        selected ? (
                          <div className="approval-confirm">
                            <label>
                              <span>รหัส MFA 6 หลัก</span>
                              <input
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                pattern="[0-9]{6}"
                                maxLength={6}
                                value={approvalCode}
                                onChange={(event) =>
                                  setApprovalCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                                }
                                disabled={busy !== null}
                              />
                            </label>
                            <div className="approval-actions">
                              <button
                                type="button"
                                className="secondary-button"
                                disabled={busy !== null}
                                onClick={() => {
                                  setApprovalPeriodId(null);
                                  setApprovalCode("");
                                }}
                              >
                                ยกเลิก
                              </button>
                              <button
                                type="button"
                                className="primary-button"
                                disabled={busy !== null || approvalCode.length !== 6}
                                onClick={() => void approvePending(period)}
                              >
                                {busy === "approve" ? "กำลังอนุมัติ…" : "ยืนยันและอนุมัติ"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="primary-button approval-button"
                            disabled={busy !== null}
                            onClick={() => {
                              setApprovalPeriodId(period.id);
                              setApprovalCode("");
                            }}
                          >
                            ตรวจสอบและอนุมัติ
                          </button>
                        )
                      ) : (
                        <p className="permission-note">
                          บัญชีนี้ไม่มีสิทธิ์อนุมัติคำขอนี้ หรือเป็น ADMIN ผู้ร้องขอเอง
                        </p>
                      )}
                    </article>
                  );
                })
            )}
          </div>
        </section>

        <section className="custom-section" aria-labelledby="custom-title">
          <div className="section-heading">
            <div>
              <h2 id="custom-title">สร้าง Custom Accounting Period</h2>
              <p>สร้างเป็น DRAFT ก่อน ระบบยังไม่เปลี่ยน effective coverage จนกว่าจะผ่านขั้นอนุมัติภายหลัง</p>
            </div>
          </div>

          <div className="custom-grid">
            <form className="period-form" onSubmit={createCustom}>
              <label>
                <span>เริ่มวันที่</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  required
                  disabled={!canCreate || draft !== null || busy !== null}
                />
              </label>
              <label>
                <span>สิ้นสุดวันที่</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  required
                  disabled={!canCreate || draft !== null || busy !== null}
                />
              </label>
              <label className="reason-field">
                <span>เหตุผล</span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  rows={4}
                  disabled={!canCreate || draft !== null || busy !== null}
                  placeholder="ระบุเหตุผลสำหรับการกำหนดช่วง Custom"
                />
              </label>

              {!canCreate ? (
                <p className="permission-note">บัญชีนี้เป็นแบบ read-only สำหรับ Accounting Period</p>
              ) : null}

              {draft ? (
                <button type="button" className="secondary-button" onClick={beginAnotherDraft}>
                  สร้างคำขอใหม่
                </button>
              ) : (
                <button
                  type="submit"
                  className="primary-button"
                  disabled={!canCreate || busy !== null}
                >
                  {busy === "create" ? "กำลังสร้าง…" : "สร้าง DRAFT และดูตัวอย่าง"}
                </button>
              )}
            </form>

            <div className="preview-panel" aria-live="polite">
              {draft ? (
                <Preview command={draft} busy={busy} onSubmit={() => void submitDraft()} />
              ) : (
                <div className="preview-empty">
                  <h3>Replacement preview</h3>
                  <p>
                    เมื่อสร้าง DRAFT แล้ว ระบบจะคืนช่วง Automatic ที่ได้รับผลกระทบและช่วงคงเหลือจาก
                    server เพื่อให้ตรวจสอบก่อนส่งอนุมัติ
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
    </AdminShell>
  );
}

function Preview({
  command,
  busy,
  onSubmit,
}: {
  command: AccountingPeriodCommand;
  busy: BusyAction;
  onSubmit: () => void;
}) {
  const { period, replacementPreview } = command;
  return (
    <div className="preview-content">
      <div className="preview-header">
        <div>
          <span className={`state state-${period.state.toLowerCase()}`}>{period.state}</span>
          <h3>{formatBangkok(period.effectiveStart)} → {formatBangkok(period.effectiveEnd)}</h3>
        </div>
        <span className="version">Version {period.version}</span>
      </div>
      <dl className="normalized-boundaries">
        <div>
          <dt>Normalized start</dt>
          <dd>{period.effectiveStart}</dd>
        </div>
        <div>
          <dt>Normalized end</dt>
          <dd>{period.effectiveEnd}</dd>
        </div>
      </dl>

      <div className="preview-group">
        <h4>ช่วง Automatic ที่ได้รับผลกระทบ</h4>
        {replacementPreview.affectedAutomaticPeriods.length === 0 ? (
          <p className="muted">ไม่มีช่วง Automatic ที่ต้องแทนที่</p>
        ) : (
          <ul>
            {replacementPreview.affectedAutomaticPeriods.map((item, index) => (
              <li key={`${item.effectiveStart}-${index}`}>
                <span>{formatBangkok(item.effectiveStart)} → {formatBangkok(item.effectiveEnd)}</span>
                <small>{item.id ? `Period ${shortId(item.id)}` : "ยังไม่ได้ generate ในฐานข้อมูล"}</small>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="preview-group">
        <h4>ช่วงคงเหลือ</h4>
        {replacementPreview.residualFragments.length === 0 ? (
          <p className="muted">ไม่ต้องสร้าง residual fragment</p>
        ) : (
          <ul>
            {replacementPreview.residualFragments.map((item, index) => (
              <li key={`${item.effectiveStart}-${index}`}>
                <span>{formatBangkok(item.effectiveStart)} → {formatBangkok(item.effectiveEnd)}</span>
                <small>DERIVED_FRAGMENT</small>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="reason-summary">
        <span>เหตุผล</span>
        <strong>{period.reason}</strong>
      </div>

      {period.allowedActions.includes("submit") ? (
        <button type="button" className="primary-button" disabled={busy !== null} onClick={onSubmit}>
          {busy === "submit" ? "กำลังส่ง…" : "ส่งเพื่ออนุมัติ"}
        </button>
      ) : (
        <p className="submitted-note">
          {period.state === "PENDING_APPROVAL"
            ? "ส่งคำขอเข้าสู่ PENDING_APPROVAL แล้ว"
            : "ไม่มีคำสั่งที่อนุญาตในสถานะนี้"}
        </p>
      )}
    </div>
  );
}

function CancellationPanel({
  period,
  reason,
  code,
  busy,
  onReasonChange,
  onCodeChange,
  onDismiss,
  onConfirm,
}: {
  period: AccountingPeriod | null;
  reason: string;
  code: string;
  busy: BusyAction;
  onReasonChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onDismiss: () => void;
  onConfirm: (period: AccountingPeriod) => void;
}) {
  if (!period) return null;
  const cancellationUi = accountingPeriodCancellationUi(period);
  if (!cancellationUi) return null;
  const { governed, approvingCancellation } = cancellationUi;
  return (
    <div className="cancellation-panel" aria-live="polite">
      <div className="approval-summary">
        <div>
          <span className={`state state-${period.state.toLowerCase()}`}>{period.state}</span>
          <h3>{cancellationUi.actionLabel}</h3>
          <p>
            {formatBangkok(period.effectiveStart)} → {formatBangkok(period.effectiveEnd)} · Version {period.version}
          </p>
        </div>
      </div>
      <label>
        <span>เหตุผล</span>
        <textarea
          rows={3}
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          disabled={busy !== null || cancellationUi.reasonReadOnly}
          placeholder="ระบุเหตุผลที่ต้องยกเลิกหรือถอนคำขอ"
        />
      </label>
      {governed ? (
        <>
          <p className="permission-note">
            {cancellationUi.permissionNote}
          </p>
          {cancellationUi.requiresMfa ? (
            <label>
              <span>รหัส MFA 6 หลัก</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
                disabled={busy !== null}
              />
            </label>
          ) : null}
        </>
      ) : null}
      <div className="approval-actions">
        <button type="button" className="secondary-button" disabled={busy !== null} onClick={onDismiss}>
          กลับ
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={
            busy !== null ||
            reason.trim().length === 0 ||
            (cancellationUi.requiresMfa && code.length !== 6)
          }
          onClick={() => onConfirm(period)}
        >
          {busy === "cancel" ? "กำลังดำเนินการ…" : cancellationUi.actionLabel}
        </button>
      </div>
    </div>
  );
}

function cancelActionLabel(period: AccountingPeriod): string {
  return accountingPeriodCancellationUi(period)?.actionLabel ?? "—";
}

function formatBangkok(value: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function shortId(value: string): string {
  return `${value.slice(0, 8)}…`;
}

function headersObject(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function idempotencyKey(
  keys: Map<string, string>,
  operation: string,
  payload: object,
): string {
  const fingerprint = `${operation}:${JSON.stringify(payload)}`;
  const existing = keys.get(fingerprint);
  if (existing) return existing;
  const key = crypto.randomUUID();
  keys.set(fingerprint, key);
  return key;
}

async function readApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as Partial<ApiError>;
    if (body.code && body.message && body.correlationId) {
      return {
        code: body.code,
        message: body.message,
        details: body.details ?? {},
        correlationId: body.correlationId,
      };
    }
  } catch {
    // Fall through to a transport-level error shape.
  }
  return {
    code: `HTTP_${response.status}`,
    message: response.statusText || "Admin API request failed",
    details: {},
    correlationId: response.headers.get("x-correlation-id") ?? "unavailable",
  };
}

function normalizeError(error: unknown): ApiError {
  if (isApiError(error)) return error;
  return {
    code: "ADMIN_UI_REQUEST_FAILED",
    message: error instanceof Error ? error.message : "Admin API request failed",
    details: {},
    correlationId: "unavailable",
  };
}

function isApiError(value: unknown): value is ApiError {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ApiError>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.correlationId === "string"
  );
}
