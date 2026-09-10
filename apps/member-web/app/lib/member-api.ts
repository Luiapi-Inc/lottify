import type { components } from "@lottify/contracts";

type Schema<Name extends keyof components["schemas"]> = components["schemas"][Name];

export type MemberAuthPurpose = "LOGIN" | "REGISTER";

export interface OtpRequestResponse {
  purpose: MemberAuthPurpose;
  deliveredTo: string;
  retryAfterSeconds: number | null;
}

export interface MemberSessionResponse {
  accessToken: string;
  memberId: string;
  accountCreated: boolean;
  deviceId: string | null;
}

export interface RequiredTerms {
  documentId: string;
  code: string;
  version: number;
  title: string;
  body: string;
  contentDigest: string;
  policyVersion: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  accepted: boolean;
  acceptedAt: string | null;
  acceptanceId: string | null;
}

export interface MemberTermsResponse {
  memberId: string;
  asOf: string;
  required: RequiredTerms[];
  acceptances: Array<{
    id: string;
    memberId: string;
    documentId: string;
    documentCode: string;
    documentVersion: number;
    contentDigest: string;
    source: string;
    acceptedAt: string;
  }>;
  satisfied: boolean;
}

export interface MemberProfileResponse {
  memberId: string;
  phone: string;
  fullName: string | null;
  dateOfBirth: string | null;
  province: string | null;
  profileUpdatedAt: string | null;
  mandatoryFields: string[];
  missingMandatoryFields: string[];
  profileComplete: boolean;
}

export interface MemberProfilePatch {
  fullName?: string | null;
  dateOfBirth?: string | null;
  province?: string | null;
}

export type ReadinessCapability = "BET" | "WITHDRAWAL" | "DEPOSIT" | "PROMOTION";
export type EligibilityOutcome =
  | "ALLOW"
  | "DENY"
  | "REVIEW_REQUIRED"
  | "CHALLENGE/REAUTH_REQUIRED";
export type KycReadinessStatus =
  | "VERIFIED"
  | "REJECTED"
  | "REVIEW_REQUIRED"
  | "MORE_INFO_REQUIRED"
  | null;

export interface CapabilityReadiness {
  capability: ReadinessCapability;
  outcome: EligibilityOutcome;
  reasonCodes: string[];
  evaluatedAt: string;
  validUntil: string;
}

export interface MemberReadinessResponse {
  memberId: string;
  asOf: string;
  policyVersion: string;
  capabilities: CapabilityReadiness[];
  requirements: {
    termsSatisfied: boolean;
    profileComplete: boolean;
    missingProfileFields: Array<"fullName" | "dateOfBirth" | "province">;
    kyc: {
      required: boolean;
      status: KycReadinessStatus;
      verified: boolean;
      expired: boolean;
    };
    outstandingRequirements: string[];
  };
}

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
      phone,
    });
  }

  async verifyOtp(
    purpose: MemberAuthPurpose,
    phone: string,
    code: string,
  ): Promise<MemberSessionResponse> {
    const session = await this.publicRequest<MemberSessionResponse>("auth/otp/verify", {
      purpose,
      phone,
      deviceName: "Lottify Member Web",
      code,
    });
    this.acceptSession(session.accessToken);
    return session;
  }

  getTerms(): Promise<MemberTermsResponse> {
    return this.request<MemberTermsResponse>("terms");
  }

  acceptTerms(documentId: string): Promise<unknown> {
    return this.request("terms/accept", {
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

  createDeposit(body: DepositInitiateRequest): Promise<Deposit> {
    return this.request<Deposit>("deposits", {
      method: "POST",
      body,
      idempotencyKey: createIdempotencyKey(),
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

  createWithdrawal(body: WithdrawalCreateRequest): Promise<Withdrawal> {
    return this.request<Withdrawal>("withdrawals", {
      method: "POST",
      body,
      idempotencyKey: createIdempotencyKey(),
    });
  }

  getWithdrawal(id: string): Promise<Withdrawal> {
    return this.request<Withdrawal>(`withdrawals/${encodeURIComponent(id)}`);
  }

  cancelWithdrawal(id: string): Promise<Withdrawal> {
    return this.request<Withdrawal>(`withdrawals/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      idempotencyKey: createIdempotencyKey(),
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
      this.refreshing = this.publicRequest<{ accessToken: string }>("auth/refresh", {})
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
      );
    }
    return body as T;
  }
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `member-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const memberApi = new MemberApiClient();
