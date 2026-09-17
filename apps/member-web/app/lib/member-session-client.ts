"use client";

import { useEffect, useState } from "react";
import { MemberApiFailure, memberApi, type MemberSessionIdentity } from "./member-api";

export type MemberSessionState =
  | { status: "loading" }
  | { status: "authenticated"; session: MemberSessionIdentity }
  | { status: "signed-out" }
  | { status: "unavailable"; message: string };

/**
 * Resolve the server-authoritative Member session for a client component.
 *
 * `memberApi.getSession()` refreshes from the session cookie when the
 * in-memory access token is gone, so this hook answers "is this browser still
 * signed in?" after a navigation, not just "did this tab log in once".
 * Components must render an honest signed-out state for `signed-out` — never
 * placeholder member data.
 */
export function useMemberSession(): MemberSessionState {
  const [state, setState] = useState<MemberSessionState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    memberApi
      .getSession()
      .then((session) => {
        if (active) setState({ status: "authenticated", session });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof MemberApiFailure && (error.status === 401 || error.code === "SESSION_REQUIRED")) {
          setState({ status: "signed-out" });
          return;
        }
        setState({
          status: "unavailable",
          message: error instanceof Error ? error.message : "ไม่สามารถตรวจสอบเซสชันได้",
        });
      });
    return () => {
      active = false;
    };
  }, []);

  return state;
}

/** Display helper: group a local-format Member phone for readability without
 *  inventing digits. Anything unexpected is shown verbatim. */
export function formatMemberPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

/** Display helper: Member account status as shown to the Member. */
export function describeMemberStatus(status: string): { label: string; tone: "success" | "warning" } {
  return status === "ACTIVE"
    ? { label: "ใช้งานได้", tone: "success" }
    : { label: "ถูกระงับการใช้งาน", tone: "warning" };
}
