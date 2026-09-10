import type { MemberAuthPurpose } from "./member-api";

const AUTH_FLOW_KEY = "lottify-member-auth-flow";

export interface PendingAuthFlow {
  purpose: MemberAuthPurpose;
  phone: string;
  ref?: string;
  deliveredTo: string;
  retryAfterSeconds: number | null;
}

export function saveAuthFlow(flow: PendingAuthFlow): void {
  window.sessionStorage.setItem(AUTH_FLOW_KEY, JSON.stringify(flow));
}

export function readAuthFlow(): PendingAuthFlow | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(AUTH_FLOW_KEY) ?? "null") as Partial<PendingAuthFlow> | null;
    if (!value || (value.purpose !== "LOGIN" && value.purpose !== "REGISTER")) return null;
    if (typeof value.phone !== "string" || typeof value.deliveredTo !== "string") return null;
    return {
      purpose: value.purpose,
      phone: value.phone,
      deliveredTo: value.deliveredTo,
      retryAfterSeconds: typeof value.retryAfterSeconds === "number" ? value.retryAfterSeconds : null,
      ref: typeof value.ref === "string" ? value.ref : undefined,
    };
  } catch {
    return null;
  }
}

export function clearAuthFlow(): void {
  window.sessionStorage.removeItem(AUTH_FLOW_KEY);
}
