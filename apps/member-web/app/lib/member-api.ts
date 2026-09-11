import type { components } from "@lottify/contracts";

type Schema<Name extends keyof components["schemas"]> = components["schemas"][Name];

export type MemberAuthPurpose = "LOGIN" | "REGISTER";
export type OtpRequestResponse = Schema<"OtpRequestResponse">;
export type MemberSessionResponse = Schema<"MemberSessionResponse">;
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

export type WalletBalance = Schema<"WalletBalanceBody">;
export type BetOrderList = Schema<"BetOrderListBody">;
export type PromotionDiscovery = Schema<"PromotionDiscoveryBody">;
export type MemberProductPage = Schema<"MemberProductPageBody">;
export type MemberDrawPage = Schema<"MemberDrawPageBody">;
export type MemberDraw = Schema<"MemberDrawDetailBody">;
export type BettingQuote = Schema<"BettingQuoteBody">;
export type BetOrder = Schema<"BetOrderBody">;
export type BetReceipt = Schema<"BetReceiptBody">;

export interface CreateQuoteLineInput {
  betTypeCode: string;
  canonicalNumber: string;
  stakeMinor: string;
}

export interface CreateQuoteInput {
  currency: "THB";
  lines: CreateQuoteLineInput[];
}

export class MemberApiFailure extends Error {
  constructor(
    public code: string,
    message: string,
    public correlationId?: string,
    public status?: number,
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

  getWallet(): Promise<WalletBalance> {
    return this.request<WalletBalance>("wallet");
  }

  getOrders(limit = 3): Promise<BetOrderList> {
    return this.request<BetOrderList>(`orders?limit=${limit}`);
  }

  getPromotions(): Promise<PromotionDiscovery> {
    return this.request<PromotionDiscovery>("promotions");
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

  listProducts(limit = 100): Promise<MemberProductPage> {
    return this.request<MemberProductPage>(`products?limit=${limit}`);
  }

  listProductDraws(productId: string, state = "OPEN", limit = 100): Promise<MemberDrawPage> {
    const params = new URLSearchParams({ state, limit: String(limit) });
    return this.request<MemberDrawPage>(
      `products/${encodeURIComponent(productId)}/draws?${params.toString()}`,
    );
  }

  getDraw(drawId: string): Promise<MemberDraw> {
    return this.request<MemberDraw>(`draws/${encodeURIComponent(drawId)}`);
  }

  createQuote(drawId: string, body: CreateQuoteInput, idempotencyKey: string): Promise<BettingQuote> {
    return this.request<BettingQuote>(`draws/${encodeURIComponent(drawId)}/quotes`, {
      method: "POST",
      body,
      idempotencyKey,
    });
  }

  getQuote(quoteId: string): Promise<BettingQuote> {
    return this.request<BettingQuote>(`quotes/${encodeURIComponent(quoteId)}`);
  }

  createOrder(quoteId: string, idempotencyKey: string): Promise<BetOrder> {
    return this.request<BetOrder>(`quotes/${encodeURIComponent(quoteId)}/orders`, {
      method: "POST",
      idempotencyKey,
    });
  }

  getOrder(orderId: string): Promise<BetOrder> {
    return this.request<BetOrder>(`orders/${encodeURIComponent(orderId)}`);
  }

  confirmOrder(orderId: string, version: number, idempotencyKey: string): Promise<BetOrder> {
    return this.request<BetOrder>(`orders/${encodeURIComponent(orderId)}/confirm`, {
      method: "POST",
      body: { version },
      idempotencyKey,
    });
  }

  cancelOrder(orderId: string, version: number, idempotencyKey: string): Promise<BetOrder> {
    return this.request<BetOrder>(`orders/${encodeURIComponent(orderId)}/cancel`, {
      method: "POST",
      body: { version },
      idempotencyKey,
    });
  }

  getReceipt(orderId: string): Promise<BetReceipt> {
    return this.request<BetReceipt>(`orders/${encodeURIComponent(orderId)}/receipt`);
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
      );
    }
    return body as T;
  }
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `member-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const memberApi = new MemberApiClient();
