"use client";

import type { components } from "@lottify/contracts";

type Schema<Name extends keyof components["schemas"]> = components["schemas"][Name];

export type MemberAuthPurpose = "REGISTER" | "PASSWORD_ENROLL";
export type OtpRequestResponse = Schema<"OtpRequestResponse">;
export type MemberSessionResponse = Schema<"MemberSessionResponse">;
export type PasswordEnrollResponse = Schema<"PasswordEnrollResponse">;
export type MemberLoginResponse = Schema<"MemberLoginResponse">;
export type PasswordResetResponse = Schema<"PasswordResetResponse">;
export type RecoveryOtpRequestResponse = Schema<"RecoveryOtpRequestResponse">;
export type RecoveryOtpVerificationResponse = Schema<"RecoveryOtpVerificationResponse">;
export type MemberRefreshResponse = Schema<"MemberRefreshResponse">;
export type MemberSessionIdentity = Schema<"MemberMeResponse">;
export type MemberRevokedResponse = Schema<"MemberRevokedResponse">;

export type MemberProductPage = Schema<"MemberProductPageBody">;
export type MemberProduct = Schema<"MemberProductDetailBody">;
export type MemberBetTypePage = Schema<"MemberBetTypePageBody">;
export type MemberBetType = Schema<"MemberBetTypeDetailBody">;
export type MemberDrawPage = Schema<"MemberDrawPageBody">;
export type MemberDraw = Schema<"MemberDrawDetailBody">;
export type MemberDrawEligibility = Schema<"MemberDrawEligibilityBody">;
export type QuoteCreateLine = Schema<"QuoteCreateBody">;
export type BettingQuote = Schema<"BettingQuoteBody">;
export type BetOrder = Schema<"BetOrderBody">;
export type BetOrderList = Schema<"BetOrderListBody">;
export type BetOrderCommand = Schema<"BetOrderCommandBody">;
export type BetReceipt = Schema<"BetReceiptBody">;
export type MemberSettlementOutcome = Schema<"MemberSettlementOutcomeBody">;

export type MemberSessionView = Schema<"MemberSessionViewBody">;
export type MemberDeviceView = Schema<"MemberDeviceViewBody">;
export type WalletBalance = Schema<"WalletBalanceBody">;
export type WalletTransactionPage = Schema<"WalletTransactionPageBody">;

export type DepositMethodSummary = Schema<"DepositMethodSummaryBody">;
export type DepositMethodDescription = Schema<"DepositMethodDescriptionBody">;
export type DepositInitiateRequest = Schema<"DepositInitiateBody">;
export type Deposit = Schema<"DepositBody">;
export type WithdrawalCreateRequest = Schema<"CreateWithdrawalBody">;
export type WithdrawalPreflight = Schema<"WithdrawalPreflightBody">;
export type Withdrawal = Schema<"WithdrawalBody">;
export type WithdrawalList = Schema<"WithdrawalListBody">;
export type AddPayoutDestinationRequest = Schema<"AddPayoutDestinationBody">;
export type PayoutDestination = Schema<"PayoutDestinationBody">;
export type PayoutDestinationList = Schema<"PayoutDestinationListBody">;

