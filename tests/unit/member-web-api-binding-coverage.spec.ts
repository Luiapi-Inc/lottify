import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const OPENAPI = join(ROOT, "apps", "api", "openapi", "openapi.json");
const MEMBER_APP = join(ROOT, "apps", "member-web", "app");
const CLIENT = join(MEMBER_APP, "lib", "member-api.ts");

const bindings: Record<string, string> = {
  "POST /api/v1/member/auth/otp/request": "requestOtp",
  "POST /api/v1/member/auth/otp/verify": "verifyOtp",
  "POST /api/v1/member/auth/login": "login",
  "POST /api/v1/member/auth/password/reset": "resetPassword",
  "POST /api/v1/member/auth/recovery/otp/request": "requestRecoveryOtp",
  "POST /api/v1/member/auth/recovery/otp/verify": "verifyRecoveryOtp",
  "POST /api/v1/member/auth/refresh": "__internalRefresh",
  "POST /api/v1/member/auth/logout": "logout",
  "POST /api/v1/member/auth/revoke-all": "revokeAll",
  "GET /api/v1/member/auth/me": "getSession",
  "GET /api/v1/member/products": "listProducts",
  "GET /api/v1/member/products/{id}": "getProduct",
  "GET /api/v1/member/bet-types": "listBetTypes",
  "GET /api/v1/member/bet-types/{id}": "getBetType",
  "GET /api/v1/member/products/{productId}/draws": "listDraws",
  "GET /api/v1/member/draws/{id}": "getDraw",
  "GET /api/v1/member/draws/{id}/eligibility": "getDrawEligibility",
  "POST /api/v1/member/draws/{drawId}/quotes": "createQuote",
  "GET /api/v1/member/quotes/{id}": "getQuote",
  "POST /api/v1/member/quotes/{quoteId}/orders": "createOrder",
  "GET /api/v1/member/orders": "listOrders",
  "GET /api/v1/member/orders/{id}": "getOrder",
  "POST /api/v1/member/orders/{id}/confirm": "confirmOrder",
  "POST /api/v1/member/orders/{id}/cancel": "cancelOrder",
  "GET /api/v1/member/orders/{id}/receipt": "getReceipt",
  "GET /api/v1/member/orders/{id}/settlement": "getSettlement",
  "GET /api/v1/member/sessions": "listSessions",
  "DELETE /api/v1/member/sessions/{id}": "revokeSession",
  "GET /api/v1/member/devices": "listDevices",
  "DELETE /api/v1/member/devices/{id}": "revokeDevice",
  "GET /api/v1/member/wallet": "getWallet",
  "GET /api/v1/member/wallet/transactions": "listWalletTransactions",
  "GET /api/v1/member/deposits/methods": "listDepositMethods",
  "GET /api/v1/member/deposits/methods/{code}": "describeDepositMethod",
  "POST /api/v1/member/deposits": "createDeposit",
  "POST /api/v1/member/deposits/{id}/reconcile": "reconcileDeposit",
  "GET /api/v1/member/deposits/{id}": "getDeposit",
  "POST /api/v1/member/withdrawals/preflight": "preflightWithdrawal",
  "POST /api/v1/member/withdrawals": "createWithdrawal",
  "GET /api/v1/member/withdrawals": "listWithdrawals",
  "GET /api/v1/member/withdrawals/{id}": "getWithdrawal",
  "POST /api/v1/member/withdrawals/{id}/cancel": "cancelWithdrawal",
  "POST /api/v1/member/payout-destinations": "addPayoutDestination",
  "GET /api/v1/member/payout-destinations": "listPayoutDestinations",
  "GET /api/v1/member/payout-destinations/{id}": "getPayoutDestination",
  "POST /api/v1/member/payout-destinations/{id}/verify": "verifyPayoutDestination",
  "GET /api/v1/member/promotions": "listPromotions",
  "GET /api/v1/member/promotions/entitlements": "listPromotionEntitlements",
  "POST /api/v1/member/promotions/entitlements": "claimPromotion",
  "GET /api/v1/member/promotions/entitlements/{id}": "getPromotionEntitlement",
  "GET /api/v1/member/notification-preferences": "getNotificationPreferences",
  "PUT /api/v1/member/notification-preferences": "updateNotificationPreferences",
  "GET /api/v1/member/terms": "getTerms",
  "POST /api/v1/member/terms/accept": "acceptTerms",
  "GET /api/v1/member/profile": "getProfile",
  "PATCH /api/v1/member/profile": "updateProfile",
  "GET /api/v1/member/readiness": "getReadiness",
};

function collectMemberOperations(): string[] {
  const document = JSON.parse(readFileSync(OPENAPI, "utf8")) as {
    paths: Record<string, Record<string, unknown>>;
  };
  const methods = new Set(["get", "post", "patch", "put", "delete"]);
  const operations: string[] = [];
  for (const [path, pathItem] of Object.entries(document.paths)) {
    if (!path.startsWith("/api/v1/member/")) continue;
    for (const method of Object.keys(pathItem)) {
      if (methods.has(method)) operations.push(`${method.toUpperCase()} ${path}`);
    }
  }
  return operations.sort();
}

function collectSources(directory: string): string {
  return readdirSync(directory)
    .flatMap((name) => {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) return collectSources(path);
      return /\.(ts|tsx)$/.test(name) ? readFileSync(path, "utf8") : "";
    })
    .join("\n");
}

describe("Member Web API binding coverage", () => {
  const operations = collectMemberOperations();
  const clientSource = readFileSync(CLIENT, "utf8");
  const appSource = collectSources(MEMBER_APP);

  it("tracks every current Member OpenAPI operation without stale or missing bindings", () => {
    expect(Object.keys(bindings).sort()).toEqual(operations);
  });

  it("implements every binding in the shared Member API client", () => {
    for (const [operation, method] of Object.entries(bindings)) {
      if (method === "__internalRefresh") {
        expect(clientSource, operation).toContain('publicRequest<MemberRefreshResponse>("auth/refresh"');
        continue;
      }
      expect(clientSource, operation).toContain(`${method}(`);
    }
  });

  it("has a real Member Web call site for every exposed operation", () => {
    for (const [operation, method] of Object.entries(bindings)) {
      if (method === "__internalRefresh") {
        expect(clientSource, operation).toContain("await this.refresh()");
        continue;
      }
      expect(appSource, operation).toContain(`memberApi.${method}(`);
    }
  });

  it("preserves the approved Member route inventory", () => {
    const routes = [
      "/", "/login", "/register", "/otp", "/forgot-password", "/enroll",
      "/terms", "/profile", "/eligibility", "/buy", "/buy/bet", "/buy/quote",
      "/buy/receipt", "/slips", "/slips/detail", "/wallet", "/wallet/deposit",
      "/wallet/deposit/status", "/wallet/withdraw", "/wallet/withdraw/status",
      "/promotions", "/account", "/account/profile", "/account/kyc",
      "/account/bank-account", "/account/referral", "/account/security",
    ];
    for (const route of routes) {
      const relative = route === "/" ? "page.tsx" : `${route.slice(1)}/page.tsx`;
      expect(() => statSync(join(MEMBER_APP, relative)), route).not.toThrow();
    }
  });
});
