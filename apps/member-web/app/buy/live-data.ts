export function formatMinor(value: string): string {
  if (!/^-?\d+$/.test(value)) return "—";
  const negative = value.startsWith("-");
  const digits = (negative ? value.slice(1) : value).padStart(3, "0");
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${whole}.${digits.slice(-2)}`;
}

export function minorToBaht(value: string): number {
  if (!/^\d+$/.test(value)) return 0;
  return Number(BigInt(value)) / 100;
}

export function toMinor(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const minor = Math.round(value * 100);
  return Number.isSafeInteger(minor) ? String(minor) : null;
}

export function formatDateTime(value: string, timeZone = "Asia/Bangkok"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatRemaining(cutoffAt: string, serverNow: string): string {
  const cutoff = new Date(cutoffAt).getTime();
  const now = new Date(serverNow).getTime();
  if (!Number.isFinite(cutoff) || !Number.isFinite(now)) return "—";
  const totalSeconds = Math.max(0, Math.floor((cutoff - now) / 1000));
  if (totalSeconds === 0) return "ปิดรับแล้ว";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

export function productLabel(productId: string): string {
  return `Lottery Product · ${shortId(productId)}`;
}

function fixedPayoutAmountMinor(payout: unknown): bigint | null {
  if (!payout || typeof payout !== "object") return null;
  const record = payout as Record<string, unknown>;
  if (record.kind !== "FIXED") return null;
  const value = record.amountMinor;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

export function formatPayout(payout: unknown): string {
  const amountMinor = fixedPayoutAmountMinor(payout);
  if (amountMinor === null) return "ตามเงื่อนไขที่ระบบยืนยัน";
  const whole = amountMinor / 100n;
  const remainder = amountMinor % 100n;
  if (remainder === 0n) return `x${whole.toString()}`;
  const decimal = remainder.toString().padStart(2, "0").replace(/0+$/, "");
  return `x${whole.toString()}.${decimal}`;
}

export function payoutReturnMinor(stakeMinor: string, payout: unknown): string | null {
  if (!/^\d+$/.test(stakeMinor)) return null;
  const amountMinor = fixedPayoutAmountMinor(payout);
  if (amountMinor === null) return null;
  return ((BigInt(stakeMinor) * amountMinor) / 100n).toString();
}

export function digitLengthFromPattern(pattern: string): number | null {
  const brace = /\\d\{(\d+)\}/.exec(pattern) ?? /\[0-9\]\{(\d+)\}/.exec(pattern);
  if (brace) {
    const parsed = Number(brace[1]);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 64 ? parsed : null;
  }
  return null;
}
