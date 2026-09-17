# Lottify v1 — API Specification (complete)

Generated deterministically from the authoritative OpenAPI contract at `apps/api/openapi/openapi.json`.

**118 paths · 128 operations · 151 schemas**

Source: `apps/api/openapi/openapi.json` · regenerate with `pnpm openapi:generate`.

## Contents

- **Member API**
  - [`/member/auth`](#member-auth)
  - [`/member/bet-types`](#member-bet-types)
  - [`/member/deposits`](#member-deposits)
  - [`/member/devices`](#member-devices)
  - [`/member/draws`](#member-draws)
  - [`/member/notification-preferences`](#member-notification-preferences)
  - [`/member/orders`](#member-orders)
  - [`/member/payout-destinations`](#member-payout-destinations)
  - [`/member/products`](#member-products)
  - [`/member/profile`](#member-profile)
  - [`/member/promotions`](#member-promotions)
  - [`/member/quotes`](#member-quotes)
  - [`/member/readiness`](#member-readiness)
  - [`/member/sessions`](#member-sessions)
  - [`/member/terms`](#member-terms)
  - [`/member/wallet`](#member-wallet)
  - [`/member/withdrawals`](#member-withdrawals)
- **Admin API**
  - [`/admin/accounting-periods`](#admin-accounting-periods)
  - [`/admin/approvals`](#admin-approvals)
  - [`/admin/audit`](#admin-audit)
  - [`/admin/auth`](#admin-auth)
  - [`/admin/draws`](#admin-draws)
  - [`/admin/lottery`](#admin-lottery)
  - [`/admin/member-capability-restrictions`](#admin-member-capability-restrictions)
  - [`/admin/member-terms`](#admin-member-terms)
  - [`/admin/products`](#admin-products)
  - [`/admin/promotions`](#admin-promotions)
  - [`/admin/reconciliation`](#admin-reconciliation)
  - [`/admin/reports`](#admin-reports)
  - [`/admin/settlement`](#admin-settlement)
  - [`/admin/withdrawals`](#admin-withdrawals)
- **Common API** — [root operations](#common-api)
- **Schemas** — [component schemas](#schemas)

---

## Member API

<a id="member-auth"></a>
### `/member/auth`

#### `POST /api/v1/member/auth/login`

*Authenticate a Member with phone + password and establish a session*

- **Request** `application/json`: `MemberLoginBody`

- **Responses:**
  - `200` → `MemberLoginResponse`

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

*Verify an OTP: REGISTER creates the account with the supplied password and authenticates, PASSWORD_ENROLL sets a credential without a session*

- **Request** `application/json`: `OtpVerifyBody`

- **Responses:**
  - `200` → `MemberSessionResponse` | `PasswordEnrollResponse`

#### `POST /api/v1/member/auth/password/reset`

*Reset a forgotten Member password using RECOVERY OTP possession evidence*

- **Request** `application/json`: `PasswordResetBody`

- **Responses:**
  - `200` → `PasswordResetResponse`

#### `POST /api/v1/member/auth/recovery/otp/request`

*Request a RECOVERY OTP possession challenge without establishing authentication*

- **Request** `application/json`: `RecoveryOtpRequestBody`

- **Responses:**
  - `200` → `RecoveryOtpRequestResponse`

#### `POST /api/v1/member/auth/recovery/otp/verify`

*Verify RECOVERY OTP possession evidence without issuing a Member session*

- **Request** `application/json`: `RecoveryOtpVerifyBody`

- **Responses:**
  - `200` → `RecoveryOtpVerificationResponse`

#### `POST /api/v1/member/auth/refresh`

*Rotate the Member refresh credential*

- **Responses:**
  - `200` → `MemberRefreshResponse`

#### `POST /api/v1/member/auth/revoke-all`

*Revoke every active session for the Member*

- **Responses:**
  - `200` → `MemberRevokedResponse`

<a id="member-bet-types"></a>
### `/member/bet-types`

#### `GET /api/v1/member/bet-types`

*List published Lottery Bet Types available to the Member*

| param | in | type | required |
|---|---|---|---|
| `cursor` | query | `string` | no |
| `limit` | query | `number` | no |

- **Responses:**
  - `200` → `MemberBetTypePageBody`

#### `GET /api/v1/member/bet-types/{id}`

*Get a published Lottery Bet Type with its published versions*

- **Responses:**
  - `200` → `MemberBetTypeDetailBody`

<a id="member-deposits"></a>
### `/member/deposits`

#### `POST /api/v1/member/deposits`

| param | in | type | required |
|---|---|---|---|
| `idempotency-key` | header | `string` | yes |

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

#### `GET /api/v1/member/deposits/methods`

*List deposit methods available to the Member*

- **Responses:**
  - `200` → array<`DepositMethodSummaryBody`>

#### `GET /api/v1/member/deposits/methods/{code}`

*Describe one deposit method including fee and payment instructions*

- **Responses:**
  - `200` → `DepositMethodDescriptionBody`

<a id="member-devices"></a>
### `/member/devices`

#### `GET /api/v1/member/devices`

*List the Member's logical devices*

- **Responses:**
  - `200` → array<`MemberDeviceViewBody`>

#### `DELETE /api/v1/member/devices/{id}`

*Revoke all sessions for one of the Member's devices*

- **Responses:**
  - `200` → `MemberRevokedResponse`

<a id="member-draws"></a>
### `/member/draws`

#### `POST /api/v1/member/draws/{drawId}/quotes`

*Create a betting Quote: server-authoritative resolution of bet lines*

| param | in | type | required |
|---|---|---|---|
| `idempotency-key` | header | `string` | yes |

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

<a id="member-notification-preferences"></a>
### `/member/notification-preferences`

#### `GET /api/v1/member/notification-preferences`

*Read the Member's complete notification preference matrix*

- **Responses:**
  - `200` → `NotificationPreferencesBody`

#### `PUT /api/v1/member/notification-preferences`

- **Request** `application/json`: `UpdateNotificationPreferencesBody`

- **Responses:**
  - `200` → `NotificationPreferencesBody`

<a id="member-orders"></a>
### `/member/orders`

#### `GET /api/v1/member/orders`

*List the Member's own Bet Orders (my slips)*

Deterministic keyset pagination over (createdAt DESC, id DESC). Only the requesting Member's Orders are ever returned.

| param | in | type | required |
|---|---|---|---|
| `state` | query | `string` | no |
| `cursor` | query | `string` | no |
| `limit` | query | `number` | no |

- **Responses:**
  - `200` → `BetOrderListBody`

#### `GET /api/v1/member/orders/{id}`

*Read a Member Bet Order by id*

- **Responses:**
  - `200` → `BetOrderBody`

#### `POST /api/v1/member/orders/{id}/cancel`

*Cancel a confirmed Bet Order (explicit command)*

A Member may cancel before the Draw cutoff. The Order becomes CANCELLED only after the refund posting is durable.

| param | in | type | required |
|---|---|---|---|
| `idempotency-key` | header | `string` | yes |

- **Request** `application/json`: `BetOrderCommandBody`

- **Responses:**
  - `200` → `BetOrderBody`

#### `POST /api/v1/member/orders/{id}/confirm`

*Confirm a Bet Order (explicit command)*

Revalidates the Quote and the authoritative Draw cutoff, then requires the durable Wallet & Ledger stake reserve/commit before the Order becomes CONFIRMED. Denials resolve to REJECTED with no money moved.

| param | in | type | required |
|---|---|---|---|
| `idempotency-key` | header | `string` | yes |

- **Request** `application/json`: `BetOrderCommandBody`

- **Responses:**
  - `200` → `BetOrderBody`

#### `GET /api/v1/member/orders/{id}/receipt`

*Read the immutable Bet Receipt of a confirmed Order*

- **Responses:**
  - `200` → `BetReceiptBody`

#### `GET /api/v1/member/orders/{id}/settlement`

*Read the settlement outcome of a Member Bet Order*

The outcome is authoritative only once the settlement batch has COMPLETED; an in-flight or failed batch reports authoritative=false and never exposes a partial financial outcome.

- **Responses:**
  - `200` → `MemberSettlementOutcomeBody`

<a id="member-payout-destinations"></a>
### `/member/payout-destinations`

#### `GET /api/v1/member/payout-destinations`

*List the Member's Payout Destinations*

- **Responses:**
  - `200` → `PayoutDestinationListBody`

#### `POST /api/v1/member/payout-destinations`

*Register a Member-linked Payout Destination pending verification*

- **Request** `application/json`: `AddPayoutDestinationBody`

- **Responses:**
  - `201` → `PayoutDestinationBody`

#### `GET /api/v1/member/payout-destinations/{id}`

*Read one Payout Destination owned by the Member*

- **Responses:**
  - `200` → `PayoutDestinationBody`

#### `POST /api/v1/member/payout-destinations/{id}/verify`

*Request independent verification of the Payout Destination; only normalized evidence crosses the seam*

- **Responses:**
  - `200` → `PayoutDestinationBody`

<a id="member-products"></a>
### `/member/products`

#### `GET /api/v1/member/products`

*List published Lottery Products available to the Member*

Discovery exposes only PUBLISHED configuration; DRAFT/REVIEW work in progress is never visible to a Member.

| param | in | type | required |
|---|---|---|---|
| `cursor` | query | `string` | no |
| `limit` | query | `number` | no |

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
| `state` | query | `string` | no |
| `cursor` | query | `string` | no |
| `limit` | query | `number` | no |

- **Responses:**
  - `200` → `MemberDrawPageBody`

<a id="member-profile"></a>
### `/member/profile`

#### `GET /api/v1/member/profile`

*Read the Member's own profile and which mandatory fields are missing*

- **Responses:**
  - `200` → `MemberProfileBody`

#### `PATCH /api/v1/member/profile`

*Update the Member's own profile fields*

Editable fields are the mandatory profile data only. Server-owned facts (phone, account status, KYC and Terms state) can never be set through the profile.

- **Request** `application/json`: `UpdateMemberProfileBody`

- **Responses:**
  - `200` → `MemberProfileBody`

<a id="member-promotions"></a>
### `/member/promotions`

#### `GET /api/v1/member/promotions`

*Discover published Promotions with the Member's eligibility decision*

- **Responses:**
  - `200` → `PromotionDiscoveryBody`

#### `GET /api/v1/member/promotions/entitlements`

*List the Member's Promotion Entitlements with turnover progress*

| param | in | type | required |
|---|---|---|---|
| `state` | query | `string` | no |
| `cursor` | query | `string` | no |
| `limit` | query | `number` | no |

- **Responses:**
  - `200` → `PromotionEntitlementPageBody`

#### `POST /api/v1/member/promotions/entitlements`

| param | in | type | required |
|---|---|---|---|
| `idempotency-key` | header | `string` | yes |

- **Request** `application/json`: `ClaimPromotionBody`

- **Responses:**
  - `200` → `PromotionEntitlementBody`

#### `GET /api/v1/member/promotions/entitlements/{id}`

*Read one Promotion Entitlement with its turnover trail*

- **Responses:**
  - `200` → `PromotionEntitlementBody`

<a id="member-quotes"></a>
### `/member/quotes`

#### `GET /api/v1/member/quotes/{id}`

*Read a Member betting Quote by id*

- **Responses:**
  - `200` → `BettingQuoteBody`

#### `POST /api/v1/member/quotes/{quoteId}/orders`

*Create a Bet Order from an authorised Quote*

Creates the Order that accepts a Quote. No money moves at creation; only Confirm has a financial effect.

| param | in | type | required |
|---|---|---|---|
| `idempotency-key` | header | `string` | yes |

- **Responses:**
  - `200` → `BetOrderBody`

<a id="member-readiness"></a>
### `/member/readiness`

#### `GET /api/v1/member/readiness`

*Read the Member's capability readiness and KYC state*

Reports, per capability, whether the Member is currently allowed, denied, or requires review, with coded reasons and the outstanding explicit requirements (Terms, profile, KYC). Decisions follow the locked deny-first layer precedence and are point-in-time; an ALLOW is never fabricated and evidence contents are never exposed.

- **Responses:**
  - `200` → `MemberReadinessBody`

<a id="member-sessions"></a>
### `/member/sessions`

#### `GET /api/v1/member/sessions`

*List the Member's active sessions*

- **Responses:**
  - `200` → array<`MemberSessionViewBody`>

#### `DELETE /api/v1/member/sessions/{id}`

*Revoke one of the Member's sessions*

- **Responses:**
  - `200` → `MemberRevokedResponse`

<a id="member-terms"></a>
### `/member/terms`

#### `GET /api/v1/member/terms`

*Read the Member's currently required Terms version(s) and acceptance status*

Reports the Terms version(s) that are published and effective right now, plus this Member's durable acceptances. An acceptance is never assumed.

- **Responses:**
  - `200` → `MemberTermsBody`

#### `POST /api/v1/member/terms/accept`

*Accept the currently required Terms version*

Records immutable acceptance evidence once per Member + Terms version. Idempotent: replaying the same Idempotency-Key returns the prior result, and re-accepting the same version returns the existing evidence instead of duplicating it. A version that is not currently required is denied.

| param | in | type | required |
|---|---|---|---|
| `idempotency-key` | header | `string` | yes |

- **Request** `application/json`: `AcceptTermsRequestBody`

- **Responses:**
  - `200` → `AcceptTermsBody`

<a id="member-wallet"></a>
### `/member/wallet`

#### `GET /api/v1/member/wallet`

*Read the Member's Wallet balances (bounded buckets)*

- **Responses:**
  - `200` → `WalletBalanceBody`

#### `GET /api/v1/member/wallet/transactions`

*List the Member's Ledger-backed transaction history with cursor pagination*

| param | in | type | required |
|---|---|---|---|
| `cursor` | query | `string` | no |
| `limit` | query | `number` | no |

- **Responses:**
  - `200` → `WalletTransactionPageBody`

<a id="member-withdrawals"></a>
### `/member/withdrawals`

#### `GET /api/v1/member/withdrawals`

*List the Member's Withdrawals*

| param | in | type | required |
|---|---|---|---|
| `cursor` | query | `string` | no |
| `limit` | query | `number` | no |

- **Responses:**
  - `200` → `WithdrawalListBody`

#### `POST /api/v1/member/withdrawals`

| param | in | type | required |
|---|---|---|---|
| `Idempotency-Key` | header | `string` | yes |

- **Request** `application/json`: `CreateWithdrawalBody`

- **Responses:**
  - `202` → `WithdrawalBody`

#### `GET /api/v1/member/withdrawals/{id}`

*Read one Withdrawal owned by the Member*

- **Responses:**
  - `200` → `WithdrawalBody`

#### `POST /api/v1/member/withdrawals/{id}/cancel`

*Cancel a Withdrawal before payout; releases the Reservation through Wallet & Ledger*

| param | in | type | required |
|---|---|---|---|
| `Idempotency-Key` | header | `string` | yes |

- **Responses:**
  - `200` → `WithdrawalBody`

#### `POST /api/v1/member/withdrawals/preflight`

*Evaluate withdrawal readiness without creating a Withdrawal or reserving funds*

- **Request** `application/json`: `CreateWithdrawalBody`

- **Responses:**
  - `200` → `WithdrawalPreflightBody`

## Admin API

<a id="admin-accounting-periods"></a>
### `/admin/accounting-periods`

#### `GET /api/v1/admin/accounting-periods`

*List authoritative Accounting Periods*

| param | in | type | required |
|---|---|---|---|
| `effectiveTo` | query | `string (date-time)` | no |
| `effectiveFrom` | query | `string (date-time)` | no |
| `mode` | query | `string` | no |
| `state` | query | `string` | no |
| `cursor` | query | `string` | no |
| `limit` | query | `number` | no |

- **Responses:**
  - `200` → `AccountingPeriodListResponse`
  - `400` → `ApiErrorResponse`
  - `401` → `ApiErrorResponse`
  - `403` → `ApiErrorResponse`

#### `GET /api/v1/admin/accounting-periods/{id}`

*Get one authoritative Accounting Period*

| param | in | type | required |
|---|---|---|---|
| `id` | path | `string` | yes |

- **Responses:**
  - `200` → `AccountingPeriodResponse`
  - `401` → `ApiErrorResponse`
  - `403` → `ApiErrorResponse`
  - `404` → `ApiErrorResponse`

#### `POST /api/v1/admin/accounting-periods/{id}/approve`

*Approve and schedule a pending Custom Accounting Period*

| param | in | type | required |
|---|---|---|---|
| `Idempotency-Key` | header | `string` | yes |
| `id` | path | `string` | yes |

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
| `Idempotency-Key` | header | `string` | yes |
| `id` | path | `string` | yes |

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
| `Idempotency-Key` | header | `string` | yes |
| `id` | path | `string` | yes |

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
| `Idempotency-Key` | header | `string` | yes |
| `id` | path | `string` | yes |

- **Request** `application/json`: `SubmitAccountingPeriodBody`

- **Responses:**
  - `200` → `AccountingPeriodCommandResponse`
  - `400` → `ApiErrorResponse`
  - `401` → `ApiErrorResponse`
  - `403` → `ApiErrorResponse`
  - `404` → `ApiErrorResponse`
  - `409` → `ApiErrorResponse`

#### `POST /api/v1/admin/accounting-periods/create-custom`

*Create a governed Custom Accounting Period DRAFT and replacement preview*

| param | in | type | required |
|---|---|---|---|
| `Idempotency-Key` | header | `string` | yes |

- **Request** `application/json`: `CreateCustomAccountingPeriodBody`

- **Responses:**
  - `201` → `AccountingPeriodCommandResponse`
  - `400` → `ApiErrorResponse`
  - `401` → `ApiErrorResponse`
  - `403` → `ApiErrorResponse`
  - `409` → `ApiErrorResponse`

<a id="admin-approvals"></a>
### `/admin/approvals`

#### `GET /api/v1/admin/approvals`

*List the immutable Admin approval work queue with requester/target/state/age and evidence*

| param | in | type | required |
|---|---|---|---|
| `cursor` | query | `string` | no |
| `limit` | query | `number` | no |
| `to` | query | `string` | no |
| `from` | query | `string` | no |
| `resourceId` | query | `string` | no |
| `resourceType` | query | `string` | no |
| `action` | query | `string` | no |
| `state` | query | `string` | no |

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

<a id="admin-audit"></a>
### `/admin/audit`

#### `GET /api/v1/admin/audit/records`

*List immutable audit records with actor/action/resource/outcome and evidence references*

| param | in | type | required |
|---|---|---|---|
| `cursor` | query | `string` | no |
| `limit` | query | `number` | no |
| `to` | query | `string` | no |
| `from` | query | `string` | no |
| `outcome` | query | `string` | no |
| `resourceId` | query | `string` | no |
| `resourceType` | query | `string` | no |
| `action` | query | `string` | no |
| `actor` | query | `string` | no |

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

<a id="admin-auth"></a>
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

<a id="admin-draws"></a>
### `/admin/draws`

#### `GET /api/v1/admin/draws`

*List Lottery Draws*

| param | in | type | required |
|---|---|---|---|
| `state` | query | `string` | no |
| `productId` | query | `string` | no |
| `cursor` | query | `string` | no |
| `limit` | query | `number` | no |

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

#### `GET /api/v1/admin/draws/{drawId}/settlement`

*Read the Settlement Batch for a Draw*

- **Responses:**
  - `200`

#### `POST /api/v1/admin/draws/{drawId}/settlement`

*Run (or resume) the durable Settlement Batch for a Draw*

- **Responses:**
  - `201`

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

<a id="admin-lottery"></a>
### `/admin/lottery`

#### `POST /api/v1/admin/lottery/bet-type-versions/{id}/approve`

*Approve and publish a Lottery Bet Type version*

| param | in | type | required |
|---|---|---|---|
| `Idempotency-Key` | header | `string` | yes |

- **Request** `application/json`: `ExpectedVersionBody`

- **Responses:**
  - `201`

#### `POST /api/v1/admin/lottery/bet-type-versions/{id}/submit`

*Submit a Lottery Bet Type version for approval*

| param | in | type | required |
|---|---|---|---|
| `Idempotency-Key` | header | `string` | yes |

- **Request** `application/json`: `ExpectedVersionBody`

- **Responses:**
  - `201`

#### `GET /api/v1/admin/lottery/bet-types`

*List Lottery Bet Types and configuration version summaries*

| param | in | type | required |
|---|---|---|---|
| `state` | query | `string` | no |
| `cursor` | query | `string` | no |
| `limit` | query | `number` | no |

- **Responses:**
  - `200`

#### `POST /api/v1/admin/lottery/bet-types`

*Create a Lottery Bet Type identity*

| param | in | type | required |
|---|---|---|---|
| `Idempotency-Key` | header | `string` | yes |

- **Request** `application/json`: `CreateBetTypeBody`

- **Responses:**
  - `201`

#### `GET /api/v1/admin/lottery/bet-types/{id}`

*Get a Lottery Bet Type and its configuration versions*

| param | in | type | required |
|---|---|---|---|
| `state` | query | `string` | no |

- **Responses:**
  - `200`

#### `POST /api/v1/admin/lottery/bet-types/{id}/versions`

*Create a Lottery Bet Type DRAFT version*

| param | in | type | required |
|---|---|---|---|
| `Idempotency-Key` | header | `string` | yes |

- **Request** `application/json`: `CreateBetTypeVersionBody`

- **Responses:**
  - `201`

#### `POST /api/v1/admin/lottery/product-versions/{id}/approve`

*Approve and publish a Lottery Product version*

| param | in | type | required |
|---|---|---|---|
| `Idempotency-Key` | header | `string` | yes |

- **Request** `application/json`: `ExpectedVersionBody`

- **Responses:**
  - `201`

#### `POST /api/v1/admin/lottery/product-versions/{id}/submit`

*Submit a Lottery Product version for approval*

| param | in | type | required |
|---|---|---|---|
| `Idempotency-Key` | header | `string` | yes |

- **Request** `application/json`: `ExpectedVersionBody`

- **Responses:**
  - `201`

#### `GET /api/v1/admin/lottery/products`

*List Lottery Products and configuration version summaries*

| param | in | type | required |
|---|---|---|---|
| `state` | query | `string` | no |
| `cursor` | query | `string` | no |
| `limit` | query | `number` | no |

- **Responses:**
  - `200`

#### `POST /api/v1/admin/lottery/products`

*Create a Lottery Product identity*

| param | in | type | required |
|---|---|---|---|
| `Idempotency-Key` | header | `string` | yes |

- **Responses:**
  - `201`

#### `GET /api/v1/admin/lottery/products/{id}`

*Get a Lottery Product and its configuration versions*

| param | in | type | required |
|---|---|---|---|
| `state` | query | `string` | no |

- **Responses:**
  - `200`

#### `POST /api/v1/admin/lottery/products/{id}/versions`

*Create a Lottery Product DRAFT version*

| param | in | type | required |
|---|---|---|---|
| `Idempotency-Key` | header | `string` | yes |

- **Request** `application/json`: `CreateProductVersionBody`

- **Responses:**
  - `201`

<a id="admin-member-capability-restrictions"></a>
### `/admin/member-capability-restrictions`

#### `POST /api/v1/admin/member-capability-restrictions`

*Apply an independent per-capability restriction to a Member*

Sets one independent control (BET_BLOCKED etc.) with source, reason, effective period and an actor-or-policy reference. Governed by the member-readiness.manage capability and audited; never replaces the Member's account status.

| param | in | type | required |
|---|---|---|---|
| `idempotency-key` | header | `string` | yes |

- **Request** `application/json`: `SetRestrictionBody`

- **Responses:**
  - `201` → `CapabilityRestrictionBody`

#### `DELETE /api/v1/admin/member-capability-restrictions/{id}`

*Remove a capability restriction an Admin set*

Clears a normal Admin-set restriction and audits the removal. A self-exclusion restriction cannot be removed through this normal Admin path.

| param | in | type | required |
|---|---|---|---|
| `idempotency-key` | header | `string` | yes |

- **Responses:**
  - `200` → `ClearRestrictionBody`

<a id="admin-member-terms"></a>
### `/admin/member-terms`

#### `GET /api/v1/admin/member-terms`

*List Member Terms versions*

| param | in | type | required |
|---|---|---|---|
| `state` | query | `string` | no |
| `cursor` | query | `string` | no |
| `limit` | query | `number` | no |

- **Responses:**
  - `200` → `TermsVersionListBody`

#### `POST /api/v1/admin/member-terms`

*Author a DRAFT Member Terms version*

| param | in | type | required |
|---|---|---|---|
| `idempotency-key` | header | `string` | yes |

- **Request** `application/json`: `CreateTermsVersionBody`

- **Responses:**
  - `201` → `TermsVersionBody`

#### `GET /api/v1/admin/member-terms/{id}`

*Read a Member Terms version*

- **Responses:**
  - `200` → `TermsVersionBody`

#### `POST /api/v1/admin/member-terms/{id}/publish`

*Approve and publish a Member Terms version (fresh MFA required)*

Maker-checker: the publishing Admin must differ from the author. A published version becomes the required Terms for every Member inside its effective window and can never be rewritten.

| param | in | type | required |
|---|---|---|---|
| `idempotency-key` | header | `string` | yes |

- **Request** `application/json`: `ExpectedRevisionBody`

- **Responses:**
  - `200` → `TermsVersionBody`

#### `POST /api/v1/admin/member-terms/{id}/retire`

*Retire a published Member Terms version*

| param | in | type | required |
|---|---|---|---|
| `idempotency-key` | header | `string` | yes |

- **Request** `application/json`: `ExpectedRevisionBody`

- **Responses:**
  - `200` → `TermsVersionBody`

<a id="admin-products"></a>
### `/admin/products`

#### `POST /api/v1/admin/products/{productId}/draws/generate`

*Idempotent rolling Draw generation from schedule occurrences*

| param | in | type | required |
|---|---|---|---|
| `Idempotency-Key` | header | `string` | yes |

- **Request** `application/json`: `GenerateDrawsBody`

- **Responses:**
  - `201`

<a id="admin-promotions"></a>
### `/admin/promotions`

#### `GET /api/v1/admin/promotions`

*List Promotion Campaign versions*

| param | in | type | required |
|---|---|---|---|
| `state` | query | `string` | no |
| `cursor` | query | `string` | no |
| `limit` | query | `number` | no |

- **Responses:**
  - `200`

#### `POST /api/v1/admin/promotions`

*Create a DRAFT Promotion Campaign version*

| param | in | type | required |
|---|---|---|---|
| `idempotency-key` | header | `string` | yes |

- **Responses:**
  - `201`

#### `GET /api/v1/admin/promotions/{id}`

*Read a Promotion Campaign version*

- **Responses:**
  - `200`

#### `POST /api/v1/admin/promotions/{id}/approve`

*Approve and publish a validated Promotion Campaign version (fresh MFA required)*

| param | in | type | required |
|---|---|---|---|
| `idempotency-key` | header | `string` | yes |

- **Responses:**
  - `200`

#### `POST /api/v1/admin/promotions/{id}/preview`

*Preview the eligibility decision for one Member*

- **Responses:**
  - `200`

#### `POST /api/v1/admin/promotions/{id}/retire`

*Retire a published Promotion Campaign version*

| param | in | type | required |
|---|---|---|---|
| `idempotency-key` | header | `string` | yes |

- **Responses:**
  - `200`

#### `POST /api/v1/admin/promotions/{id}/validate`

*Validate a DRAFT Promotion Campaign version*

| param | in | type | required |
|---|---|---|---|
| `idempotency-key` | header | `string` | yes |

- **Responses:**
  - `200`

<a id="admin-reconciliation"></a>
### `/admin/reconciliation`

#### `GET /api/v1/admin/reconciliation/discrepancies`

*List durable reconciliation discrepancies with their lifecycle state*

| param | in | type | required |
|---|---|---|---|
| `cursor` | query | `string` | no |
| `limit` | query | `number` | no |
| `to` | query | `string` | no |
| `from` | query | `string` | no |
| `severity` | query | `string` | no |
| `status` | query | `string` | no |
| `currency` | query | `string` | no |
| `memberId` | query | `string` | no |
| `runId` | query | `string` | no |

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
| `cursor` | query | `string` | no |
| `limit` | query | `number` | no |
| `to` | query | `string` | no |
| `from` | query | `string` | no |
| `result` | query | `string` | no |
| `currency` | query | `string` | no |
| `memberId` | query | `string` | no |

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

<a id="admin-reports"></a>
### `/admin/reports`

#### `GET /api/v1/admin/reports/accounting-period-financial`

*Accounting-period financial report for a declared half-open window with freshness state*

| param | in | type | required |
|---|---|---|---|
| `timezone` | query | `string` | no |
| `to` | query | `string` | no |
| `from` | query | `string` | no |
| `accountingPeriodId` | query | `string` | no |

- **Responses:**
  - `200` → `AccountingPeriodFinancialReportResponse`
  - `400` — VALIDATION_ERROR / UNSUPPORTED_REPORTING_TIME_ZONE
  - `401` — AUTHENTICATION_REQUIRED
  - `403` — ACCESS_DENIED
  - `404` — NOT_FOUND

<a id="admin-settlement"></a>
### `/admin/settlement`

#### `GET /api/v1/admin/settlement/{batchId}/orders`

*List the per-Order settlement checkpoints of a batch*

- **Responses:**
  - `200`

<a id="admin-withdrawals"></a>
### `/admin/withdrawals`

#### `GET /api/v1/admin/withdrawals`

*List the withdrawal review, approval, payout and reconciliation queues with severity and evidence*

| param | in | type | required |
|---|---|---|---|
| `cursor` | query | `string` | no |
| `limit` | query | `number` | no |
| `state` | query | `string` | no |
| `queue` | query | `string` | no |

- **Responses:**
  - `200` → `AdminWithdrawalListBody`

#### `GET /api/v1/admin/withdrawals/{id}`

*Withdrawal detail with eligibility evidence and the workflow timeline*

| param | in | type | required |
|---|---|---|---|
| `id` | path | `string` | yes |

- **Responses:**
  - `200` → `AdminWithdrawalDetailBody`
  - `404` → `ApiErrorResponse`

#### `POST /api/v1/admin/withdrawals/{id}/approve`

*Approve the withdrawal review and release it for payout*

| param | in | type | required |
|---|---|---|---|
| `Idempotency-Key` | header | `string` | yes |

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

| param | in | type | required |
|---|---|---|---|
| `Idempotency-Key` | header | `string` | yes |

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

| param | in | type | required |
|---|---|---|---|
| `Idempotency-Key` | header | `string` | yes |

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

| param | in | type | required |
|---|---|---|---|
| `Idempotency-Key` | header | `string` | yes |

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

| param | in | type | required |
|---|---|---|---|
| `Idempotency-Key` | header | `string` | yes |

- **Request** `application/json`: `WithdrawalCommandBody`

- **Responses:**
  - `200` → `AdminWithdrawalBody`
  - `400` → `ApiErrorResponse`
  - `401` → `ApiErrorResponse`
  - `403` → `ApiErrorResponse`
  - `404` → `ApiErrorResponse`
  - `409` → `ApiErrorResponse`

## Common API

#### `GET /api/v1`

*Lottify v1 API contract root*

- **Responses:**
  - `200`

## Schemas

### `AcceptTermsBody`

| property | type | required |
|---|---|---|
| `acceptanceId` | `string` | yes |
| `memberId` | `string` | yes |
| `documentId` | `string` | yes |
| `documentCode` | `string` | yes |
| `documentVersion` | `number` | yes |
| `contentDigest` | `string` | yes |
| `source` | `string` | yes |
| `acceptedAt` | `string (date-time)` | yes |
| `alreadyAccepted` | `boolean` | yes |

### `AcceptTermsRequestBody`

| property | type | required |
|---|---|---|
| `documentId` | `string (uuid)` | yes |

### `AccountingPeriodAcceptedExceptionReferenceBody`

| property | type | required |
|---|---|---|
| `discrepancyReference` | `string` | yes |
| `exceptionReference` | `string` | yes |

### `AccountingPeriodAcceptedExceptionReferenceResponse`

| property | type | required |
|---|---|---|
| `discrepancyReference` | `string` | yes |
| `exceptionReference` | `string` | yes |

### `AccountingPeriodCancellationResponse`

| property | type | required |
|---|---|---|
| `period` | `AccountingPeriodResponse` | yes |

### `AccountingPeriodCloseEvidenceResponse`

| property | type | required |
|---|---|---|
| `closedAt` | `string (date-time)` | yes |
| `approvalId` | `string` | yes |
| `reconciliationReferences` | array<`string`> | yes |
| `checkpointReferences` | array<`string`> | yes |
| `blockingDiscrepancyReferences` | array<`string`> | yes |
| `acceptedExceptionReferences` | array<`AccountingPeriodAcceptedExceptionReferenceResponse`> | yes |
| `actorAdminId` | `string` | yes |
| `auditRecordId` | `string` | yes |

### `AccountingPeriodCloseResponse`

| property | type | required |
|---|---|---|
| `period` | `AccountingPeriodResponse` | yes |

### `AccountingPeriodCommandResponse`

| property | type | required |
|---|---|---|
| `period` | `AccountingPeriodResponse` | yes |
| `replacementPreview` | `AccountingPeriodReplacementPreviewResponse` | yes |

### `AccountingPeriodCorrectionLineageResponse`

| property | type | required |
|---|---|---|
| `transactionId` | `string (uuid)` | yes |
| `correctionKind` | `string` | yes |
| `accountingPeriodId` | `string (uuid)` | yes |
| `correctsTransactionId` | `string (uuid)` | yes |
| `originalAccountingPeriodId` | `string (uuid)` | yes |

### `AccountingPeriodFinancialReportResponse`

| property | type | required |
|---|---|---|
| `generatedAt` | `string (date-time)` | yes |
| `dataAsOf` | `string (date-time)` | yes |
| `projectionLagMs` | `number` | yes |
| `completeness` | `string` | yes |
| `reportingTimezone` | `string` | yes |
| `range` | `AccountingPeriodReportRangeResponse` | yes |
| `coverage` | `AccountingPeriodReportCoverageResponse` | yes |
| `periods` | array<`AccountingPeriodReportGroupResponse`> | yes |
| `corrections` | array<`AccountingPeriodCorrectionLineageResponse`> | yes |

### `AccountingPeriodListResponse`

| property | type | required |
|---|---|---|
| `items` | array<`AccountingPeriodResponse`> | yes |
| `nextCursor` | `string` | yes |

### `AccountingPeriodPreviewPeriodResponse`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `effectiveStart` | `string (date-time)` | yes |
| `effectiveEnd` | `string (date-time)` | yes |
| `generationKind` | `string` | yes |

### `AccountingPeriodReplacementPreviewResponse`

| property | type | required |
|---|---|---|
| `affectedAutomaticPeriods` | array<`AccountingPeriodPreviewPeriodResponse`> | yes |
| `residualFragments` | array<`AccountingPeriodResidualFragmentResponse`> | yes |

### `AccountingPeriodReportCoverageGapResponse`

| property | type | required |
|---|---|---|
| `from` | `string (date-time)` | yes |
| `to` | `string (date-time)` | yes |

### `AccountingPeriodReportCoverageResponse`

| property | type | required |
|---|---|---|
| `authoritativePeriodCount` | `number` | yes |
| `uncoveredRanges` | array<`AccountingPeriodReportCoverageGapResponse`> | yes |
| `unobservedRange` | `AccountingPeriodReportCoverageGapResponse` | yes |

### `AccountingPeriodReportGroupResponse`

| property | type | required |
|---|---|---|
| `accountingPeriodId` | `string (uuid)` | yes |
| `mode` | `string` | yes |
| `generationKind` | `string` | yes |
| `effectiveStart` | `string (date-time)` | yes |
| `effectiveEnd` | `string (date-time)` | yes |
| `state` | `string` | yes |
| `transactionCount` | `number` | yes |
| `debitAmountMinor` | `string` | yes |
| `creditAmountMinor` | `string` | yes |

### `AccountingPeriodReportRangeResponse`

| property | type | required |
|---|---|---|
| `from` | `string (date-time)` | yes |
| `to` | `string (date-time)` | yes |
| `boundary` | `string` | yes |
| `source` | `string` | yes |
| `accountingPeriodId` | `string (uuid)` | yes |

### `AccountingPeriodResidualFragmentResponse`

| property | type | required |
|---|---|---|
| `sourcePeriodId` | `string` | yes |
| `effectiveStart` | `string (date-time)` | yes |
| `effectiveEnd` | `string (date-time)` | yes |
| `generationKind` | `string` | yes |

### `AccountingPeriodResponse`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `mode` | `string` | yes |
| `generationKind` | `string` | yes |
| `effectiveStart` | `string (date-time)` | yes |
| `effectiveEnd` | `string (date-time)` | yes |
| `accountingTimezone` | `string` | yes |
| `state` | `string` | yes |
| `version` | `number` | yes |
| `reason` | `string` | yes |
| `createdByAdminId` | `string` | yes |
| `activationApprovalId` | `string` | yes |
| `cancellationRequestedByAdminId` | `string` | yes |
| `cancellationReason` | `string` | yes |
| `cancellationRequestedAt` | `string (date-time)` | yes |
| `closeRequestedByAdminId` | `string` | yes |
| `closeReason` | `string` | yes |
| `closeRequestedAt` | `string (date-time)` | yes |
| `closeReconciliationReferences` | array<`string`> | yes |
| `closeCheckpointReferences` | array<`string`> | yes |
| `closeBlockingDiscrepancyReferences` | array<`string`> | yes |
| `closeAcceptedExceptionReferences` | array<`object`> | yes |
| `closeEvidence` | `AccountingPeriodCloseEvidenceResponse` | yes |
| `createdAt` | `string (date-time)` | yes |
| `updatedAt` | `string (date-time)` | yes |
| `allowedActions` | array<`string`> | yes |

### `AddPayoutDestinationBody`

| property | type | required |
|---|---|---|
| `type` | `string` | yes |
| `bankCode` | `string` | yes |
| `accountNumber` | `string` | yes |
| `accountHolderName` | `string` | yes |

### `AdminAccessTokenResponse`

| property | type | required |
|---|---|---|
| `accessToken` | `string` | yes |

### `AdminApprovalLinkedAuditResponse`

| property | type | required |
|---|---|---|
| `id` | `string (uuid)` | yes |
| `outcome` | `string` | yes |
| `createdAt` | `string (date-time)` | yes |

### `AdminApprovalListResponse`

| property | type | required |
|---|---|---|
| `items` | array<`AdminApprovalResponse`> | yes |
| `nextCursor` | `string` | yes |
| `dataAsOf` | `string (date-time)` | yes |

### `AdminApprovalPrincipalResponse`

| property | type | required |
|---|---|---|
| `id` | `string (uuid)` | yes |
| `email` | `string (email)` | yes |
| `name` | `string` | yes |
| `role` | `string` | yes |

### `AdminApprovalReauthResponse`

| property | type | required |
|---|---|---|
| `id` | `string (uuid)` | yes |
| `actionClass` | `string` | yes |
| `verifiedAt` | `string (date-time)` | yes |
| `expiresAt` | `string (date-time)` | yes |

### `AdminApprovalResponse`

| property | type | required |
|---|---|---|
| `id` | `string (uuid)` | yes |
| `action` | `string` | yes |
| `resourceType` | `string` | yes |
| `resourceId` | `string (uuid)` | yes |
| `requesterAdminId` | `string (uuid)` | yes |
| `approverAdminId` | `string (uuid)` | yes |
| `requestedVersion` | `number` | yes |
| `payloadHash` | `string` | yes |
| `reason` | `string` | yes |
| `policyVersion` | `string` | yes |
| `reauthEvidenceId` | `string (uuid)` | yes |
| `correlationId` | `string` | yes |
| `approvedAt` | `string (date-time)` | yes |
| `createdAt` | `string (date-time)` | yes |
| `state` | `string` | yes |
| `ageMs` | `number` | yes |
| `requester` | `AdminApprovalPrincipalResponse` | yes |
| `approver` | `AdminApprovalPrincipalResponse` | yes |
| `reauthEvidence` | `AdminApprovalReauthResponse` | yes |
| `auditRecords` | array<`AdminApprovalLinkedAuditResponse`> | yes |

### `AdminMeResponse`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `email` | `string (email)` | yes |
| `name` | `string` | yes |
| `role` | `string` | yes |
| `capabilities` | array<`string`> | yes |

### `AdminReauthBody`

| property | type | required |
|---|---|---|
| `actionClass` | `string` | yes |
| `code` | `string` | yes |

### `AdminReauthResponse`

| property | type | required |
|---|---|---|
| `actionClass` | `string` | yes |
| `verifiedAt` | `string (date-time)` | yes |
| `expiresAt` | `string (date-time)` | yes |

### `AdminRevokedResponse`

| property | type | required |
|---|---|---|
| `revoked` | `boolean` | yes |

### `AdminWithdrawalBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `memberId` | `string` | yes |
| `payoutDestinationId` | `string` | yes |
| `amountMinor` | `string` | yes |
| `feeMinor` | `string` | yes |
| `currency` | `string` | yes |
| `state` | `string` | yes |
| `version` | `number` | yes |
| `eligibilityOutcome` | `string` | yes |
| `eligibilityReasonCodes` | array<`string`> | yes |
| `eligibilityEvidenceRefs` | array<`string`> | yes |
| `requiresApproval` | `boolean` | yes |
| `severity` | `string` | yes |
| `queue` | `string` | yes |
| `allowedActions` | `object` | yes |
| `reconciliationAttempts` | `number` | yes |
| `providerTransactionId` | `string` | yes |
| `payoutEvidenceRef` | `string` | yes |
| `ledgerTransactionId` | `string` | yes |
| `decidedByAdminId` | `string` | yes |
| `decisionReason` | `string` | yes |
| `failureReason` | `string` | yes |
| `incomingProviderError` | `string` | yes |
| `createdAt` | `string (date-time)` | yes |
| `updatedAt` | `string (date-time)` | yes |

### `AdminWithdrawalDetailBody`

| property | type | required |
|---|---|---|
| `withdrawal` | `AdminWithdrawalBody` | yes |
| `timeline` | array<`AdminWithdrawalTimelineEntry`> | yes |

### `AdminWithdrawalListBody`

| property | type | required |
|---|---|---|
| `items` | array<`AdminWithdrawalBody`> | yes |
| `nextCursor` | `string` | yes |

### `AdminWithdrawalTimelineEntry`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `fromState` | `string` | yes |
| `toState` | `string` | yes |
| `actorType` | `string` | yes |
| `actorId` | `string` | yes |
| `reason` | `string` | yes |
| `evidenceRef` | `string` | yes |
| `correlationId` | `string` | yes |
| `createdAt` | `string (date-time)` | yes |

### `ApiErrorResponse`

| property | type | required |
|---|---|---|
| `code` | `string` | yes |
| `message` | `string` | yes |
| `details` | `object` | yes |
| `correlationId` | `string` | yes |

### `ApproveAccountingPeriodBody`

| property | type | required |
|---|---|---|
| `expectedVersion` | `number` | yes |

### `AuditActorReferenceResponse`

| property | type | required |
|---|---|---|
| `id` | `string (uuid)` | yes |
| `email` | `string (email)` | yes |
| `name` | `string` | yes |
| `role` | `string` | yes |

### `AuditLinkedApprovalResponse`

| property | type | required |
|---|---|---|
| `id` | `string (uuid)` | yes |
| `action` | `string` | yes |
| `resourceType` | `string` | yes |
| `resourceId` | `string (uuid)` | yes |
| `requesterAdminId` | `string (uuid)` | yes |
| `approverAdminId` | `string (uuid)` | yes |
| `approvedAt` | `string (date-time)` | yes |

### `AuditLinkedReauthResponse`

| property | type | required |
|---|---|---|
| `id` | `string (uuid)` | yes |
| `actionClass` | `string` | yes |
| `verifiedAt` | `string (date-time)` | yes |
| `expiresAt` | `string (date-time)` | yes |

### `AuditRecordListResponse`

| property | type | required |
|---|---|---|
| `items` | array<`AuditRecordResponse`> | yes |
| `nextCursor` | `string` | yes |
| `dataAsOf` | `string (date-time)` | yes |

### `AuditRecordResponse`

| property | type | required |
|---|---|---|
| `id` | `string (uuid)` | yes |
| `actorAdminId` | `string (uuid)` | yes |
| `actorRole` | `string` | yes |
| `sessionId` | `string (uuid)` | yes |
| `action` | `string` | yes |
| `resourceType` | `string` | yes |
| `resourceId` | `string (uuid)` | yes |
| `payloadHash` | `string` | yes |
| `reason` | `string` | yes |
| `reauthEvidenceId` | `string (uuid)` | yes |
| `approvalId` | `string (uuid)` | yes |
| `correlationId` | `string` | yes |
| `outcome` | `string` | yes |
| `createdAt` | `string (date-time)` | yes |
| `actor` | `AuditActorReferenceResponse` | yes |
| `reauthEvidence` | `AuditLinkedReauthResponse` | yes |
| `approval` | `AuditLinkedApprovalResponse` | yes |

### `BetOrderBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `memberId` | `string` | yes |
| `quoteId` | `string` | yes |
| `drawId` | `string` | yes |
| `productId` | `string` | yes |
| `productVersionId` | `string` | yes |
| `currency` | `string` | yes |
| `state` | `string` | yes |
| `version` | `number` | yes |
| `allowedActions` | array<`string`> | yes |
| `totalStakeMinor` | `string` | yes |
| `cutoffAt` | `string (date-time)` | yes |
| `quoteExpiresAt` | `string (date-time)` | yes |
| `reservationId` | `string` | yes |
| `stakeTransactionId` | `string` | yes |
| `refundTransactionId` | `string` | yes |
| `rejectionReason` | `string` | yes |
| `cancellationReason` | `string` | yes |
| `confirmedAt` | `string (date-time)` | yes |
| `cancelledAt` | `string (date-time)` | yes |
| `rejectedAt` | `string (date-time)` | yes |
| `receiptId` | `string` | yes |
| `lines` | array<`BetOrderLineBody`> | yes |
| `createdAt` | `string (date-time)` | yes |
| `updatedAt` | `string (date-time)` | yes |

### `BetOrderCommandBody`

| property | type | required |
|---|---|---|
| `version` | `number` | yes |
| `reason` | `string` | no |

### `BetOrderLineBody`

| property | type | required |
|---|---|---|
| `betTypeId` | `string` | yes |
| `betTypeCode` | `string` | yes |
| `betTypeVersionId` | `string` | yes |
| `canonicalNumber` | `string` | yes |
| `stakeMinor` | `string` | yes |
| `resolvedPayout` | `object` | yes |
| `payoutSource` | `string` | yes |
| `restrictions` | array<`string`> | yes |

### `BetOrderListBody`

| property | type | required |
|---|---|---|
| `items` | array<`BetOrderBody`> | yes |
| `nextCursor` | `string` | yes |

### `BetReceiptBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `orderId` | `string` | yes |
| `memberId` | `string` | yes |
| `orderVersion` | `number` | yes |
| `contentDigest` | `string` | yes |
| `terms` | `BetReceiptTermsBody` | yes |
| `issuedAt` | `string (date-time)` | yes |

### `BetReceiptLineBody`

| property | type | required |
|---|---|---|
| `betTypeCode` | `string` | yes |
| `betTypeVersionId` | `string` | yes |
| `canonicalNumber` | `string` | yes |
| `stakeMinor` | `string` | yes |
| `resolvedPayout` | `object` | yes |

### `BetReceiptTermsBody`

| property | type | required |
|---|---|---|
| `productId` | `string` | yes |
| `productVersionId` | `string` | yes |
| `drawReference` | `string` | yes |
| `drawCutoffAt` | `string (date-time)` | yes |
| `currency` | `string` | yes |
| `totalStakeMinor` | `string` | yes |
| `acceptedAt` | `string (date-time)` | yes |
| `lines` | array<`BetReceiptLineBody`> | yes |
| `acceptedRestrictions` | array<`string`> | yes |

### `BettingQuoteBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `memberId` | `string` | yes |
| `drawId` | `string` | yes |
| `productId` | `string` | yes |
| `productVersionId` | `string` | yes |
| `currency` | `string` | yes |
| `totalStakeMinor` | `string` | yes |
| `status` | `string` | yes |
| `cutoffAt` | `string (date-time)` | yes |
| `serverNow` | `string (date-time)` | yes |
| `expiresAt` | `string (date-time)` | yes |
| `lines` | array<`QuoteLineBody`> | yes |

### `CancelAccountingPeriodBody`

| property | type | required |
|---|---|---|
| `expectedVersion` | `number` | yes |
| `reason` | `string` | yes |

### `CapabilityReadinessBody`

| property | type | required |
|---|---|---|
| `capability` | `string` | yes |
| `outcome` | `string` | yes |
| `reasonCodes` | array<`string`> | yes |
| `evaluatedAt` | `string (date-time)` | yes |
| `validUntil` | `string (date-time)` | yes |

### `CapabilityRestrictionBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `memberId` | `string` | yes |
| `type` | `string` | yes |
| `source` | `string` | yes |
| `reason` | `string` | yes |
| `effectiveFrom` | `string (date-time)` | yes |
| `effectiveUntil` | `string (date-time)` | yes |
| `actorOrPolicyRef` | `string` | yes |
| `createdAt` | `string (date-time)` | yes |

### `CatalogEnabledBetTypeBody`

| property | type | required |
|---|---|---|
| `betTypeId` | `string` | yes |
| `betTypeCode` | `string` | yes |
| `betTypeVersionId` | `string` | yes |
| `betTypeVersion` | `number` | yes |
| `betTypeVersionState` | `string` | yes |
| `betTypeVersionRevision` | `number` | yes |

### `CatalogVersionBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `version` | `number` | yes |
| `revision` | `number` | yes |
| `state` | `string` | yes |
| `effectiveFrom` | `string (date-time)` | yes |
| `effectiveUntil` | `string (date-time)` | yes |

### `ClaimPromotionBody`

| property | type | required |
|---|---|---|
| `campaignVersionId` | `string (uuid)` | yes |

### `ClearRestrictionBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `memberId` | `string` | yes |
| `removed` | `boolean` | yes |

### `CloseAccountingPeriodBody`

| property | type | required |
|---|---|---|
| `expectedVersion` | `number` | yes |
| `reason` | `string` | yes |
| `reconciliationReferences` | array<`string`> | yes |
| `checkpointReferences` | array<`string`> | yes |
| `blockingDiscrepancyReferences` | array<`string`> | yes |
| `acceptedExceptionReferences` | array<`AccountingPeriodAcceptedExceptionReferenceBody`> | yes |

### `CreateBetTypeBody`

| property | type | required |
|---|---|---|
| `code` | `string` | yes |

### `CreateBetTypeVersionBody`

| property | type | required |
|---|---|---|
| `version` | `number` | yes |
| `canonicalNumberFormat` | `string` | yes |
| `validationPattern` | `string` | yes |
| `defaultPayout` | `object` | yes |
| `minStakeMinor` | `string` | yes |
| `maxStakeMinor` | `string` | yes |
| `limitPolicyRef` | `string` | yes |
| `restrictionPolicyRef` | `string` | yes |
| `settlementRuleVersionRef` | `string` | yes |
| `effectiveFrom` | `string` | yes |
| `effectiveUntil` | `string` | no |
| `reason` | `string` | no |

### `CreateCustomAccountingPeriodBody`

| property | type | required |
|---|---|---|
| `startDate` | `string (date)` | yes |
| `endDate` | `string (date)` | yes |
| `reason` | `string` | yes |

### `CreateProductVersionBody`

| property | type | required |
|---|---|---|
| `version` | `number` | yes |
| `timezone` | `string` | yes |
| `scheduleTemplateRef` | `string` | yes |
| `resultSchemaVersionRef` | `string` | yes |
| `settlementRuleVersionRef` | `string` | yes |
| `defaultPayoutPolicyRef` | `string` | yes |
| `defaultLimitPolicyRef` | `string` | yes |
| `defaultRestrictionPolicyRef` | `string` | yes |
| `effectiveFrom` | `string` | yes |
| `effectiveUntil` | `string` | no |
| `reason` | `string` | no |
| `enabledBetTypes` | array<`EnabledBetTypeReferenceBody`> | yes |

### `CreateTermsVersionBody`

| property | type | required |
|---|---|---|
| `code` | `string` | no |
| `version` | `number` | yes |
| `title` | `string` | yes |
| `body` | `string` | yes |
| `policyVersion` | `string` | yes |
| `effectiveFrom` | `string` | yes |
| `effectiveUntil` | `string` | no |
| `reason` | `string` | no |

### `CreateWithdrawalBody`

| property | type | required |
|---|---|---|
| `payoutDestinationId` | `string` | yes |
| `amountMinor` | `number` | yes |
| `currency` | `string` | yes |

### `DepositBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `memberId` | `string` | yes |
| `providerCode` | `string` | yes |
| `methodCode` | `string` | yes |
| `amountMinor` | `string` | yes |
| `currency` | `string` | yes |
| `status` | `string` | yes |
| `ledgerTransactionId` | `string` | yes |
| `createdAt` | `string (date-time)` | yes |
| `updatedAt` | `string (date-time)` | yes |

### `DepositInitiateBody`

| property | type | required |
|---|---|---|
| `providerCode` | `string` | yes |
| `methodCode` | `string` | yes |
| `amountMinor` | `number` | yes |
| `currency` | `string` | yes |

### `DepositMethodDescriptionBody`

| property | type | required |
|---|---|---|
| `methodCode` | `string` | yes |
| `providerCode` | `string` | yes |
| `currency` | `string` | yes |
| `feeMinor` | `string` | yes |
| `instructions` | array<`string`> | yes |

### `DepositMethodSummaryBody`

| property | type | required |
|---|---|---|
| `methodCode` | `string` | yes |
| `providerCode` | `string` | yes |

### `EnabledBetTypeReferenceBody`

| property | type | required |
|---|---|---|
| `betTypeId` | `string (uuid)` | yes |
| `betTypeVersionId` | `string (uuid)` | yes |

### `ExpectedRevisionBody`

| property | type | required |
|---|---|---|
| `expectedRevision` | `number` | yes |
| `reason` | `string` | no |

### `ExpectedVersionBody`

| property | type | required |
|---|---|---|
| `expectedVersion` | `number` | yes |

### `GenerateDrawsBody`

| property | type | required |
|---|---|---|
| `baseOccurrences` | array<`OccurrenceBody`> | yes |

### `KycReadinessBody`

| property | type | required |
|---|---|---|
| `required` | `boolean` | yes |
| `status` | `string` | yes |
| `verified` | `boolean` | yes |
| `expired` | `boolean` | yes |

### `MemberBetTypeDetailBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `code` | `string` | yes |
| `versions` | array<`MemberBetTypeVersionBody`> | yes |

### `MemberBetTypePageBody`

| property | type | required |
|---|---|---|
| `items` | array<`MemberBetTypeSummaryBody`> | yes |
| `nextCursor` | `string` | yes |

### `MemberBetTypeSummaryBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `code` | `string` | yes |
| `versions` | array<`CatalogVersionBody`> | yes |

### `MemberBetTypeVersionBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `version` | `number` | yes |
| `revision` | `number` | yes |
| `state` | `string` | yes |
| `effectiveFrom` | `string (date-time)` | yes |
| `effectiveUntil` | `string (date-time)` | yes |
| `canonicalNumberFormat` | `string` | yes |
| `validationPattern` | `string` | yes |
| `defaultPayout` | `object` | yes |
| `minStakeMinor` | `string` | yes |
| `maxStakeMinor` | `string` | yes |
| `limitPolicyRef` | `string` | yes |
| `restrictionPolicyRef` | `string` | yes |
| `settlementRuleVersionRef` | `string` | yes |

### `MemberDeviceViewBody`

| property | type | required |
|---|---|---|
| `deviceId` | `string` | yes |
| `name` | `string` | yes |
| `createdAt` | `string (date-time)` | yes |
| `lastUsedAt` | `string (date-time)` | yes |

### `MemberDrawBetTypeBody`

| property | type | required |
|---|---|---|
| `betTypeId` | `string` | yes |
| `betTypeCode` | `string` | yes |
| `betTypeVersionId` | `string` | yes |
| `canonicalNumberFormat` | `string` | yes |
| `validationPattern` | `string` | yes |
| `payout` | `object` | yes |
| `minStakeMinor` | `string` | yes |
| `maxStakeMinor` | `string` | yes |
| `limitPolicyRef` | `string` | yes |
| `restrictionPolicyRef` | `string` | yes |
| `settlementRuleVersionRef` | `string` | yes |

### `MemberDrawCutoffBody`

| property | type | required |
|---|---|---|
| `cutoffAt` | `string (date-time)` | yes |

### `MemberDrawDetailBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `productId` | `string` | yes |
| `productVersionId` | `string` | yes |
| `occurrenceIdentity` | `string` | yes |
| `localDate` | `string` | yes |
| `state` | `string` | yes |
| `version` | `number` | yes |
| `openAt` | `string (date-time)` | yes |
| `cutoffAt` | `string (date-time)` | yes |
| `drawAt` | `string (date-time)` | yes |
| `provenance` | `string` | yes |
| `timezone` | `string` | yes |
| `scheduleTemplateRef` | `string` | yes |
| `resultSchemaVersionRef` | `string` | yes |
| `settlementRuleVersionRef` | `string` | yes |
| `defaultPayoutPolicyRef` | `string` | yes |
| `defaultLimitPolicyRef` | `string` | yes |
| `defaultRestrictionPolicyRef` | `string` | yes |
| `resultSourceRef` | `string` | yes |
| `overrideRevisionRef` | `string` | yes |
| `cutoff` | `MemberDrawCutoffBody` | yes |
| `serverNow` | `string (date-time)` | yes |
| `allowedActions` | array<`string`> | yes |
| `betTypes` | array<`MemberDrawBetTypeBody`> | yes |

### `MemberDrawEligibilityBody`

| property | type | required |
|---|---|---|
| `eligible` | `boolean` | yes |
| `cutoffAt` | `string (date-time)` | yes |
| `serverNow` | `string (date-time)` | yes |

### `MemberDrawPageBody`

| property | type | required |
|---|---|---|
| `items` | array<`MemberDrawDetailBody`> | yes |
| `nextCursor` | `string` | yes |

### `MemberLoginBody`

| property | type | required |
|---|---|---|
| `phone` | `string` | yes |
| `password` | `string (password)` | yes |
| `deviceName` | `string` | no |

### `MemberLoginResponse`

| property | type | required |
|---|---|---|
| `accessToken` | `string` | yes |
| `memberId` | `string` | yes |
| `deviceId` | `string` | yes |

### `MemberMeResponse`

| property | type | required |
|---|---|---|
| `memberId` | `string` | yes |
| `phone` | `string` | yes |
| `status` | `string` | yes |
| `passwordEnrolled` | `boolean` | yes |

### `MemberProductDetailBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `versions` | array<`MemberProductVersionBody`> | yes |

### `MemberProductPageBody`

| property | type | required |
|---|---|---|
| `items` | array<`MemberProductSummaryBody`> | yes |
| `nextCursor` | `string` | yes |

### `MemberProductSummaryBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `versions` | array<`CatalogVersionBody`> | yes |

### `MemberProductVersionBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `version` | `number` | yes |
| `revision` | `number` | yes |
| `state` | `string` | yes |
| `effectiveFrom` | `string (date-time)` | yes |
| `effectiveUntil` | `string (date-time)` | yes |
| `timezone` | `string` | yes |
| `scheduleTemplateRef` | `string` | yes |
| `resultSchemaVersionRef` | `string` | yes |
| `settlementRuleVersionRef` | `string` | yes |
| `defaultPayoutPolicyRef` | `string` | yes |
| `defaultLimitPolicyRef` | `string` | yes |
| `defaultRestrictionPolicyRef` | `string` | yes |
| `enabledBetTypes` | array<`CatalogEnabledBetTypeBody`> | yes |

### `MemberProfileBody`

| property | type | required |
|---|---|---|
| `memberId` | `string` | yes |
| `phone` | `string` | yes |
| `fullName` | `string` | yes |
| `dateOfBirth` | `string` | yes |
| `province` | `string` | yes |
| `profileUpdatedAt` | `string (date-time)` | yes |
| `mandatoryFields` | array<`string`> | yes |
| `missingMandatoryFields` | array<`string`> | yes |
| `profileComplete` | `boolean` | yes |

### `MemberReadinessBody`

| property | type | required |
|---|---|---|
| `memberId` | `string` | yes |
| `asOf` | `string (date-time)` | yes |
| `policyVersion` | `string` | yes |
| `capabilities` | array<`CapabilityReadinessBody`> | yes |
| `requirements` | `ReadinessRequirementsBody` | yes |

### `MemberRefreshResponse`

| property | type | required |
|---|---|---|
| `accessToken` | `string` | yes |

### `MemberRevokedResponse`

| property | type | required |
|---|---|---|
| `revoked` | `boolean` | yes |

### `MemberSessionResponse`

| property | type | required |
|---|---|---|
| `purpose` | `string` | yes |
| `accessToken` | `string` | yes |
| `memberId` | `string` | yes |
| `accountCreated` | `boolean` | yes |
| `deviceId` | `string` | yes |

### `MemberSessionViewBody`

| property | type | required |
|---|---|---|
| `sessionId` | `string` | yes |
| `deviceId` | `string` | yes |
| `expiresAt` | `string (date-time)` | yes |

### `MemberSettlementOutcomeBody`

| property | type | required |
|---|---|---|
| `orderId` | `string` | yes |
| `outcome` | `string` | yes |
| `payoutMinor` | `string` | yes |
| `batchState` | `string` | yes |
| `authoritative` | `boolean` | yes |

### `MemberTermsBody`

| property | type | required |
|---|---|---|
| `memberId` | `string` | yes |
| `asOf` | `string (date-time)` | yes |
| `required` | array<`RequiredTermsBody`> | yes |
| `acceptances` | array<`TermsAcceptanceBody`> | yes |
| `satisfied` | `boolean` | yes |

### `NotificationPreferenceBody`

| property | type | required |
|---|---|---|
| `topic` | `string` | yes |
| `channel` | `string` | yes |
| `enabled` | `boolean` | yes |
| `version` | `number` | yes |
| `updatedAt` | `string (date-time)` | yes |

### `NotificationPreferencesBody`

| property | type | required |
|---|---|---|
| `memberId` | `string` | yes |
| `items` | array<`NotificationPreferenceBody`> | yes |

### `Object`

`object`

### `OccurrenceBody`

| property | type | required |
|---|---|---|
| `occurrenceIdentity` | `string` | yes |
| `localDate` | `string` | yes |
| `openAt` | `string (date-time)` | yes |
| `cutoffAt` | `string (date-time)` | yes |
| `drawAt` | `string (date-time)` | yes |
| `provenance` | `string` | yes |

### `OtpRequestBody`

| property | type | required |
|---|---|---|
| `purpose` | `string` | yes |
| `phone` | `string` | yes |

### `OtpRequestResponse`

| property | type | required |
|---|---|---|
| `purpose` | `string` | yes |
| `deliveredTo` | `string` | yes |
| `retryAfterSeconds` | `number` | yes |

### `OtpVerifyBody`

| property | type | required |
|---|---|---|
| `purpose` | `string` | yes |
| `phone` | `string` | yes |
| `code` | `string` | yes |
| `password` | `string (password)` | yes |
| `deviceName` | `string` | no |

### `OverrideBody`

| property | type | required |
|---|---|---|
| `reason` | `string` | yes |
| `effectiveAt` | `string (date-time)` | no |
| `changes` | `object` | yes |
| `approvalEvidenceRef` | `string` | yes |
| `auditEvidenceRef` | `string` | yes |

### `PasswordEnrollResponse`

| property | type | required |
|---|---|---|
| `purpose` | `string` | yes |
| `memberId` | `string` | yes |
| `passwordSet` | `boolean` | yes |
| `passwordUpdatedAt` | `string (date-time)` | yes |

### `PasswordResetBody`

| property | type | required |
|---|---|---|
| `phone` | `string` | yes |
| `code` | `string` | yes |
| `password` | `string (password)` | yes |

### `PasswordResetResponse`

| property | type | required |
|---|---|---|
| `purpose` | `string` | yes |
| `memberId` | `string` | yes |
| `passwordReset` | `boolean` | yes |
| `passwordUpdatedAt` | `string (date-time)` | yes |

### `PayoutDestinationBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `memberId` | `string` | yes |
| `type` | `string` | yes |
| `bankCode` | `string` | yes |
| `accountNumberMasked` | `string` | yes |
| `accountHolderName` | `string` | yes |
| `currency` | `string` | yes |
| `status` | `string` | yes |
| `verificationEvidenceRef` | `string` | yes |
| `verifiedAt` | `string (date-time)` | yes |
| `version` | `number` | yes |
| `createdAt` | `string (date-time)` | yes |
| `updatedAt` | `string (date-time)` | yes |

### `PayoutDestinationListBody`

| property | type | required |
|---|---|---|
| `items` | array<`PayoutDestinationBody`> | yes |

### `PromotionDiscoveryBody`

| property | type | required |
|---|---|---|
| `memberId` | `string` | yes |
| `asOf` | `string (date-time)` | yes |
| `items` | array<`PromotionDiscoveryItemBody`> | yes |

### `PromotionDiscoveryItemBody`

| property | type | required |
|---|---|---|
| `campaignVersionId` | `string` | yes |
| `campaignCode` | `string` | yes |
| `campaignVersion` | `number` | yes |
| `rewardAmountMinor` | `string` | yes |
| `currency` | `string` | yes |
| `turnoverTargetMinor` | `string` | yes |
| `contributionBps` | `number` | yes |
| `winningsDestination` | `string` | yes |
| `stackingMode` | `string` | yes |
| `effectiveFrom` | `string (date-time)` | yes |
| `effectiveUntil` | `string (date-time)` | yes |
| `expiresAt` | `string (date-time)` | yes |
| `eligible` | `boolean` | yes |
| `ineligibilityReasons` | array<`string`> | yes |

### `PromotionEntitlementBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `memberId` | `string` | yes |
| `campaignCode` | `string` | yes |
| `campaignVersionId` | `string` | yes |
| `campaignVersion` | `number` | yes |
| `state` | `string` | yes |
| `version` | `number` | yes |
| `terms` | `object` | yes |
| `rewardMinor` | `string` | yes |
| `turnoverTargetMinor` | `string` | yes |
| `releasedMinor` | `string` | yes |
| `grantedAt` | `string (date-time)` | yes |
| `expiresAt` | `string (date-time)` | yes |
| `completedAt` | `string (date-time)` | yes |
| `grantLedgerTransactionId` | `string` | yes |
| `releaseLedgerTransactionId` | `string` | yes |
| `turnover` | `TurnoverProgressBody` | yes |
| `turnoverEntries` | array<`TurnoverEntryBody`> | yes |
| `allowedActions` | array<`string`> | yes |

### `PromotionEntitlementPageBody`

| property | type | required |
|---|---|---|
| `items` | array<`PromotionEntitlementBody`> | yes |
| `nextCursor` | `string` | yes |

### `QuoteCreateBody`

| property | type | required |
|---|---|---|
| `betTypeCode` | `string` | yes |
| `canonicalNumber` | `string` | yes |
| `stakeMinor` | `string` | yes |

### `QuoteLineBody`

| property | type | required |
|---|---|---|
| `betTypeId` | `string` | yes |
| `betTypeCode` | `string` | yes |
| `betTypeVersionId` | `string` | yes |
| `canonicalNumber` | `string` | yes |
| `stakeMinor` | `string` | yes |
| `resolvedPayout` | `object` | yes |
| `payoutSource` | `string` | yes |
| `restrictions` | array<`string`> | yes |

### `ReadinessRequirementsBody`

| property | type | required |
|---|---|---|
| `termsSatisfied` | `boolean` | yes |
| `profileComplete` | `boolean` | yes |
| `missingProfileFields` | array<`string`> | yes |
| `kyc` | `KycReadinessBody` | yes |
| `outstandingRequirements` | array<`string`> | yes |

### `ReconciliationDiscrepancyFactsResponse`

| property | type | required |
|---|---|---|
| `memberId` | `string (uuid)` | yes |
| `currency` | `string` | yes |
| `bucket` | `string` | yes |
| `metric` | `string` | yes |
| `amountMinor` | `string` | yes |

### `ReconciliationDiscrepancyListResponse`

| property | type | required |
|---|---|---|
| `items` | array<`ReconciliationDiscrepancyResponse`> | yes |
| `nextCursor` | `string` | yes |
| `dataAsOf` | `string (date-time)` | yes |

### `ReconciliationDiscrepancyResponse`

| property | type | required |
|---|---|---|
| `id` | `string (uuid)` | yes |
| `reconciliationRunId` | `string (uuid)` | yes |
| `pair` | `string` | yes |
| `identityKey` | `string` | yes |
| `memberId` | `string (uuid)` | yes |
| `currency` | `string` | yes |
| `status` | `string` | yes |
| `severity` | `string` | yes |
| `expectedFacts` | `ReconciliationDiscrepancyFactsResponse` | yes |
| `observedFacts` | `ReconciliationDiscrepancyFactsResponse` | yes |
| `amountDifferenceMinor` | `string` | yes |
| `sourceReferences` | `ReconciliationDiscrepancySourceReferencesResponse` | yes |
| `detectedAt` | `string (date-time)` | yes |
| `ageMs` | `number` | yes |
| `ownerReference` | `string` | yes |
| `resolutionTrail` | array<`object`> | yes |
| `resolutionEvidence` | `object` | yes |
| `outcome` | `string` | yes |
| `resolvedAt` | `string (date-time)` | yes |
| `createdAt` | `string (date-time)` | yes |
| `updatedAt` | `string (date-time)` | yes |

### `ReconciliationDiscrepancySourceReferencesResponse`

| property | type | required |
|---|---|---|
| `pair` | `string` | yes |
| `checkpointKey` | `string` | yes |
| `memberId` | `string (uuid)` | yes |
| `ledgerAccountId` | `string` | yes |

### `ReconciliationInspectedCountsResponse`

| property | type | required |
|---|---|---|
| `ledgerAccounts` | `number` | yes |
| `ledgerPostings` | `number` | yes |
| `activeReservationAllocations` | `number` | yes |
| `walletBuckets` | `number` | yes |
| `discrepancies` | `number` | yes |

### `ReconciliationResultSummaryResponse`

| property | type | required |
|---|---|---|
| `matched` | `boolean` | yes |
| `discrepancyCount` | `number` | yes |
| `bucketCount` | `number` | yes |

### `ReconciliationRunListResponse`

| property | type | required |
|---|---|---|
| `items` | array<`ReconciliationRunResponse`> | yes |
| `nextCursor` | `string` | yes |
| `dataAsOf` | `string (date-time)` | yes |

### `ReconciliationRunResponse`

| property | type | required |
|---|---|---|
| `id` | `string (uuid)` | yes |
| `pair` | `string` | yes |
| `checkpointKey` | `string` | yes |
| `memberId` | `string (uuid)` | yes |
| `currency` | `string` | yes |
| `asOf` | `string (date-time)` | yes |
| `createdAt` | `string (date-time)` | yes |
| `sourceRange` | `ReconciliationSourceRangeResponse` | yes |
| `sourceCheckpoint` | `ReconciliationSourceCheckpointResponse` | yes |
| `inspectedCounts` | `ReconciliationInspectedCountsResponse` | yes |
| `totals` | `ReconciliationTotalsResponse` | yes |
| `result` | `string` | yes |
| `resultSummary` | `ReconciliationResultSummaryResponse` | yes |
| `discrepancyCount` | `number` | yes |

### `ReconciliationSourceCheckpointResponse`

| property | type | required |
|---|---|---|
| `checkpointKey` | `string` | yes |
| `memberId` | `string (uuid)` | yes |
| `currency` | `string` | yes |
| `asOf` | `string (date-time)` | yes |
| `latestLedgerPostingId` | `string` | yes |
| `latestLedgerPostingAt` | `string (date-time)` | yes |
| `latestReservationId` | `string` | yes |
| `latestReservationCreatedAt` | `string (date-time)` | yes |

### `ReconciliationSourceRangeResponse`

| property | type | required |
|---|---|---|
| `ledgerPostedAt` | `object` | yes |
| `reservationLifecycle` | `object` | yes |

### `ReconciliationTotalsResponse`

| property | type | required |
|---|---|---|
| `expected` | `object` | yes |
| `observed` | `object` | yes |
| `difference` | `object` | yes |

### `RecoveryOtpRequestBody`

| property | type | required |
|---|---|---|
| `phone` | `string` | yes |

### `RecoveryOtpRequestResponse`

| property | type | required |
|---|---|---|
| `purpose` | `string` | yes |
| `deliveredTo` | `string` | yes |
| `retryAfterSeconds` | `number` | yes |

### `RecoveryOtpVerificationResponse`

| property | type | required |
|---|---|---|
| `purpose` | `string` | yes |
| `verified` | `boolean` | yes |
| `evidenceRef` | `string` | yes |

### `RecoveryOtpVerifyBody`

| property | type | required |
|---|---|---|
| `phone` | `string` | yes |
| `code` | `string` | yes |

### `RequiredTermsBody`

| property | type | required |
|---|---|---|
| `documentId` | `string` | yes |
| `code` | `string` | yes |
| `version` | `number` | yes |
| `title` | `string` | yes |
| `body` | `string` | yes |
| `contentDigest` | `string` | yes |
| `policyVersion` | `string` | yes |
| `effectiveFrom` | `string (date-time)` | yes |
| `effectiveUntil` | `string (date-time)` | yes |
| `accepted` | `boolean` | yes |
| `acceptedAt` | `string (date-time)` | yes |
| `acceptanceId` | `string` | yes |

### `SetRestrictionBody`

| property | type | required |
|---|---|---|
| `memberId` | `string` | yes |
| `capability` | `string` | yes |
| `reason` | `string` | yes |
| `effectiveFrom` | `string` | yes |
| `effectiveUntil` | `string` | no |
| `actorOrPolicyRef` | `string` | no |

### `SubmitAccountingPeriodBody`

| property | type | required |
|---|---|---|
| `expectedVersion` | `number` | yes |

### `TermsAcceptanceBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `memberId` | `string` | yes |
| `documentId` | `string` | yes |
| `documentCode` | `string` | yes |
| `documentVersion` | `number` | yes |
| `contentDigest` | `string` | yes |
| `source` | `string` | yes |
| `acceptedAt` | `string (date-time)` | yes |

### `TermsVersionBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `code` | `string` | yes |
| `version` | `number` | yes |
| `revision` | `number` | yes |
| `state` | `string` | yes |
| `title` | `string` | yes |
| `body` | `string` | yes |
| `contentDigest` | `string` | yes |
| `policyVersion` | `string` | yes |
| `effectiveFrom` | `string (date-time)` | yes |
| `effectiveUntil` | `string (date-time)` | yes |
| `reason` | `string` | yes |
| `publishedAt` | `string (date-time)` | yes |
| `approvalEvidenceRef` | `string` | yes |
| `createdAt` | `string (date-time)` | yes |
| `updatedAt` | `string (date-time)` | yes |

### `TermsVersionListBody`

| property | type | required |
|---|---|---|
| `items` | array<`TermsVersionBody`> | yes |
| `nextCursor` | `string` | yes |

### `TransitionBody`

| property | type | required |
|---|---|---|
| `command` | `string` | yes |
| `expectedVersion` | `number` | yes |

### `TurnoverEntryBody`

| property | type | required |
|---|---|---|
| `betReference` | `string` | yes |
| `entryKind` | `string` | yes |
| `state` | `string` | yes |
| `contributionMinor` | `string` | yes |
| `occurredAt` | `string (date-time)` | yes |

### `TurnoverProgressBody`

| property | type | required |
|---|---|---|
| `provisionalMinor` | `string` | yes |
| `finalizedMinor` | `string` | yes |
| `progressMinor` | `string` | yes |
| `targetMinor` | `string` | yes |
| `remainingMinor` | `string` | yes |
| `releaseReached` | `boolean` | yes |

### `UpdateMemberProfileBody`

| property | type | required |
|---|---|---|
| `fullName` | `string` | no |
| `dateOfBirth` | `string` | no |
| `province` | `string` | no |

### `UpdateNotificationPreferencesBody`

| property | type | required |
|---|---|---|
| `preferences` | array<`NotificationPreferenceBody`> | yes |

### `WalletBalanceBody`

| property | type | required |
|---|---|---|
| `memberId` | `string` | yes |
| `currency` | `string` | yes |
| `dataAsOf` | `string (date-time)` | yes |
| `buckets` | array<`WalletBucketBody`> | yes |

### `WalletBucketBody`

| property | type | required |
|---|---|---|
| `bucket` | `string` | yes |
| `postedMinor` | `string` | yes |
| `reservedMinor` | `string` | yes |
| `availableMinor` | `string` | yes |

### `WalletTransactionBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `businessTransactionId` | `string` | yes |
| `operationType` | `string` | yes |
| `correlationId` | `string` | yes |
| `postedAt` | `string (date-time)` | yes |
| `effectiveAt` | `string (date-time)` | yes |
| `netImpactMinor` | `string` | yes |

### `WalletTransactionPageBody`

| property | type | required |
|---|---|---|
| `items` | array<`WalletTransactionBody`> | yes |
| `nextCursor` | `string` | yes |

### `WithdrawalBody`

| property | type | required |
|---|---|---|
| `id` | `string` | yes |
| `memberId` | `string` | yes |
| `payoutDestinationId` | `string` | yes |
| `amountMinor` | `string` | yes |
| `feeMinor` | `string` | yes |
| `currency` | `string` | yes |
| `state` | `string` | yes |
| `version` | `number` | yes |
| `eligibilityOutcome` | `string` | yes |
| `eligibilityReasonCodes` | array<`string`> | yes |
| `requiresApproval` | `boolean` | yes |
| `ledgerTransactionId` | `string` | yes |
| `payoutEvidenceRef` | `string` | yes |
| `failureReason` | `string` | yes |
| `decisionReason` | `string` | yes |
| `allowedActions` | `object` | yes |
| `eligibilityEvidenceRefs` | array<`string`> | yes |
| `createdAt` | `string (date-time)` | yes |
| `updatedAt` | `string (date-time)` | yes |

### `WithdrawalCommandBody`

| property | type | required |
|---|---|---|
| `reason` | `string` | yes |

### `WithdrawalListBody`

| property | type | required |
|---|---|---|
| `items` | array<`WithdrawalBody`> | yes |
| `nextCursor` | `string` | yes |

### `WithdrawalPreflightBody`

| property | type | required |
|---|---|---|
| `balanceReady` | `boolean` | yes |
| `availableMinor` | `string` | yes |
| `minValid` | `boolean` | yes |
| `maxValid` | `boolean` | yes |
| `outcome` | `string` | yes |
| `reasonCodes` | array<`string`> | yes |
| `policyVersion` | `string` | yes |
| `evaluatedAt` | `string (date-time)` | yes |
| `validUntil` | `string (date-time)` | yes |
