export const CONTEXT_MANIFEST = [
  { key: "identity-access", owner: "Login Identity, OTP, Session, Device, MFA, re-authentication" },
  { key: "member", owner: "Member profile, onboarding, terms acceptance, capability restrictions" },
  { key: "lottery", owner: "Lottery Product, Bet Type configuration, Schedule Template, Draw lifecycle" },
  { key: "betting", owner: "Quote, Bet Order, Bet Line, Bet Receipt, cancellation, consumed exposure" },
  { key: "wallet-ledger", owner: "Accounts, balance buckets, reservations, immutable double-entry Ledger" },
  { key: "payments", owner: "Deposit, Withdrawal, payout destination, provider workflow state" },
  { key: "kyc-risk", owner: "Verification, risk signals, eligibility, responsible-gaming policy" },
  { key: "promotion", owner: "Campaign, entitlement, turnover, referral and cashback semantics" },
  { key: "result-settlement", owner: "Result intake/validation/correction and Settlement batches" },
  { key: "notification", owner: "Preferences, templates, communication requests and delivery outcomes" },
  { key: "admin-approval", owner: "Approval workflows, maker-checker and administrative authorization" },
  { key: "audit", owner: "Immutable Audit Records" },
  { key: "reporting", owner: "Read-only reporting and projection models" }
] as const;
