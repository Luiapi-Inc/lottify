# Lottify v1 — API Specification (complete)

Generated from the live OpenAPI 3.0.0 contract (`apps/api/openapi/openapi.json`).

**100 paths · 108 operations · 120 schemas**

Source: `main @ e2cf283` · generated 2026-09-10 17:30 (+07)

---
## Contents

- **Member API**
  - [`/member/auth`](#member--auth)
  - [`/member/bet-types`](#member--bet-types)
  - [`/member/deposits`](#member--deposits)
  - [`/member/devices`](#member--devices)
  - [`/member/draws`](#member--draws)
  - [`/member/notification-preferences`](#member--notification-preferences)
  - [`/member/orders`](#member--orders)
  - [`/member/payout-destinations`](#member--payout-destinations)
  - [`/member/products`](#member--products)
  - [`/member/promotions`](#member--promotions)
  - [`/member/quotes`](#member--quotes)
  - [`/member/sessions`](#member--sessions)
  - [`/member/wallet`](#member--wallet)
  - [`/member/withdrawals`](#member--withdrawals)
- **Admin API**
  - [`/admin/accounting-periods`](#admin--accounting-periods)
  - [`/admin/approvals`](#admin--approvals)
  - [`/admin/audit`](#admin--audit)
  - [`/admin/auth`](#admin--auth)
  - [`/admin/draws`](#admin--draws)
  - [`/admin/lottery`](#admin--lottery)
  - [`/admin/products`](#admin--products)
  - [`/admin/promotions`](#admin--promotions)
  - [`/admin/reconciliation`](#admin--reconciliation)
  - [`/admin/reports`](#admin--reports)
  - [`/admin/settlement`](#admin--settlement)
  - [`/admin/withdrawals`](#admin--withdrawals)
- **Common** — [conventions](#common-conventions) · [schemas](#schemas)
---


## Member API

<a id="member--auth"></a>
### `/member/auth`

#### `POST /api/v1/member/auth/logout`

*Revoke the current Member refresh session*

- **Responses:**
  - `200` → `MemberRevokedResponse`

#### `GET /api/v1/member/auth/me`

*Return server-authoritative Member identity*

- **Responses:**
  - `200` → `MemberMeResponse`

#### `POST /api/v1/member/auth/otp/request`

*Request a purpose-scoped OTP for a Member phone*

- **Request** `application/json`: `OtpRequestBody`

- **Responses:**
  - `200` → `OtpRequestResponse`

#### `POST /api/v1/member/auth/otp/verify`

*Verify an OTP and establish a Member session*

- **Request** `application/json`: `OtpVerifyBody`

- **Responses:**
  - `200` → `MemberSessionResponse`

#### `POST /api/v1/member/auth/refresh`

*Rotate the Member refresh credential*

- **Responses:**
  - `200` → `MemberRefreshResponse`

#### `POST /api/v1/member/auth/revoke-all`

*Revoke every active session for the Member*

- **Responses:**
  - `200` → `MemberRevokedResponse`

<a id="member--bet-types"></a>
### `/member/bet-types`

#### `GET /api/v1/member/bet-types`

*List published Lottery Bet Types available to the Member*

| param | in | type | required |
|---|---|---|---|
| `cursor` | query | string | no |
| `limit` | query | number | no |

- **Responses:**
  - `200` → `MemberBetTypePageBody`

#### `GET /api/v1/member/bet-types/{id}`

*Get a published Lottery Bet Type with its published versions*

- **Responses:**
  - `200` → `MemberBetTypeDetailBody`

<a id="member--deposits"></a>
### `/member/deposits`

#### `POST /api/v1/member/deposits`

- **Request** `application/json`: `DepositInitiateBody`

- **Responses:**
  - `200` → `DepositBody`

#### `GET /api/v1/member/deposits/{id}`

*Read a Member Deposit by id*

- **Responses:**
  - `200` → `DepositBody`

#### `POST /api/v1/member/deposits/{id}/reconcile`

*Reconcile a Deposit against the provider; credits only on proven APPROVED*

- **Responses:**
  - `200` → `DepositBody`

<a id="member--devices"></a>
### `/member/devices`

#### `GET /api/v1/member/devices`

*List the Member's logical devices*

- **Responses:**
  - `200` → array<`MemberDeviceViewBody`>

#### `DELETE /api/v1/member/devices/{id}`

*Revoke all sessions for one of the Member's devices*

- **Responses:**
  - `200` → `MemberRevokedResponse`

<a id="member--draws"></a>
### `/member/draws`

#### `POST /api/v1/member/draws/{drawId}/quotes`

*Create a betting Quote: server-authoritative resolution of bet lines*

- **Request** `application/json`: array<`QuoteCreateBody`>

- **Responses:**
  - `200` → `BettingQuoteBody`

#### `GET /api/v1/member/draws/{id}`

*Get a Lottery Draw detail with status, cutoff and server time*

- **Responses:**
  - `200` → `MemberDrawDetailBody`

#### `GET /api/v1/member/draws/{id}/eligibility`

*Cutoff eligibility: strictly-before eligible; exact/beyond rejected*

- **Responses:**
  - `200` → `MemberDrawEligibilityBody`

<a id="member--notification-preferences"></a>
### `/member/notification-preferences`

#### `GET /api/v1/member/notification-preferences`

*Read the Member's complete notification preference matrix*

- **Responses:**
  - `200` → `NotificationPreferencesBody`

#### `PUT /api/v1/member/notification-preferences`

- **Request** `application/json`: `UpdateNotificationPreferencesBody`

- **Responses:**
  - `200` → `NotificationPreferencesBody`

<a id="member--orders"></a>
### `/member/orders`

#### `GET /api/v1/member/orders/{id}`

*Read a Member Bet Order by id*

- **Responses:**
  - `200` → `BetOrderBody`

#### `POST /api/v1/member/orders/{id}/cancel`

*Cancel a confirmed Bet Order (explicit command)*

- **Request** `application/json`: `BetOrderCommandBody`

- **Responses:**
  - `200` → `BetOrderBody`

#### `POST /api/v1/member/orders/{id}/confirm`

*Confirm a Bet Order (explicit command)*

- **Request** `application/json`: `BetOrderCommandBody`

- **Responses:**
  - `200` → `BetOrderBody`

#### `GET /api/v1/member/orders/{id}/receipt`

*Read the immutable Bet Receipt of a confirmed Order*

- **Responses:**
  - `200` → `BetReceiptBody`

#### `GET /api/v1/member/orders/{id}/settlement`

*Read the settlement outcome of a Member Bet Order*

- **Responses:**
  - `200` → `MemberSettlementOutcomeBody`

<a id="member--payout-destinations"></a>
### `/member/payout-destinations`

#### `POST /api/v1/member/payout-destinations`

*Register a Member-linked Payout Destination pending verification*

- **Request** `application/json`: `AddPayoutDestinationBody`

- **Responses:**
  - `201` → `PayoutDestinationBody`

#### `GET /api/v1/member/payout-destinations`

*List the Member's Payout Destinations*

- **Responses:**
  - `200` → `PayoutDestinationListBody`

#### `GET /api/v1/member/payout-destinations/{id}`

*Read one Payout Destination owned by the Member*

- **Responses:**
  - `200` → `PayoutDestinationBody`

#### `POST /api/v1/member/payout-destinations/{id}/verify`

*Request independent verification of the Payout Destination; only normalized evidence crosses the seam*

- **Responses:**
  - `200` → `PayoutDestinationBody`

<a id="member--products"></a>
### `/member/products`

#### `GET /api/v1/member/products`

*List published Lottery Products available to the Member*

| param | in | type | required |
|---|---|---|---|
| `cursor` | query | string | no |
| `limit` | query | number | no |

- **Responses:**
  - `200` → `MemberProductPageBody`

#### `GET /api/v1/member/products/{id}`

*Get a published Lottery Product with its enabled Bet Types*

- **Responses:**
  - `200` → `MemberProductDetailBody`

#### `GET /api/v1/member/products/{productId}/draws`

*List Lottery Draws for a Product (betting discovery)*

| param | in | type | required |
|---|---|---|---|
| `state` | query | string | no |
| `cursor` | query | string | no |
| `limit` | query | number | no |

- **Responses:**
  - `200` → `MemberDrawPageBody`

<a id="member--promotions"></a>
### `/member/promotions`

#### `GET /api/v1/member/promotions`

*Discover published Promotions with the Member's eligibility decision*

- **Responses:**
  - `200` → `PromotionDiscoveryBody`

#### `GET /api/v1/member/promotions/entitlements`

*List the Member's Promotion Entitlements with turnover progress*

| param | in | type | required |
|---|---|---|---|
| `state` | query | string | no |
| `cursor` | query | string | no |
| `limit` | query | number | no |

- **Responses:**
  - `200` → `PromotionEntitlementPageBody`

#### `POST /api/v1/member/promotions/entitlements`

- **Request** `application/json`: `ClaimPromotionBody`

- **Responses:**
  - `200` → `PromotionEntitlementBody`

#### `GET /api/v1/member/promotions/entitlements/{id}`

*Read one Promotion Entitlement with its turnover trail*

- **Responses:**
  - `200` → `PromotionEntitlementBody`

<a id="member--quotes"></a>
### `/member/quotes`

#### `GET /api/v1/member/quotes/{id}`

*Read a Member betting Quote by id*

- **Responses:**
  - `200` → `BettingQuoteBody`

#### `POST /api/v1/member/quotes/{quoteId}/orders`

*Create a Bet Order from an authorised Quote*

- **Responses:**
  - `200` → `BetOrderBody`

<a id="member--sessions"></a>
### `/member/sessions`

#### `GET /api/v1/member/sessions`

*List the Member's active sessions*

- **Responses:**
  - `200` → array<`MemberSessionViewBody`>

#### `DELETE /api/v1/member/sessions/{id}`

*Revoke one of the Member's sessions*

- **Responses:**
  - `200` → `MemberRevokedResponse`

<a id="member--wallet"></a>
### `/member/wallet`

#### `GET /api/v1/member/wallet`

*Read the Member's Wallet balances (bounded buckets)*

- **Responses:**
  - `200` → `WalletBalanceBody`

#### `GET /api/v1/member/wallet/transactions`

*List the Member's Ledger-backed transaction history with cursor pagination*

| param | in | type | required |
|---|---|---|---|
| `cursor` | query | string | no |
| `limit` | query | number | no |

- **Responses:**
  - `200` → `WalletTransactionPageBody`

<a id="member--withdrawals"></a>
### `/member/withdrawals`

#### `POST /api/v1/member/withdrawals`

- **Request** `application/json`: `CreateWithdrawalBody`

- **Responses:**
  - `202` → `WithdrawalBody`

#### `GET /api/v1/member/withdrawals`

*List the Member's Withdrawals*

| param | in | type | required |
|---|---|---|---|
| `cursor` | query | string | no |
| `limit` | query | number | no |

- **Responses:**
  - `200` → `WithdrawalListBody`

#### `GET /api/v1/member/withdrawals/{id}`

*Read one Withdrawal owned by the Member*

- **Responses:**
  - `200` → `WithdrawalBody`

#### `POST /api/v1/member/withdrawals/{id}/cancel`

*Cancel a Withdrawal before payout; releases the Reservation through Wallet & Ledger*

- **Responses:**
  - `200` → `WithdrawalBody`


## Admin API

<a id="admin--accounting-periods"></a>
### `/admin/accounting-periods`

#### `GET /api/v1/admin/accounting-periods`

*List authoritative Accounting Periods*

| param | in | type | required |
|---|---|---|---|
| `effectiveTo` | query | string | no |
| `effectiveFrom` | query | string | no |
| `mode` | query | string | no |
| `state` | query | string | no |
| `cursor` | query | string | no |
| `limit` | query | number | no |

- **Responses:**
  - `200` → `AccountingPeriodListResponse`
  - `400` → `ApiErrorResponse`
  - `401` → `ApiErrorResponse`
  - `403` → `ApiErrorResponse`

#### `POST /api/v1/admin/accounting-periods/create-custom`

*Create a governed Custom Accounting Period DRAFT and replacement preview*

- **Request** `application/json`: `CreateCustomAccountingPeriodBody`

- **Responses:**
  - `201` → `AccountingPeriodCommandResponse`
  - `400` → `ApiErrorResponse`
  - `401` → `ApiErrorResponse`
  - `403` → `ApiErrorResponse`
  - `409` → `ApiErrorResponse`

#### `GET /api/v1/admin/accounting-periods/{id}`

*Get one authoritative Accounting Period*

| param | in | type | required |
|---|---|---|---|
| `id` | path | string | yes |

- **Responses:**
  - `200` → `AccountingPeriodResponse`
  - `401` → `ApiErrorResponse`
  - `403` → `ApiErrorResponse`
  - `404` → `ApiErrorResponse`

#### `POST /api/v1/admin/accounting-periods/{id}/approve`

*Approve and schedule a pending Custom Accounting Period*

| param | in | type | required |
|---|---|---|---|
| `id` | path | string | yes |

- **Request** `application/json`: `ApproveAccountingPeriodBody`

- **Responses:**
  - `200` → `AccountingPeriodCommandResponse`
  - `400` → `ApiErrorResponse`
  - `401` → `ApiErrorResponse`
  - `403` → `ApiErrorResponse`
  - `404` → `ApiErrorResponse`
  - `409` → `ApiErrorResponse`

#### `POST /api/v1/admin/accounting-periods/{id}/cancel`

*Cancel or withdraw a pre-OPEN Custom Accounting Period*

| param | in | type | required |
|---|---|---|---|
| `id` | path | string | yes |

- **Request** `application/json`: `CancelAccountingPeriodBody`

- **Responses:**
  - `200` → `AccountingPeriodCancellationResponse`
  - `400` → `ApiErrorResponse`
  - `401` → `ApiErrorResponse`
  - `403` → `ApiErrorResponse`
  - `404` → `ApiErrorResponse`
  - `409` → `ApiErrorResponse`

#### `POST /api/v1/admin/accounting-periods/{id}/close`

*Request or approve governed close for a CLOSING Accounting Period*

| param | in | type | required |
|---|---|---|---|
| `id` | path | string | yes |

- **Request** `application/json`: `CloseAccountingPeriodBody`

- **Responses:**
  - `200` → `AccountingPeriodCloseResponse`
  - `400` → `ApiErrorResponse`
  - `401` → `ApiErrorResponse`
  - `403` → `ApiErrorResponse`
  - `404` → `ApiErrorResponse`
  - `409` → `ApiErrorResponse`

#### `POST /api/v1/admin/accounting-periods/{id}/submit`

*Submit a Custom Accounting Period DRAFT for approval*

| param | in | type | required |
|---|---|---|---|
| `id` | path | string | yes |

- **Request** `application/json`: `SubmitAccountingPeriodBody`

- **Responses:**
  - `200` → `AccountingPeriodCommandResponse`
  - `400` → `ApiErrorResponse`
  - `401` → `ApiErrorResponse`
  - `403` → `ApiErrorResponse`
  - `404` → `ApiErrorResponse`
  - `409` → `ApiErrorResponse`

<a id="admin--approvals"></a>
### `/admin/approvals`

#### `GET /api/v1/admin/approvals`

*List the immutable Admin approval work queue with requester/target/state/age and evidence*

| param | in | type | required |
|---|---|---|---|
| `cursor` | query | string | no |
| `limit` | query | number | no |
| `to` | query | string | no |
| `from` | query | string | no |
| `resourceId` | query | string | no |
| `resourceType` | query | string | no |
| `action` | query | string | no |
| `state` | query | string | no |

- **Responses:**
  - `200` → `AdminApprovalListResponse`
  - `400` — VALIDATION_ERROR
  - `401` — AUTHENTICATION_REQUIRED
  - `403` — ACCESS_DENIED

#### `GET /api/v1/admin/approvals/{id}`

*Read one approval evidence record with requester/approver and linked audit*

- **Responses:**
  - `200` → `AdminApprovalResponse`
  - `401` — AUTHENTICATION_REQUIRED
  - `403` — ACCESS_DENIED
  - `404` — NOT_FOUND

<a id="admin--audit"></a>
### `/admin/audit`

#### `GET /api/v1/admin/audit/records`

*List immutable audit records with actor/action/resource/outcome and evidence references*

| param | in | type | required |
|---|---|---|---|
| `cursor` | query | string | no |
| `limit` | query | number | no |
| `to` | query | string | no |
| `from` | query | string | no |
| `outcome` | query | string | no |
| `resourceId` | query | string | no |
| `resourceType` | query | string | no |
| `action` | query | string | no |
| `actor` | query | string | no |

- **Responses:**
  - `200` → `AuditRecordListResponse`
  - `400` — VALIDATION_ERROR
  - `401` — AUTHENTICATION_REQUIRED
  - `403` — ACCESS_DENIED

#### `GET /api/v1/admin/audit/records/{id}`

*Read one audit record with actor and linked reauth/approval evidence*

- **Responses:**
  - `200` → `AuditRecordResponse`
  - `401` — AUTHENTICATION_REQUIRED
  - `403` — ACCESS_DENIED
  - `404` — NOT_FOUND

<a id="admin--auth"></a>
### `/admin/auth`

#### `POST /api/v1/admin/auth/login`

*Authenticate Admin credentials and start mandatory MFA*

- **Responses:**
  - `200`

#### `POST /api/v1/admin/auth/logout`

*Revoke the current Admin refresh-token family*

- **Responses:**
  - `200` → `AdminRevokedResponse`

#### `POST /api/v1/admin/auth/me`

*Return server-authoritative Admin identity and capabilities*

- **Responses:**
  - `200` → `AdminMeResponse`

#### `POST /api/v1/admin/auth/mfa/confirm`

*Confirm and enable mandatory Admin TOTP MFA*

- **Responses:**
  - `200`

#### `POST /api/v1/admin/auth/mfa/setup`

*Create an Admin TOTP enrollment secret*

- **Responses:**
  - `200`

#### `POST /api/v1/admin/auth/mfa/verify`

*Verify Admin MFA and establish the authenticated session*

- **Responses:**
  - `200` → `AdminAccessTokenResponse`

#### `POST /api/v1/admin/auth/reauth`

*Create scoped fresh-MFA evidence for a sensitive action class*

- **Request** `application/json`: `AdminReauthBody`

- **Responses:**
  - `200` → `AdminReauthResponse`

#### `POST /api/v1/admin/auth/refresh`

*Rotate the HttpOnly Admin refresh credential*

- **Responses:**
  - `200` → `AdminAccessTokenResponse`

#### `POST /api/v1/admin/auth/revoke-all`

*Revoke every active session for the current Admin*

- **Responses:**
  - `200` → `AdminRevokedResponse`

<a id="admin--draws"></a>
### `/admin/draws`

#### `GET /api/v1/admin/draws`

*List Lottery Draws*

| param | in | type | required |
|---|---|---|---|
| `state` | query | string | no |
| `productId` | query | string | no |
| `cursor` | query | string | no |
| `limit` | query | number | no |

- **Responses:**
  - `200`

#### `POST /api/v1/admin/draws/{drawId}/result`

*Intake a Result revision for a Draw*

- **Request** `application/json`: `Object`

- **Responses:**
  - `201`

#### `POST /api/v1/admin/draws/{drawId}/result/ingest-from-provider`

*Ingest the authoritative Result from the configured provider*

- **Responses:**
  - `201`

#### `POST /api/v1/admin/draws/{drawId}/results/{revision}/confirm`

*Confirm a Result revision (governed command)*

- **Responses:**
  - `201`

#### `POST /api/v1/admin/draws/{drawId}/results/{revision}/correct`

*Immutable Result correction (new revision, compensating postings)*

- **Responses:**
  - `201`

#### `POST /api/v1/admin/draws/{drawId}/settlement`

*Run (or resume) the durable Settlement Batch for a Draw*

- **Responses:**
  - `201`

#### `GET /api/v1/admin/draws/{drawId}/settlement`

*Read the Settlement Batch for a Draw*

- **Responses:**
  - `200`

#### `GET /api/v1/admin/draws/{id}`

*Get a Lottery Draw detail*

- **Responses:**
  - `200`

#### `POST /api/v1/admin/draws/{id}/override`

*Apply a governed versioned Draw Override*

- **Request** `application/json`: `OverrideBody`

- **Responses:**
  - `201`

#### `POST /api/v1/admin/draws/{id}/transition`

*Transition a Draw through its lifecycle state machine*

- **Request** `application/json`: `TransitionBody`

- **Responses:**
  - `201`

<a id="admin--lottery"></a>
### `/admin/lottery`

#### `POST /api/v1/admin/lottery/bet-type-versions/{id}/approve`

*Approve and publish a Lottery Bet Type version*

- **Request** `application/json`: `ExpectedVersionBody`

- **Responses:**
  - `201`

#### `POST /api/v1/admin/lottery/bet-type-versions/{id}/submit`

*Submit a Lottery Bet Type version for approval*

- **Request** `application/json`: `ExpectedVersionBody`

- **Responses:**
  - `201`

#### `GET /api/v1/admin/lottery/bet-types`

*List Lottery Bet Types and configuration version summaries*

| param | in | type | required |
|---|---|---|---|
| `state` | query | string | no |
| `cursor` | query | string | no |
| `limit` | query | number | no |

- **Responses:**
  - `200`

#### `POST /api/v1/admin/lottery/bet-types`

*Create a Lottery Bet Type identity*

- **Request** `application/json`: `CreateBetTypeBody`

- **Responses:**
  - `201`

#### `GET /api/v1/admin/lottery/bet-types/{id}`

*Get a Lottery Bet Type and its configuration versions*

| param | in | type | required |
|---|---|---|---|
| `state` | query | string | no |

- **Responses:**
  - `200`

#### `POST /api/v1/admin/lottery/bet-types/{id}/versions`

*Create a Lottery Bet Type DRAFT version*

- **Request** `application/json`: `CreateBetTypeVersionBody`

- **Responses:**
  - `201`

#### `POST /api/v1/admin/lottery/product-versions/{id}/approve`

*Approve and publish a Lottery Product version*

- **Request** `application/json`: `ExpectedVersionBody`

- **Responses:**
  - `201`

#### `POST /api/v1/admin/lottery/product-versions/{id}/submit`

*Submit a Lottery Product version for approval*

- **Request** `application/json`: `ExpectedVersionBody`

- **Responses:**
  - `201`

#### `GET /api/v1/admin/lottery/products`

*List Lottery Products and configuration version summaries*

| param | in | type | required |
|---|---|---|---|
| `state` | query | string | no |
| `cursor` | query | string | no |
| `limit` | query | number | no |

- **Responses:**
  - `200`

#### `POST /api/v1/admin/lottery/products`

*Create a Lottery Product identity*

- **Responses:**
  - `201`

#### `GET /api/v1/admin/lottery/products/{id}`

*Get a Lottery Product and its configuration versions*

| param | in | type | required |
|---|---|---|---|
| `state` | query | string | no |

- **Responses:**
  - `200`

#### `POST /api/v1/admin/lottery/products/{id}/versions`

*Create a Lottery Product DRAFT version*

- **Request** `application/json`: `CreateProductVersionBody`

- **Responses:**
  - `201`

<a id="admin--products"></a>
### `/admin/products`

#### `POST /api/v1/admin/products/{productId}/draws/generate`

*Idempotent rolling Draw generation from schedule occurrences*

- **Request** `application/json`: `GenerateDrawsBody`

- **Responses:**
  - `201`

<a id="admin--promotions"></a>
### `/admin/promotions`

#### `POST /api/v1/admin/promotions`

*Create a DRAFT Promotion Campaign version*

- **Responses:**
  - `201`

#### `GET /api/v1/admin/promotions`

*List Promotion Campaign versions*

| param | in | type | required |
|---|---|---|---|
| `state` | query | string | no |
| `cursor` | query | string | no |
| `limit` | query | number | no |

- **Responses:**
  - `200`

#### `GET /api/v1/admin/promotions/{id}`

*Read a Promotion Campaign version*

- **Responses:**
  - `200`

#### `POST /api/v1/admin/promotions/{id}/approve`

*Approve and publish a validated Promotion Campaign version (fresh MFA required)*

- **Responses:**
  - `200`

#### `POST /api/v1/admin/promotions/{id}/preview`

*Preview the eligibility decision for one Member*

- **Responses:**
  - `200`

#### `POST /api/v1/admin/promotions/{id}/retire`

*Retire a published Promotion Campaign version*

- **Responses:**
  - `200`

#### `POST /api/v1/admin/promotions/{id}/validate`

*Validate a DRAFT Promotion Campaign version*

- **Responses:**
  - `200`

<a id="admin--reconciliation"></a>
### `/admin/reconciliation`

#### `GET /api/v1/admin/reconciliation/discrepancies`

*List durable reconciliation discrepancies with their lifecycle state*

| param | in | type | required |
|---|---|---|---|
| `cursor` | query | string | no |
| `limit` | query | number | no |
| `to` | query | string | no |
| `from` | query | string | no |
| `severity` | query | string | no |
| `status` | query | string | no |
| `currency` | query | string | no |
| `memberId` | query | string | no |
| `runId` | query | string | no |

- **Responses:**
  - `200` → `ReconciliationDiscrepancyListResponse`
  - `400` — VALIDATION_ERROR
  - `401` — AUTHENTICATION_REQUIRED
  - `403` — ACCESS_DENIED

#### `GET /api/v1/admin/reconciliation/discrepancies/{id}`

*Read one discrepancy with expected/observed facts, age, owner and resolution evidence*

- **Responses:**
  - `200` → `ReconciliationDiscrepancyResponse`
  - `401` — AUTHENTICATION_REQUIRED
  - `403` — ACCESS_DENIED
  - `404` — NOT_FOUND

#### `GET /api/v1/admin/reconciliation/runs`

*List Ledger ↔ Wallet reconciliation runs with their inspected window and result*

| param | in | type | required |
|---|---|---|---|
| `cursor` | query | string | no |
| `limit` | query | number | no |
| `to` | query | string | no |
| `from` | query | string | no |
| `result` | query | string | no |
| `currency` | query | string | no |
| `memberId` | query | string | no |

- **Responses:**
  - `200` → `ReconciliationRunListResponse`
  - `400` — VALIDATION_ERROR
  - `401` — AUTHENTICATION_REQUIRED
  - `403` — ACCESS_DENIED

#### `GET /api/v1/admin/reconciliation/runs/{id}`

*Read one reconciliation run with its full inspected evidence*

- **Responses:**
  - `200` → `ReconciliationRunResponse`
  - `401` — AUTHENTICATION_REQUIRED
  - `403` — ACCESS_DENIED
  - `404` — NOT_FOUND

<a id="admin--reports"></a>
### `/admin/reports`

#### `GET /api/v1/admin/reports/accounting-period-financial`

*Accounting-period financial report for a declared half-open window with freshness state*

| param | in | type | required |
|---|---|---|---|
| `timezone` | query | string | no |
| `to` | query | string | no |
| `from` | query | string | no |
| `accountingPeriodId` | query | string | no |

- **Responses:**
  - `200` → `AccountingPeriodFinancialReportResponse`
  - `400` — VALIDATION_ERROR / UNSUPPORTED_REPORTING_TIME_ZONE
  - `401` — AUTHENTICATION_REQUIRED
  - `403` — ACCESS_DENIED
  - `404` — NOT_FOUND

<a id="admin--settlement"></a>
### `/admin/settlement`

#### `GET /api/v1/admin/settlement/{batchId}/orders`

*List the per-Order settlement checkpoints of a batch*

- **Responses:**
  - `200`

<a id="admin--withdrawals"></a>
### `/admin/withdrawals`

#### `GET /api/v1/admin/withdrawals`

*List the withdrawal review, approval, payout and reconciliation queues with severity and evidence*

| param | in | type | required |
|---|---|---|---|
| `cursor` | query | string | no |
| `limit` | query | number | no |
| `state` | query | string | no |
| `queue` | query | string | no |

- **Responses:**
  - `200` → `AdminWithdrawalListBody`

#### `GET /api/v1/admin/withdrawals/{id}`

*Withdrawal detail with eligibility evidence and the workflow timeline*

| param | in | type | required |
|---|---|---|---|
| `id` | path | string | yes |

- **Responses:**
  - `200` → `AdminWithdrawalDetailBody`
  - `404` → `ApiErrorResponse`

#### `POST /api/v1/admin/withdrawals/{id}/approve`

*Approve the withdrawal review and release it for payout*

- **Request** `application/json`: `WithdrawalCommandBody`

- **Responses:**
  - `200` → `AdminWithdrawalBody`
  - `400` → `ApiErrorResponse`
  - `401` → `ApiErrorResponse`
  - `403` → `ApiErrorResponse`
  - `404` → `ApiErrorResponse`
  - `409` → `ApiErrorResponse`

#### `POST /api/v1/admin/withdrawals/{id}/finalize`

*Finalize a confirmed payout: consume the Reservation and post WITHDRAWAL_FINALIZE exactly once*

- **Request** `application/json`: `WithdrawalCommandBody`

- **Responses:**
  - `200` → `AdminWithdrawalBody`
  - `400` → `ApiErrorResponse`
  - `401` → `ApiErrorResponse`
  - `403` → `ApiErrorResponse`
  - `404` → `ApiErrorResponse`
  - `409` → `ApiErrorResponse`

#### `POST /api/v1/admin/withdrawals/{id}/payout`

*Request the external payout for an approved withdrawal; an unknown outcome enters reconciliation*

- **Request** `application/json`: `WithdrawalCommandBody`

- **Responses:**
  - `200` → `AdminWithdrawalBody`
  - `400` → `ApiErrorResponse`
  - `401` → `ApiErrorResponse`
  - `403` → `ApiErrorResponse`
  - `404` → `ApiErrorResponse`
  - `409` → `ApiErrorResponse`

#### `POST /api/v1/admin/withdrawals/{id}/reconcile`

*Reconcile an in-flight or ambiguous payout by provider reference; never re-initiates payout*

- **Request** `application/json`: `WithdrawalCommandBody`

- **Responses:**
  - `200` → `AdminWithdrawalBody`
  - `400` → `ApiErrorResponse`
  - `401` → `ApiErrorResponse`
  - `403` → `ApiErrorResponse`
  - `404` → `ApiErrorResponse`
  - `409` → `ApiErrorResponse`

#### `POST /api/v1/admin/withdrawals/{id}/reject`

*Reject the withdrawal review; the Reservation is released authoritatively*

- **Request** `application/json`: `WithdrawalCommandBody`

- **Responses:**
  - `200` → `AdminWithdrawalBody`
  - `400` → `ApiErrorResponse`
  - `401` → `ApiErrorResponse`
  - `403` → `ApiErrorResponse`
  - `404` → `ApiErrorResponse`
  - `409` → `ApiErrorResponse`


---

## Common conventions

- **Base** `/api/v1`. JSON in/out. Errors: canonical `{ code, message, correlationId }`.
- **Auth** — Member/Admin token spaces are mutually exclusive; `Authorization: Bearer <access>`.
  - Member: phone identity; purpose-scoped OTP → short-lived access + rotating refresh (httpOnly cookie); refresh reuse revokes the session family; sessions/devices first-class.
  - Admin: password + mandatory TOTP MFA; `auth/reauth` yields fresh-MFA evidence; `auth/revoke-all` kills admin sessions.
- **Idempotency** — critical mutations require `Idempotency-Key`. Same key + same payload → prior result; changed payload → `IDEMPOTENCY_CONFLICT`.
- **Optimistic concurrency** — versioned aggregates return `version` + `allowedActions`; stale writes → `VERSION_CONFLICT`.
- **Pagination** — deterministic keyset/cursor with stable sort; allowlisted filters per resource.
- **Member visibility** — Member discovery only ever exposes PUBLISHED lottery configuration; a Product/Bet Type with no PUBLISHED version is not part of the Member catalog.
- **Time** — half-open `[from,to)`; server-authoritative instants; read models expose `dataAsOf`/`generatedAt` + completeness state.
- **Status codes** — 400 validation · 401 no auth · 403 capability denied · 404 missing · 409 idempotency/version conflict · 429 rate limit.


## Schemas

120 component schemas (full definitions in the OpenAPI document).

| schema | shape |
|---|---|
| `AccountingPeriodAcceptedExceptionReferenceBody` | object · 2 fields · required: discrepancyReference, exceptionReference |
| `AccountingPeriodAcceptedExceptionReferenceResponse` | object · 2 fields · required: discrepancyReference, exceptionReference |
| `AccountingPeriodCancellationResponse` | object · 1 fields · required: period |
| `AccountingPeriodCloseEvidenceResponse` | object · 8 fields · required: closedAt, approvalId, reconciliationReferences, checkpointReferences, blockingDiscrepancyReferences, acceptedExceptionReferences |
| `AccountingPeriodCloseResponse` | object · 1 fields · required: period |
| `AccountingPeriodCommandResponse` | object · 2 fields · required: period, replacementPreview |
| `AccountingPeriodCorrectionLineageResponse` | object · 5 fields · required: transactionId, correctionKind, accountingPeriodId, correctsTransactionId, originalAccountingPeriodId |
| `AccountingPeriodFinancialReportResponse` | object · 9 fields · required: generatedAt, dataAsOf, projectionLagMs, completeness, reportingTimezone, range |
| `AccountingPeriodListResponse` | object · 2 fields · required: items, nextCursor |
| `AccountingPeriodPreviewPeriodResponse` | object · 4 fields · required: id, effectiveStart, effectiveEnd, generationKind |
| `AccountingPeriodReplacementPreviewResponse` | object · 2 fields · required: affectedAutomaticPeriods, residualFragments |
| `AccountingPeriodReportCoverageGapResponse` | object · 2 fields · required: from, to |
| `AccountingPeriodReportCoverageResponse` | object · 3 fields · required: authoritativePeriodCount, uncoveredRanges, unobservedRange |
| `AccountingPeriodReportGroupResponse` | object · 9 fields · required: accountingPeriodId, mode, generationKind, effectiveStart, effectiveEnd, state |
| `AccountingPeriodReportRangeResponse` | object · 5 fields · required: from, to, boundary, source, accountingPeriodId |
| `AccountingPeriodResidualFragmentResponse` | object · 4 fields · required: sourcePeriodId, effectiveStart, effectiveEnd, generationKind |
| `AccountingPeriodResponse` | object · 25 fields · required: id, mode, generationKind, effectiveStart, effectiveEnd, accountingTimezone |
| `AddPayoutDestinationBody` | object · 4 fields · required: type, bankCode, accountNumber, accountHolderName |
| `AdminAccessTokenResponse` | object · 1 fields · required: accessToken |
| `AdminApprovalLinkedAuditResponse` | object · 3 fields · required: id, outcome, createdAt |
| `AdminApprovalListResponse` | object · 3 fields · required: items, nextCursor, dataAsOf |
| `AdminApprovalPrincipalResponse` | object · 4 fields · required: id, email, name, role |
| `AdminApprovalReauthResponse` | object · 4 fields · required: id, actionClass, verifiedAt, expiresAt |
| `AdminApprovalResponse` | object · 20 fields · required: id, action, resourceType, resourceId, requesterAdminId, approverAdminId |
| `AdminMeResponse` | object · 5 fields · required: id, email, name, role, capabilities |
| `AdminReauthBody` | object · 2 fields · required: actionClass, code |
| `AdminReauthResponse` | object · 3 fields · required: actionClass, verifiedAt, expiresAt |
| `AdminRevokedResponse` | object · 1 fields · required: revoked |
| `AdminWithdrawalBody` | object · 25 fields · required: id, memberId, payoutDestinationId, amountMinor, feeMinor, currency |
| `AdminWithdrawalDetailBody` | object · 2 fields · required: withdrawal, timeline |
| `AdminWithdrawalListBody` | object · 2 fields · required: items, nextCursor |
| `AdminWithdrawalTimelineEntry` | object · 9 fields · required: id, fromState, toState, actorType, actorId, reason |
| `ApiErrorResponse` | object · 4 fields · required: code, message, details, correlationId |
| `ApproveAccountingPeriodBody` | object · 1 fields · required: expectedVersion |
| `AuditActorReferenceResponse` | object · 4 fields · required: id, email, name, role |
| `AuditLinkedApprovalResponse` | object · 7 fields · required: id, action, resourceType, resourceId, requesterAdminId, approverAdminId |
| `AuditLinkedReauthResponse` | object · 4 fields · required: id, actionClass, verifiedAt, expiresAt |
| `AuditRecordListResponse` | object · 3 fields · required: items, nextCursor, dataAsOf |
| `AuditRecordResponse` | object · 17 fields · required: id, actorAdminId, actorRole, sessionId, action, resourceType |
| `BetOrderBody` | object · 25 fields · required: id, memberId, quoteId, drawId, productId, productVersionId |
| `BetOrderCommandBody` | object · 2 fields · required: version |
| `BetOrderLineBody` | object · 8 fields · required: betTypeId, betTypeCode, betTypeVersionId, canonicalNumber, stakeMinor, resolvedPayout |
| `BetReceiptBody` | object · 7 fields · required: id, orderId, memberId, orderVersion, contentDigest, terms |
| `BetReceiptLineBody` | object · 5 fields · required: betTypeCode, betTypeVersionId, canonicalNumber, stakeMinor, resolvedPayout |
| `BetReceiptTermsBody` | object · 9 fields · required: productId, productVersionId, drawReference, drawCutoffAt, currency, totalStakeMinor |
| `BettingQuoteBody` | object · 12 fields · required: id, memberId, drawId, productId, productVersionId, currency |
| `CancelAccountingPeriodBody` | object · 2 fields · required: expectedVersion, reason |
| `CatalogEnabledBetTypeBody` | object · 6 fields · required: betTypeId, betTypeCode, betTypeVersionId, betTypeVersion, betTypeVersionState, betTypeVersionRevision |
| `CatalogVersionBody` | object · 6 fields · required: id, version, revision, state, effectiveFrom, effectiveUntil |
| `ClaimPromotionBody` | object · 1 fields · required: campaignVersionId |
| `CloseAccountingPeriodBody` | object · 6 fields · required: expectedVersion, reason, reconciliationReferences, checkpointReferences, blockingDiscrepancyReferences, acceptedExceptionReferences |
| `CreateBetTypeBody` | object · 1 fields · required: code |
| `CreateBetTypeVersionBody` | object · 12 fields · required: version, canonicalNumberFormat, validationPattern, defaultPayout, minStakeMinor, maxStakeMinor |
| `CreateCustomAccountingPeriodBody` | object · 3 fields · required: startDate, endDate, reason |
| `CreateProductVersionBody` | object · 12 fields · required: version, timezone, scheduleTemplateRef, resultSchemaVersionRef, settlementRuleVersionRef, defaultPayoutPolicyRef |
| `CreateWithdrawalBody` | object · 3 fields · required: payoutDestinationId, amountMinor, currency |
| `DepositBody` | object · 10 fields · required: id, memberId, providerCode, methodCode, amountMinor, currency |
| `DepositInitiateBody` | object · 4 fields · required: providerCode, methodCode, amountMinor, currency |
| `EnabledBetTypeReferenceBody` | object · 2 fields · required: betTypeId, betTypeVersionId |
| `ExpectedVersionBody` | object · 1 fields · required: expectedVersion |
| `GenerateDrawsBody` | object · 1 fields · required: baseOccurrences |
| `MemberBetTypeDetailBody` | object · 3 fields · required: id, code, versions |
| `MemberBetTypePageBody` | object · 2 fields · required: items, nextCursor |
| `MemberBetTypeSummaryBody` | object · 3 fields · required: id, code, versions |
| `MemberBetTypeVersionBody` | object · 14 fields · required: id, version, revision, state, effectiveFrom, effectiveUntil |
| `MemberDeviceViewBody` | object · 4 fields · required: deviceId, name, createdAt, lastUsedAt |
| `MemberDrawBetTypeBody` | object · 11 fields · required: betTypeId, betTypeCode, betTypeVersionId, canonicalNumberFormat, validationPattern, payout |
| `MemberDrawCutoffBody` | object · 1 fields · required: cutoffAt |
| `MemberDrawDetailBody` | object · 24 fields · required: id, productId, productVersionId, occurrenceIdentity, localDate, state |
| `MemberDrawEligibilityBody` | object · 3 fields · required: eligible, cutoffAt, serverNow |
| `MemberDrawPageBody` | object · 2 fields · required: items, nextCursor |
| `MemberMeResponse` | object · 3 fields · required: memberId, phone, status |
| `MemberProductDetailBody` | object · 2 fields · required: id, versions |
| `MemberProductPageBody` | object · 2 fields · required: items, nextCursor |
| `MemberProductSummaryBody` | object · 2 fields · required: id, versions |
| `MemberProductVersionBody` | object · 14 fields · required: id, version, revision, state, effectiveFrom, effectiveUntil |
| `MemberRefreshResponse` | object · 1 fields · required: accessToken |
| `MemberRevokedResponse` | object · 1 fields · required: revoked |
| `MemberSessionResponse` | object · 4 fields · required: accessToken, memberId, accountCreated, deviceId |
| `MemberSessionViewBody` | object · 3 fields · required: sessionId, deviceId, expiresAt |
| `MemberSettlementOutcomeBody` | object · 5 fields · required: orderId, outcome, payoutMinor, batchState, authoritative |
| `NotificationPreferenceBody` | object · 5 fields · required: topic, channel, enabled, version, updatedAt |
| `NotificationPreferencesBody` | object · 2 fields · required: memberId, items |
| `Object` | object · 0 fields |
| `OccurrenceBody` | object · 6 fields · required: occurrenceIdentity, localDate, openAt, cutoffAt, drawAt, provenance |
| `OtpRequestBody` | object · 2 fields · required: purpose, phone |
| `OtpRequestResponse` | object · 3 fields · required: purpose, deliveredTo, retryAfterSeconds |
| `OtpVerifyBody` | object · 4 fields · required: purpose, phone, code |
| `OverrideBody` | object · 5 fields · required: reason, changes, approvalEvidenceRef, auditEvidenceRef |
| `PayoutDestinationBody` | object · 13 fields · required: id, memberId, type, bankCode, accountNumberMasked, accountHolderName |
| `PayoutDestinationListBody` | object · 1 fields · required: items |
| `PromotionDiscoveryBody` | object · 3 fields · required: memberId, asOf, items |
| `PromotionDiscoveryItemBody` | object · 14 fields · required: campaignVersionId, campaignCode, campaignVersion, rewardAmountMinor, currency, turnoverTargetMinor |
| `PromotionEntitlementBody` | object · 19 fields · required: id, memberId, campaignCode, campaignVersionId, campaignVersion, state |
| `PromotionEntitlementPageBody` | object · 2 fields · required: items, nextCursor |
| `QuoteCreateBody` | object · 3 fields · required: betTypeCode, canonicalNumber, stakeMinor |
| `QuoteLineBody` | object · 8 fields · required: betTypeId, betTypeCode, betTypeVersionId, canonicalNumber, stakeMinor, resolvedPayout |
| `ReconciliationDiscrepancyFactsResponse` | object · 5 fields · required: memberId, currency, bucket, metric, amountMinor |
| `ReconciliationDiscrepancyListResponse` | object · 3 fields · required: items, nextCursor, dataAsOf |
| `ReconciliationDiscrepancyResponse` | object · 21 fields · required: id, reconciliationRunId, pair, identityKey, memberId, currency |
| `ReconciliationDiscrepancySourceReferencesResponse` | object · 4 fields · required: pair, checkpointKey, memberId, ledgerAccountId |
| `ReconciliationInspectedCountsResponse` | object · 5 fields · required: ledgerAccounts, ledgerPostings, activeReservationAllocations, walletBuckets, discrepancies |
| `ReconciliationResultSummaryResponse` | object · 3 fields · required: matched, discrepancyCount, bucketCount |
| `ReconciliationRunListResponse` | object · 3 fields · required: items, nextCursor, dataAsOf |
| `ReconciliationRunResponse` | object · 14 fields · required: id, pair, checkpointKey, memberId, currency, asOf |
| `ReconciliationSourceCheckpointResponse` | object · 8 fields · required: checkpointKey, memberId, currency, asOf, latestLedgerPostingId, latestLedgerPostingAt |
| `ReconciliationSourceRangeResponse` | object · 2 fields · required: ledgerPostedAt, reservationLifecycle |
| `ReconciliationTotalsResponse` | object · 3 fields · required: expected, observed, difference |
| `SubmitAccountingPeriodBody` | object · 1 fields · required: expectedVersion |
| `TransitionBody` | object · 2 fields · required: command, expectedVersion |
| `TurnoverEntryBody` | object · 5 fields · required: betReference, entryKind, state, contributionMinor, occurredAt |
| `TurnoverProgressBody` | object · 6 fields · required: provisionalMinor, finalizedMinor, progressMinor, targetMinor, remainingMinor, releaseReached |
| `UpdateNotificationPreferencesBody` | object · 1 fields · required: preferences |
| `WalletBalanceBody` | object · 4 fields · required: memberId, currency, dataAsOf, buckets |
| `WalletBucketBody` | object · 4 fields · required: bucket, postedMinor, reservedMinor, availableMinor |
| `WalletTransactionBody` | object · 7 fields · required: id, businessTransactionId, operationType, correlationId, postedAt, effectiveAt |
| `WalletTransactionPageBody` | object · 2 fields · required: items, nextCursor |
| `WithdrawalBody` | object · 19 fields · required: id, memberId, payoutDestinationId, amountMinor, feeMinor, currency |
| `WithdrawalCommandBody` | object · 1 fields · required: reason |
| `WithdrawalListBody` | object · 2 fields · required: items, nextCursor |