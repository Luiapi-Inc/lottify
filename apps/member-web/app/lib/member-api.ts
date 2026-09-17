import type { components } from "@lottify/contracts";

type Schema<Name extends keyof components["schemas"]> = components["schemas"][Name];

export type MemberAuthPurpose = "REGISTER" | "PASSWORD_ENROLL";
export type OtpRequestResponse = Schema<"OtpRequestResponse">;
export type MemberSessionResponse = Schema<"MemberSessionResponse">;
export type PasswordEnrollResponse = Schema<"PasswordEnrollResponse">;
export type MemberLoginResponse = Schema<"MemberLoginResponse">;
export type PasswordResetResponse = Schema<"PasswordResetResponse">;
export type RecoveryOtpRequestResponse = Schema<"RecoveryOtpRequestResponse">;
export type MemberRefreshResponse = Schema<"MemberRefreshResponse">;
export type RequiredTerms = Schema<"RequiredTermsBody">;
export type MemberTermsResponse = Schema<"MemberTermsBody">;
export type AcceptTermsResponse = Schema<"AcceptTermsBody">;
export type MemberProfileResponse = Schema<"MemberProfileBody">;
export type MemberProfilePatch = Schema<"UpdateMemberProfileBody">;
export type CapabilityReadiness = Schema<"CapabilityReadinessBody">;
export type ReadinessCapability = CapabilityReadiness["capability"];
export type EligibilityOutcome = CapabilityReadiness["outcome"];
export type KycReadinessStatus = Schema<"KycReadinessBody">["status"];
export type MemberReadinessResponse = Schema<"MemberReadinessBody">;

export type DepositMethodSummary = Schema<"DepositMethodSummaryBody">;
export type DepositMethodDescription = Schema<"DepositMethodDescriptionBody">;
export type DepositInitiateRequest = Schema<"DepositInitiateBody">;
export type Deposit = Schema<"DepositBody">;
export type WithdrawalCreateRequest = Schema<"CreateWithdrawalBody">;
export type WithdrawalPreflight = Schema<"WithdrawalPreflightBody">;
export type Withdrawal = Schema<"WithdrawalBody">;
export type WithdrawalList = Schema<"WithdrawalListBody">;
export type PayoutDestination = Schema<"PayoutDestinationBody">;
export type PayoutDestinationList = Schema<"PayoutDestinationListBody">;

