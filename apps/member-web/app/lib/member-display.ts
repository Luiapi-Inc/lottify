/**
 * Display helpers for the Member betting / wallet surfaces.
 *
 * Everything here is presentation-only: money is formatted from the API's
 * integer minor-unit strings with BigInt arithmetic (never floating point), and
 * any value whose shape is not part of the published contract is rendered
 * verbatim instead of being guessed at.
 */
import { MemberApiFailure } from "./member-api";

/** Format an integer amount in minor units (satang) as `1,234.56`. */
export function formatMinor(value: string | number | bigint, decimals = 2): string {
  let text: string;
  if (typeof value === "bigint") text = value.toString();
  else if (typeof value === "number") text = Number.isFinite(value) ? Math.trunc(value).toString() : "0";
  else text = /^-?\d+$/.test(value.trim()) ? value.trim() : "0";

  const negative = text.startsWith("-");
  const digits = (negative ? text.slice(1) : text).padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${decimals > 0 ? `.${fraction}` : ""}`;
}

/** `10000` -> `100.00 บาท`. */
export function formatBaht(value: string | number | bigint, decimals = 2): string {
  return `${formatMinor(value, decimals)} บาท`;
}

/**
 * The v1 FIXED payout contract (settlement-batch.ts): `resolvedPayout` is
 * `{ kind: "FIXED", amountMinor }` where `amountMinor` is the total winning
 * return for a reference stake of 100 minor units (1 THB), stake included.
 * Anything outside that shape is returned as null so the caller can show the
 * raw value rather than assert a payout it cannot prove.
 */
export function parseFixedPayout(value: unknown): { amountMinor: bigint } | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record["kind"] !== "FIXED") return null;
  const raw = record["amountMinor"];
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0) return { amountMinor: BigInt(raw) };
  if (typeof raw === "string" && /^\d+$/.test(raw)) return { amountMinor: BigInt(raw) };
  return null;
}

/** `{ kind:"FIXED", amountMinor: 90000 }` -> `x900`. */
export function formatPayoutMultiplier(amountMinor: bigint): string {
  const whole = amountMinor / 100n;
  const fraction = amountMinor % 100n;
  const fractionText = fraction === 0n ? "" : `.${fraction.toString().padStart(2, "0").replace(/0+$/, "")}`;
  return `x${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fractionText}`;
}

/** Display label for a resolved payout; unconsumed shapes are shown verbatim. */
export function describeResolvedPayout(value: unknown): string {
  const payout = parseFixedPayout(value);
  if (payout) return formatPayoutMultiplier(payout.amountMinor);
  if (value === null || value === undefined) return "—";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Winning return for a stake: floor(stakeMinor * amountMinor / 100). */
export function expectedWinMinor(stakeMinor: string, value: unknown): bigint | null {
  const payout = parseFixedPayout(value);
  if (!payout || !/^\d+$/.test(stakeMinor.trim())) return null;
  return (BigInt(stakeMinor.trim()) * payout.amountMinor) / 100n;
}

/** Sum of a list of integer minor-unit strings. */
export function sumMinor(values: readonly string[]): bigint {
  return values.reduce((total, value) => total + (/^-?\d+$/.test(value) ? BigInt(value) : 0n), 0n);
}

/** Signed minor-unit string -> `+1,350.00` / `-120.00`. */
export function formatSignedMinor(value: string): string {
  const negative = value.trim().startsWith("-");
  const magnitude = negative ? value.trim().slice(1) : value.trim();
  return `${negative ? "-" : "+"}${formatMinor(magnitude)}`;
}

const BANGKOK = "Asia/Bangkok";

/** Date + time in Thai locale, Asia/Bangkok (the Draw timezone). */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: BANGKOK,
  }).format(date);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: BANGKOK }).format(date);
}

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

/** Bet Order state -> Member-facing label. Unknown states are shown verbatim. */
const ORDER_STATES: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "ฉบับร่าง", tone: "neutral" },
  QUOTED: { label: "รอตรวจและยืนยัน", tone: "info" },
  CONFIRMING: { label: "กำลังยืนยัน", tone: "info" },
  CONFIRMED: { label: "ยืนยันแล้ว · รอผล", tone: "success" },
  CANCELLING: { label: "กำลังยกเลิก", tone: "warning" },
  CANCELLED: { label: "ยกเลิกแล้ว", tone: "neutral" },
  EXPIRED: { label: "Quote หมดอายุ", tone: "warning" },
  REJECTED: { label: "ถูกปฏิเสธ", tone: "danger" },
  SETTLED: { label: "ตัดสินผลแล้ว", tone: "success" },
};

export function describeOrderState(state: string): { label: string; tone: Tone } {
  return ORDER_STATES[state] ?? { label: state, tone: "neutral" };
}

/** Draw state -> Member-facing label. Unknown states are shown verbatim. */
const DRAW_STATES: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "ฉบับร่าง", tone: "neutral" },
  SCHEDULED: { label: "กำหนดการแล้ว", tone: "info" },
  OPEN: { label: "เปิดรับ", tone: "success" },
  CLOSED: { label: "ปิดรับแล้ว", tone: "warning" },
  RESULT_PENDING: { label: "รอผล", tone: "info" },
  RESULT_CONFIRMED: { label: "ยืนยันผลแล้ว", tone: "info" },
  SETTLING: { label: "กำลังตัดสินผล", tone: "info" },
  SETTLED: { label: "ตัดสินผลแล้ว", tone: "success" },
  CANCELLING: { label: "กำลังยกเลิกงวด", tone: "warning" },
  CANCELLED: { label: "งวดถูกยกเลิก", tone: "danger" },
};

export function describeDrawState(state: string): { label: string; tone: Tone } {
  return DRAW_STATES[state] ?? { label: state, tone: "neutral" };
}

/** Ledger operation type -> Member-facing label. Unknown codes are shown raw. */
const OPERATION_TYPES: Record<string, string> = {
  DEPOSIT_CREDIT: "ฝากเงินสำเร็จ",
  BET_STAKE_COMMIT: "ใช้เงินซื้อหวย",
  BET_STAKE_REFUND: "คืนเงินรายการที่ยกเลิก",
  SETTLEMENT_PAYOUT: "เงินรางวัล",
  SETTLEMENT_PAYOUT_REVERSAL: "ปรับปรุงผลรางวัล",
  PROMOTION_BONUS_GRANT: "ได้รับโบนัส",
  PROMOTION_BONUS_EXPIRY: "โบนัสหมดอายุ",
  PROMOTION_BONUS_TO_CASH: "แปลงโบนัสเป็นเงินสด",
  WITHDRAWAL_FINALIZE: "ถอนเงินสำเร็จ",
  ADJUSTMENT: "ปรับปรุงยอดโดยเจ้าหน้าที่",
};

export function describeOperationType(operationType: string): string {
  return OPERATION_TYPES[operationType] ?? operationType;
}

/** Bet Type number shape, taken from the Draw's own bet-type snapshot.
 *  `canonicalNumberFormat` is the authoritative width ("00" = 2 digits); the
 *  validation pattern is the server's own acceptance test. */
export function numberLengthFor(betType: {
  canonicalNumberFormat: string;
  validationPattern: string;
}): number {
  const formatDigits = (betType.canonicalNumberFormat.match(/[0#9]/g) ?? []).length;
  if (formatDigits > 0) return formatDigits;
  const quantified = betType.validationPattern.match(/\{(\d+)(?:,(\d*))?\}/);
  if (quantified) return Number(quantified[1]);
  return 0;
}

/** Validate a number against the server's own pattern for the selected type,
 *  so the client never accepts something the API will reject for shape. */
export function isValidCanonicalNumber(
  betType: { canonicalNumberFormat: string; validationPattern: string },
  value: string,
): boolean {
  if (!value) return false;
  try {
    return new RegExp(betType.validationPattern).test(value);
  } catch {
    const length = numberLengthFor(betType);
    return length > 0 ? new RegExp(`^\\d{${length}}$`).test(value) : value.length > 0;
  }
}

/** Wallet bucket -> Member-facing label. Unknown buckets are shown verbatim. */
const WALLET_BUCKETS: Record<string, string> = {
  CASH: "เงินสด",
  BONUS: "โบนัส",
  LOCKED: "ยอดที่พักไว้",
};

export function describeWalletBucket(bucket: string): string {
  return WALLET_BUCKETS[bucket] ?? bucket;
}

/**
 * API failure -> actionable Thai guidance. Only codes the API actually emits
 * are mapped (QuoteRuleCode / BetOrderRuleCode / BettingOrderError /
 * BettingQuoteError / controller validation); anything else falls back to the
 * server's own message so the Member never reads a fabricated explanation.
 */
const FAILURE_GUIDANCE: Record<string, string> = {
  SESSION_REQUIRED: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
  CUTOFF_REACHED: "เลยเวลาปิดรับของงวดนี้แล้ว จึงยืนยันรายการไม่ได้ กรุณาเลือกงวดที่ยังเปิดรับ",
  CANCELLATION_CUTOFF_REACHED: "เลยเวลาที่ระบบอนุญาตให้ยกเลิกของงวดนี้แล้ว",
  DRAW_NOT_OPEN: "งวดนี้ยังไม่เปิดรับรายการ",
  DRAW_NOT_FOUND: "ไม่พบงวดที่เลือก อาจถูกลบหรือปิดไปแล้ว กรุณาเลือกใหม่",
  QUOTE_EXPIRED: "Quote นี้หมดอายุแล้ว กรุณาสร้าง Quote ใหม่จากรายการเดิม",
  QUOTE_NOT_FOUND: "ไม่พบ Quote นี้ในบัญชีของคุณ",
  QUOTE_NOT_AUTHORISED: "Quote นี้ไม่ได้รับอนุญาตสำหรับการยืนยันรายการ",
  ORDER_NOT_FOUND: "ไม่พบโพยนี้ในบัญชีของคุณ",
  ORDER_EXISTS_FOR_QUOTE: "Quote นี้ถูกใช้สร้างโพยไปแล้ว",
  RECEIPT_NOT_FOUND: "ยังไม่มีใบรับรายการสำหรับโพยนี้ (ออกให้เมื่อยืนยันสำเร็จเท่านั้น)",
  INSUFFICIENT_FUNDS: "ยอดเงินที่ใช้ได้ไม่เพียงพอกับรายการนี้ กรุณาปรับยอดหรือเติมเงิน",
  WALLET_RESTRICTED: "กระเป๋าของคุณถูกจำกัดการใช้งานสำหรับรายการนี้",
  MEMBER_NOT_ELIGIBLE: "บัญชีของคุณยังไม่ผ่านเงื่อนไขที่จำเป็นสำหรับรายการนี้",
  VERSION_CONFLICT: "รายการนี้ถูกเปลี่ยนจากอุปกรณ์หรือแท็บอื่น กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่",
  ILLEGAL_ACTION: "สถานะปัจจุบันของรายการไม่อนุญาตให้ทำคำสั่งนี้",
  INVALID_STATE: "สถานะปัจจุบันของรายการไม่อนุญาตให้ทำคำสั่งนี้",
  IDEMPOTENCY_CONFLICT: "คำขอนี้ถูกใช้กับข้อมูลอื่นไปแล้ว กรุณาลองทำรายการใหม่",
  IDEMPOTENCY_KEY_REQUIRED: "คำขอนี้ต้องมี Idempotency-Key กรุณาลองใหม่อีกครั้ง",
  IDEMPOTENCY_KEY_INVALID: "Idempotency-Key ของคำขอไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง",
  EMPTY_QUOTE: "ยังไม่มีรายการที่จะสร้าง Quote",
  INVALID_STAKE: "จำนวนเงินไม่ถูกต้อง",
  INVALID_NUMBER: "เลขที่กรอกไม่ตรงรูปแบบของประเภทที่เลือก",
  NUMBER_BLOCKED: "เลขนี้งดรับในงวดนี้ กรุณาเปลี่ยนเลข",
  BET_TYPE_NOT_FOUND: "ไม่พบประเภทการแทงที่เลือกในงวดนี้",
  BET_TYPE_DISABLED: "ประเภทการแทงนี้ปิดรับในงวดนี้",
  STAKE_BELOW_MINIMUM: "จำนวนเงินต่ำกว่าขั้นต่ำของประเภทที่เลือก",
  STAKE_LIMIT_EXCEEDED: "จำนวนเงินเกินวงเงินที่ระบบอนุญาต",
  MAX_AMOUNT_EXCEEDED: "เลขนีมียอดสะสมเกินวงเงินที่ระบบอนุญาตในงวดนี้",
  INVALID_QUOTE_REQUEST: "ข้อมูลคำขอสร้าง Quote ไม่ถูกต้อง",
};

export function describeMemberApiFailure(error: unknown): { code: string; message: string; correlationId?: string } {
  if (error instanceof MemberApiFailure) {
    return {
      code: error.code,
      message: FAILURE_GUIDANCE[error.code] ?? error.message,
      correlationId: error.correlationId,
    };
  }
  return {
    code: "UNEXPECTED",
    message: error instanceof Error ? error.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองอีกครั้ง",
  };
}

/** Guidance for a raw server code with no HTTP wrapper (e.g. an Order's
 *  `rejectionReason`), falling back to the code itself. */
export function describeFailureCode(code: string, serverMessage?: string | null): string {
  return FAILURE_GUIDANCE[code] ?? serverMessage ?? code;
}
