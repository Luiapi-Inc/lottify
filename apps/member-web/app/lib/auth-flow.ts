import type { MemberAuthPurpose } from "./member-api";

const AUTH_FLOW_KEY = "lottify-member-auth-flow";

export type AuthFlowPurpose = MemberAuthPurpose | "RECOVERY";

export interface PendingAuthFlow {
  purpose: AuthFlowPurpose;
  phone: string;
  deliveredTo: string;
  retryAfterSeconds: number | null;
  /** Password set on the registration page and carried into the REGISTER OTP
   *  verify step. Only populated for the REGISTER flow; PASSWORD_ENROLL and
   *  RECOVERY collect a fresh password on the verify page. */
  password?: string;
}

const FLOW_PURPOSES: readonly AuthFlowPurpose[] = ["REGISTER", "PASSWORD_ENROLL", "RECOVERY"];

export function saveAuthFlow(flow: PendingAuthFlow): void {
  window.sessionStorage.setItem(AUTH_FLOW_KEY, JSON.stringify(flow));
}

export function readAuthFlow(): PendingAuthFlow | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(AUTH_FLOW_KEY) ?? "null") as Partial<PendingAuthFlow> | null;
    if (!value || typeof value.purpose !== "string" || !FLOW_PURPOSES.includes(value.purpose as AuthFlowPurpose)) return null;
    if (typeof value.phone !== "string" || typeof value.deliveredTo !== "string") return null;
    return {
      purpose: value.purpose as AuthFlowPurpose,
      phone: value.phone,
      deliveredTo: value.deliveredTo,
      retryAfterSeconds: typeof value.retryAfterSeconds === "number" ? value.retryAfterSeconds : null,
      password: typeof value.password === "string" ? value.password : undefined,
    };
  } catch {
    return null;
  }
}

export function clearAuthFlow(): void {
  window.sessionStorage.removeItem(AUTH_FLOW_KEY);
}