export class MemberApiFailure extends Error {
  constructor(
    public code: string,
    message: string,
    public correlationId?: string,
    public status?: number,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

class MemberApiClient {
  private accessToken: string | null = null;
  private refreshing: Promise<string> | null = null;

  acceptSession(accessToken: string): void {
    this.accessToken = accessToken;
  }

  clearSession(): void {
    this.accessToken = null;
  }

  requestOtp(purpose: MemberAuthPurpose, phone: string): Promise<OtpRequestResponse> {
    return this.publicRequest<OtpRequestResponse>("auth/otp/request", {
      purpose,
      phone: normalizePhone(phone),
    });
  }

  async verifyOtp(
    purpose: MemberAuthPurpose,
    phone: string,
    code: string,
    password: string,
  ): Promise<MemberSessionResponse | PasswordEnrollResponse> {
    const result = await this.publicRequest<MemberSessionResponse | PasswordEnrollResponse>("auth/otp/verify", {
      purpose,
      phone: normalizePhone(phone),
      deviceName: "Lottify Member Web",
      code,
      password,
    });
    // Only REGISTER issues a session; PASSWORD_ENROLL returns a credential
    // result with no access token and the Member must log in afterwards.
    if (result.purpose === "REGISTER") this.acceptSession(result.accessToken);
    return result;
  }

  login(phone: string, password: string): Promise<MemberLoginResponse> {
    return this.publicRequest<MemberLoginResponse>("auth/login", {
      phone: normalizePhone(phone),
      password,
      deviceName: "Lottify Member Web",
    }).then((session) => {
      this.acceptSession(session.accessToken);
      return session;
    });
  }

  requestRecoveryOtp(phone: string): Promise<RecoveryOtpRequestResponse> {
    return this.publicRequest<RecoveryOtpRequestResponse>("auth/recovery/otp/request", {
      phone: normalizePhone(phone),
    });
  }

  resetPassword(phone: string, code: string, password: string): Promise<PasswordResetResponse> {
    return this.publicRequest<PasswordResetResponse>("auth/password/reset", {
      phone: normalizePhone(phone),
      code,
      password,
    });
  }

  getTerms(): Promise<MemberTermsResponse> {
    return this.request<MemberTermsResponse>("terms");
  }

  acceptTerms(documentId: string): Promise<AcceptTermsResponse> {
    return this.request<AcceptTermsResponse>("terms/accept", {
      method: "POST",
      body: { documentId },
      idempotencyKey: createIdempotencyKey(),
    });
  }

  getProfile(): Promise<MemberProfileResponse> {
    return this.request<MemberProfileResponse>("profile");
  }

  updateProfile(patch: MemberProfilePatch): Promise<MemberProfileResponse> {
    return this.request<MemberProfileResponse>("profile", {
      method: "PATCH",
      body: patch,
    });
  }

  getReadiness(): Promise<MemberReadinessResponse> {
    return this.request<MemberReadinessResponse>("readiness");
  }

  listDepositMethods(): Promise<DepositMethodSummary[]> {
    return this.request<DepositMethodSummary[]>("deposits/methods");
  }

  describeDepositMethod(code: string): Promise<DepositMethodDescription> {
    return this.request<DepositMethodDescription>(`deposits/methods/${encodeURIComponent(code)}`);
  }

  createDeposit(body: DepositInitiateRequest, idempotencyKey: string): Promise<Deposit> {
    return this.request<Deposit>("deposits", {
      method: "POST",
      body,
      idempotencyKey,
    });
  }

  getDeposit(id: string): Promise<Deposit> {
    return this.request<Deposit>(`deposits/${encodeURIComponent(id)}`);
  }

  listPayoutDestinations(): Promise<PayoutDestinationList> {
    return this.request<PayoutDestinationList>("payout-destinations");
  }

  preflightWithdrawal(body: WithdrawalCreateRequest): Promise<WithdrawalPreflight> {
    return this.request<WithdrawalPreflight>("withdrawals/preflight", {
      method: "POST",
      body,
    });
  }

  listWithdrawals(cursor?: string, limit?: number): Promise<WithdrawalList> {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (limit !== undefined) params.set("limit", String(limit));
    const query = params.toString();
    return this.request<WithdrawalList>(`withdrawals${query ? `?${query}` : ""}`);
  }

  createWithdrawal(body: WithdrawalCreateRequest, idempotencyKey: string): Promise<Withdrawal> {
    return this.request<Withdrawal>("withdrawals", {
      method: "POST",
      body,
      idempotencyKey,
    });
  }

  getWithdrawal(id: string): Promise<Withdrawal> {
    return this.request<Withdrawal>(`withdrawals/${encodeURIComponent(id)}`);
  }

  cancelWithdrawal(id: string, idempotencyKey: string): Promise<Withdrawal> {
    return this.request<Withdrawal>(`withdrawals/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      idempotencyKey,
    });
  }

  private async publicRequest<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`/api/v1/member/${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "include",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return this.read<T>(response);
  }

  private refresh(): Promise<string> {
    if (!this.refreshing) {
      this.refreshing = this.publicRequest<MemberRefreshResponse>("auth/refresh", {})
        .then(({ accessToken }) => {
          this.accessToken = accessToken;
          return accessToken;
        })
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }

  private async request<T>(
    path: string,
    options: {
      method?: "GET" | "POST" | "PATCH";
      body?: unknown;
      idempotencyKey?: string;
    } = {},
  ): Promise<T> {
    const method = options.method ?? (options.body === undefined ? "GET" : "POST");
    const send = (token: string) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
      return fetch(`/api/v1/member/${path}`, {
        method,
        credentials: "include",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    };

    let response = await send(this.accessToken ?? (await this.refresh()));
    if (response.status === 401) {
      this.accessToken = null;
      response = await send(await this.refresh());
    }
    return this.read<T>(response);
  }

  private async read<T>(response: Response): Promise<T> {
    const body = await response.json().catch(() => ({})) as {
      code?: unknown;
      message?: unknown;
      correlationId?: unknown;
      details?: unknown;
    };
    if (!response.ok) {
      const code = typeof body.code === "string"
        ? body.code
        : response.status === 401
          ? "SESSION_REQUIRED"
          : `HTTP_${response.status}`;
      const message = typeof body.message === "string"
        ? body.message
        : "ไม่สามารถดำเนินการได้ กรุณาลองอีกครั้ง";
      throw new MemberApiFailure(
        code,
        message,
        typeof body.correlationId === "string" ? body.correlationId : undefined,
        response.status,
        typeof body.details === "object" && body.details !== null
          ? (body.details as Record<string, unknown>)
          : undefined,
      );
    }
    return body as T;
  }
}

/** Normalize a Member phone entered in a local Thai format (08X-XXX-XXXX,
 *  08XXXXXXXX, 66XXXXXXXXX) to its wire form by removing separators. The API
 *  owns any remaining format conversion; this layer only strips the display
 *  characters the user may type. Single normalization point per the operator
 *  decision 2026-09-17 — pages never normalize independently. */
export function normalizePhone(phone: string): string {
  return phone.replace(/[\s-]/g, "");
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `member-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const memberApi = new MemberApiClient();