export type PromotionDiscovery = Schema<"PromotionDiscoveryBody">;
export type PromotionEntitlementPage = Schema<"PromotionEntitlementPageBody">;
export type PromotionEntitlement = Schema<"PromotionEntitlementBody">;
export type ClaimPromotionRequest = Schema<"ClaimPromotionBody">;
export type NotificationPreferences = Schema<"NotificationPreferencesBody">;
export type UpdateNotificationPreferences = Schema<"UpdateNotificationPreferencesBody">;

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

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
};

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

  getSession(): Promise<MemberSessionIdentity> {
    return this.request<MemberSessionIdentity>("auth/me");
  }

  logout(): Promise<MemberRevokedResponse> {
    return this.publicRequest<MemberRevokedResponse>("auth/logout", { method: "POST" })
      .finally(() => this.clearSession());
  }

  revokeAll(): Promise<MemberRevokedResponse> {
    return this.request<MemberRevokedResponse>("auth/revoke-all", { method: "POST" })
      .finally(() => this.clearSession());
  }

  requestOtp(purpose: MemberAuthPurpose, phone: string): Promise<OtpRequestResponse> {
    return this.publicRequest<OtpRequestResponse>("auth/otp/request", {
      method: "POST",
      body: { purpose, phone: normalizePhone(phone) },
    });
  }

  async verifyOtp(
    purpose: MemberAuthPurpose,
    phone: string,
    code: string,
    password: string,
  ): Promise<MemberSessionResponse | PasswordEnrollResponse> {
    const result = await this.publicRequest<MemberSessionResponse | PasswordEnrollResponse>("auth/otp/verify", {
      method: "POST",
      body: {
        purpose,
        phone: normalizePhone(phone),
        deviceName: "Lottify Member Web",
        code,
        password,
      },
    });
    if (result.purpose === "REGISTER") this.acceptSession(result.accessToken);
    return result;
  }

  login(phone: string, password: string): Promise<MemberLoginResponse> {
    return this.publicRequest<MemberLoginResponse>("auth/login", {
      method: "POST",
      body: {
        phone: normalizePhone(phone),
        password,
        deviceName: "Lottify Member Web",
      },
    }).then((session) => {
      this.acceptSession(session.accessToken);
      return session;
    });
  }

  requestRecoveryOtp(phone: string): Promise<RecoveryOtpRequestResponse> {
    return this.publicRequest<RecoveryOtpRequestResponse>("auth/recovery/otp/request", {
      method: "POST",
      body: { phone: normalizePhone(phone) },
    });
  }

  verifyRecoveryOtp(phone: string, code: string): Promise<RecoveryOtpVerificationResponse> {
    return this.publicRequest<RecoveryOtpVerificationResponse>("auth/recovery/otp/verify", {
      method: "POST",
      body: { phone: normalizePhone(phone), code },
    });
  }

  resetPassword(phone: string, code: string, password: string): Promise<PasswordResetResponse> {
    return this.publicRequest<PasswordResetResponse>("auth/password/reset", {
      method: "POST",
      body: { phone: normalizePhone(phone), code, password },
    });
  }

  listProducts(cursor?: string, limit?: number): Promise<MemberProductPage> {
    return this.request<MemberProductPage>(`products${queryString({ cursor, limit })}`);
  }

  getProduct(id: string): Promise<MemberProduct> {
    return this.request<MemberProduct>(`products/${encodeURIComponent(id)}`);
  }

  listBetTypes(cursor?: string, limit?: number): Promise<MemberBetTypePage> {
    return this.request<MemberBetTypePage>(`bet-types${queryString({ cursor, limit })}`);
  }

  getBetType(id: string): Promise<MemberBetType> {
    return this.request<MemberBetType>(`bet-types/${encodeURIComponent(id)}`);
  }

  listDraws(
    productId: string,
    options: { state?: MemberDraw["state"]; cursor?: string; limit?: number } = {},
  ): Promise<MemberDrawPage> {
    return this.request<MemberDrawPage>(
      `products/${encodeURIComponent(productId)}/draws${queryString(options)}`,
    );
  }

  getDraw(id: string): Promise<MemberDraw> {
    return this.request<MemberDraw>(`draws/${encodeURIComponent(id)}`);
  }

  getDrawEligibility(id: string): Promise<MemberDrawEligibility> {
    return this.request<MemberDrawEligibility>(`draws/${encodeURIComponent(id)}/eligibility`);
  }

  createQuote(drawId: string, lines: QuoteCreateLine[], idempotencyKey: string): Promise<BettingQuote> {
    return this.request<BettingQuote>(`draws/${encodeURIComponent(drawId)}/quotes`, {
      method: "POST",
      body: lines,
      idempotencyKey,
    });
  }

  getQuote(id: string): Promise<BettingQuote> {
    return this.request<BettingQuote>(`quotes/${encodeURIComponent(id)}`);
  }

  createOrder(quoteId: string, idempotencyKey: string): Promise<BetOrder> {
    return this.request<BetOrder>(`quotes/${encodeURIComponent(quoteId)}/orders`, {
      method: "POST",
      idempotencyKey,
    });
  }

  listOrders(
    options: { state?: BetOrder["state"]; cursor?: string; limit?: number } = {},
  ): Promise<BetOrderList> {
    return this.request<BetOrderList>(`orders${queryString(options)}`);
  }

  getOrder(id: string): Promise<BetOrder> {
    return this.request<BetOrder>(`orders/${encodeURIComponent(id)}`);
  }

  confirmOrder(id: string, body: BetOrderCommand, idempotencyKey: string): Promise<BetOrder> {
    return this.request<BetOrder>(`orders/${encodeURIComponent(id)}/confirm`, {
      method: "POST",
      body,
      idempotencyKey,
    });
  }

  cancelOrder(id: string, body: BetOrderCommand, idempotencyKey: string): Promise<BetOrder> {
    return this.request<BetOrder>(`orders/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body,
      idempotencyKey,
    });
  }

  getReceipt(id: string): Promise<BetReceipt> {
    return this.request<BetReceipt>(`orders/${encodeURIComponent(id)}/receipt`);
  }

  getSettlement(id: string): Promise<MemberSettlementOutcome> {
    return this.request<MemberSettlementOutcome>(`orders/${encodeURIComponent(id)}/settlement`);
  }

  listSessions(): Promise<MemberSessionView[]> {
    return this.request<MemberSessionView[]>("sessions");
  }

  revokeSession(id: string): Promise<MemberRevokedResponse> {
    return this.request<MemberRevokedResponse>(`sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  listDevices(): Promise<MemberDeviceView[]> {
    return this.request<MemberDeviceView[]>("devices");
  }

  revokeDevice(id: string): Promise<MemberRevokedResponse> {
    return this.request<MemberRevokedResponse>(`devices/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  getWallet(): Promise<WalletBalance> {
    return this.request<WalletBalance>("wallet");
  }

  listWalletTransactions(cursor?: string, limit?: number): Promise<WalletTransactionPage> {
    return this.request<WalletTransactionPage>(`wallet/transactions${queryString({ cursor, limit })}`);
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

  reconcileDeposit(id: string): Promise<Deposit> {
    return this.request<Deposit>(`deposits/${encodeURIComponent(id)}/reconcile`, {
      method: "POST",
    });
  }

  getDeposit(id: string): Promise<Deposit> {
    return this.request<Deposit>(`deposits/${encodeURIComponent(id)}`);
  }

  preflightWithdrawal(body: WithdrawalCreateRequest): Promise<WithdrawalPreflight> {
    return this.request<WithdrawalPreflight>("withdrawals/preflight", {
      method: "POST",
      body,
    });
  }

  listWithdrawals(cursor?: string, limit?: number): Promise<WithdrawalList> {
    return this.request<WithdrawalList>(`withdrawals${queryString({ cursor, limit })}`);
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

  addPayoutDestination(body: AddPayoutDestinationRequest): Promise<PayoutDestination> {
    return this.request<PayoutDestination>("payout-destinations", {
      method: "POST",
      body,
    });
  }

  listPayoutDestinations(): Promise<PayoutDestinationList> {
    return this.request<PayoutDestinationList>("payout-destinations");
  }

  getPayoutDestination(id: string): Promise<PayoutDestination> {
    return this.request<PayoutDestination>(`payout-destinations/${encodeURIComponent(id)}`);
  }

  verifyPayoutDestination(id: string): Promise<PayoutDestination> {
    return this.request<PayoutDestination>(`payout-destinations/${encodeURIComponent(id)}/verify`, {
      method: "POST",
    });
  }

  listPromotions(): Promise<PromotionDiscovery> {
    return this.request<PromotionDiscovery>("promotions");
  }

  listPromotionEntitlements(
    options: {
      state?: PromotionEntitlement["state"];
      cursor?: string;
      limit?: number;
    } = {},
  ): Promise<PromotionEntitlementPage> {
    return this.request<PromotionEntitlementPage>(
      `promotions/entitlements${queryString(options)}`,
    );
  }

  claimPromotion(body: ClaimPromotionRequest, idempotencyKey: string): Promise<PromotionEntitlement> {
    return this.request<PromotionEntitlement>("promotions/entitlements", {
      method: "POST",
      body,
      idempotencyKey,
    });
  }

  getPromotionEntitlement(id: string): Promise<PromotionEntitlement> {
    return this.request<PromotionEntitlement>(
      `promotions/entitlements/${encodeURIComponent(id)}`,
    );
  }

  getNotificationPreferences(): Promise<NotificationPreferences> {
    return this.request<NotificationPreferences>("notification-preferences");
  }

  updateNotificationPreferences(
    body: UpdateNotificationPreferences,
  ): Promise<NotificationPreferences> {
    return this.request<NotificationPreferences>("notification-preferences", {
      method: "PUT",
      body,
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

  private async publicRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? (options.body === undefined ? "GET" : "POST");
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`/api/v1/member/${path}`, {
      method,
      credentials: "include",
      headers: Object.keys(headers).length ? headers : undefined,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return this.read<T>(response);
  }

  private refresh(): Promise<string> {
    if (!this.refreshing) {
      this.refreshing = this.publicRequest<MemberRefreshResponse>("auth/refresh", { method: "POST" })
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

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
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

function queryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Normalize a Member phone entered in a local Thai format to its API wire form. */
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
