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
export type MemberSessionIdentity = Schema<"MemberMeResponse">;
export type MemberRevokedResponse = Schema<"MemberRevokedResponse">;
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
export type MemberProductSummary = Schema<"MemberProductSummaryBody">;
export type MemberProductPage = Schema<"MemberProductPageBody">;
export type MemberProductDetail = Schema<"MemberProductDetailBody">;
export type MemberProductVersion = MemberProductDetail["versions"][number];
export type MemberDraw = Schema<"MemberDrawDetailBody">;
export type MemberDrawPage = Schema<"MemberDrawPageBody">;
export type MemberDrawBetType = MemberDraw["betTypes"][number];
export type MemberDrawEligibility = Schema<"MemberDrawEligibilityBody">;
export type QuoteCreateLine = Schema<"QuoteCreateBody">;
export type QuoteCreateRequest = { currency: "THB"; lines: QuoteCreateLine[] };
export type BettingQuote = Schema<"BettingQuoteBody">;
export type BettingQuoteLine = BettingQuote["lines"][number];
export type BetOrder = Schema<"BetOrderBody">;
export type BetOrderState = BetOrder["state"];
export type BetOrderList = Schema<"BetOrderListBody">;
export type BetReceipt = Schema<"BetReceiptBody">;
export type MemberSettlementOutcome = Schema<"MemberSettlementOutcomeBody">;
export type WalletBalance = Schema<"WalletBalanceBody">;
export type WalletBucket = Schema<"WalletBucketBody">;
export type WalletTransaction = Schema<"WalletTransactionBody">;
export type WalletTransactionPage = Schema<"WalletTransactionPageBody">;
export type AddPayoutDestinationRequest = Schema<"AddPayoutDestinationBody">;
export type MemberSessionView = Schema<"MemberSessionViewBody">;
export type MemberDeviceView = Schema<"MemberDeviceViewBody">;
export type MemberRevoked = Schema<"MemberRevokedResponse">;
export type PromotionDiscovery = Schema<"PromotionDiscoveryBody">;
export type PromotionDiscoveryItem = Schema<"PromotionDiscoveryItemBody">;
export type PromotionEntitlement = Schema<"PromotionEntitlementBody">;
export type PromotionEntitlementPage = Schema<"PromotionEntitlementPageBody">;
export type TurnoverEntry = PromotionEntitlement["turnoverEntries"][number];

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

  /**
   * Server-authoritative identity for the durable session.
   *
   * Called after a navigation/reload, when the in-memory access token is gone:
   * `request()` then refreshes from the session cookie first, so a 200 here
   * proves the session survived the navigation (and a `SESSION_REQUIRED`
   * failure means the browser has no valid session at all).
   */
  getSession(): Promise<MemberSessionIdentity> {
    return this.request<MemberSessionIdentity>("auth/me");
  }

  /** Revoke the current session (API clears the refresh credential, the web
   *  tier clears the browser's session cookie) and drop the in-memory token. */
  logout(): Promise<MemberRevokedResponse> {
    return this.publicRequest<MemberRevokedResponse>("auth/logout", {})
      .finally(() => this.clearSession());
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

  /** Published Lottery Products available to bet on (Member discovery). */
  listProducts(options: { limit?: number; cursor?: string } = {}): Promise<MemberProductPage> {
    return this.request<MemberProductPage>(withQuery("products", { limit: options.limit, cursor: options.cursor }));
  }

  getProduct(id: string): Promise<MemberProductDetail> {
    return this.request<MemberProductDetail>(`products/${encodeURIComponent(id)}`);
  }

  /** Draws of a Product. Member discovery never returns SETTLED draws unless
   *  the caller asks for that state explicitly. */
  listDraws(productId: string, options: { state?: string; limit?: number; cursor?: string } = {}): Promise<MemberDrawPage> {
    return this.request<MemberDrawPage>(
      withQuery(`products/${encodeURIComponent(productId)}/draws`, {
        state: options.state,
        limit: options.limit,
        cursor: options.cursor,
      }),
    );
  }

  getDraw(id: string): Promise<MemberDraw> {
    return this.request<MemberDraw>(`draws/${encodeURIComponent(id)}`);
  }

  /** Authoritative cutoff eligibility: eligible only strictly before cutoff. */
  getDrawEligibility(id: string): Promise<MemberDrawEligibility> {
    return this.request<MemberDrawEligibility>(`draws/${encodeURIComponent(id)}/eligibility`);
  }

  /** Server-authoritative Quote: the server resolves every payout and
   *  restriction, so the client never prices a line locally. */
  createQuote(drawId: string, body: QuoteCreateRequest, idempotencyKey: string): Promise<BettingQuote> {
    return this.request<BettingQuote>(`draws/${encodeURIComponent(drawId)}/quotes`, {
      method: "POST",
      body,
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

  listOrders(options: { limit?: number; cursor?: string; state?: string } = {}): Promise<BetOrderList> {
    return this.request<BetOrderList>(
      withQuery("orders", { limit: options.limit, cursor: options.cursor, state: options.state }),
    );
  }

  getOrder(id: string): Promise<BetOrder> {
    return this.request<BetOrder>(`orders/${encodeURIComponent(id)}`);
  }

  /** Confirm is the only command with a financial effect (stake reserve/commit). */
  confirmOrder(id: string, version: number, idempotencyKey: string): Promise<BetOrder> {
    return this.request<BetOrder>(`orders/${encodeURIComponent(id)}/confirm`, {
      method: "POST",
      body: { version },
      idempotencyKey,
    });
  }

  /** Cancel is refused by the server after the Draw cutoff. */
  cancelOrder(id: string, version: number, reason: string | undefined, idempotencyKey: string): Promise<BetOrder> {
    return this.request<BetOrder>(`orders/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body: reason ? { version, reason } : { version },
      idempotencyKey,
    });
  }

  getReceipt(orderId: string): Promise<BetReceipt> {
    return this.request<BetReceipt>(`orders/${encodeURIComponent(orderId)}/receipt`);
  }

  /** Settlement outcome; authoritative only once the batch has COMPLETED. */
  getSettlement(orderId: string): Promise<MemberSettlementOutcome> {
    return this.request<MemberSettlementOutcome>(`orders/${encodeURIComponent(orderId)}/settlement`);
  }

  getWallet(): Promise<WalletBalance> {
    return this.request<WalletBalance>("wallet");
  }

  listWalletTransactions(options: { limit?: number; cursor?: string } = {}): Promise<WalletTransactionPage> {
    return this.request<WalletTransactionPage>(
      withQuery("wallet/transactions", { limit: options.limit, cursor: options.cursor }),
    );
  }

  /** Register a new payout destination; the API keeps it PENDING until its own
   *  independent verification runs. */
  addPayoutDestination(body: AddPayoutDestinationRequest): Promise<PayoutDestination> {
    return this.request<PayoutDestination>("payout-destinations", { method: "POST", body });
  }

  verifyPayoutDestination(id: string): Promise<PayoutDestination> {
    return this.request<PayoutDestination>(`payout-destinations/${encodeURIComponent(id)}/verify`, {
      method: "POST",
    });
  }

  listSessions(): Promise<MemberSessionView[]> {
    return this.request<MemberSessionView[]>("sessions");
  }

  revokeSession(id: string): Promise<MemberRevoked> {
    return this.request<MemberRevoked>(`sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  listDevices(): Promise<MemberDeviceView[]> {
    return this.request<MemberDeviceView[]>("devices");
  }

  revokeDevice(id: string): Promise<MemberRevoked> {
    return this.request<MemberRevoked>(`devices/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  /** Campaigns the Member may claim, with the server's own eligibility verdict. */
  listPromotions(): Promise<PromotionDiscovery> {
    return this.request<PromotionDiscovery>("promotions");
  }

  listPromotionEntitlements(options: { limit?: number; cursor?: string; state?: string } = {}): Promise<PromotionEntitlementPage> {
    return this.request<PromotionEntitlementPage>(
      withQuery("promotions/entitlements", { limit: options.limit, cursor: options.cursor, state: options.state }),
    );
  }

  /** Revoke every active session of this Member (including the calling one). */
  revokeAllSessions(): Promise<MemberRevoked> {
    return this.request<MemberRevoked>("auth/revoke-all", { method: "POST" });
  }

  getPromotionEntitlement(id: string): Promise<PromotionEntitlement> {
    return this.request<PromotionEntitlement>(`promotions/entitlements/${encodeURIComponent(id)}`);
  }

  claimPromotion(campaignVersionId: string, idempotencyKey: string): Promise<PromotionEntitlement> {
    return this.request<PromotionEntitlement>("promotions/entitlements", {
      method: "POST",
      body: { campaignVersionId },
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
      method?: "GET" | "POST" | "PATCH" | "DELETE";
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

/** Append only the query parameters the caller actually set, so an absent
 *  filter is never sent as `undefined`/empty to the API. */
export function withQuery(
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `member-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const memberApi = new MemberApiClient();
