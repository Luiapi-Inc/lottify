import type { MemberOtpDeliveryPort } from "./application/member-otp-delivery.port";

/**
 * ThaiBulkSMS standard SMS API (developer.thaibulksms.com — POST /sms,
 * `application/x-www-form-urlencoded`, Basic auth). The operator-facing OTP
 * product is not used: the platform already owns code generation, hashing and
 * verify semantics, so the gateway is used purely as a transport
 * (`force=standard` spends the operator's standard credit).
 */
const THAIBULKSMS_SMS_ENDPOINT = "https://api-v2.thaibulksms.com/sms";

const PURPOSE_LABELS_TH: Record<string, string> = {
  // Retained only so a message built from a historical challenge still renders;
  // CR #141 retired LOGIN as an issuable purpose, so no new LOGIN code is sent.
  LOGIN: "เข้าสู่ระบบ",
  REGISTER: "สมัครสมาชิก",
  PASSWORD_ENROLL: "ตั้งรหัสผ่าน",
  REAUTH: "ยืนยันตัวตนอีกครั้ง",
  RECOVERY: "กู้คืนบัญชี",
};

export type ThaiBulkSmsPostForm = (
  url: string,
  init: { headers: Record<string, string>; body: string },
) => Promise<{ status: number }>;

async function defaultPostForm(
  url: string,
  init: { headers: Record<string, string>; body: string },
): Promise<{ status: number }> {
  const response = await fetch(url, {
    method: "POST",
    headers: init.headers,
    body: init.body,
  });
  return { status: response.status };
}

export class ThaiBulkSmsDeliveryError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ThaiBulkSmsDeliveryError";
  }
}

export class ThaiBulkSmsMemberOtpDelivery implements MemberOtpDeliveryPort {
  constructor(
    private readonly config: {
      apiKey: string;
      apiSecret: string;
      sender: string;
      force: "standard" | "corporate";
    },
    private readonly postForm: ThaiBulkSmsPostForm = defaultPostForm,
  ) {}

  async deliver(input: { phone: string; purpose: string; code: string }): Promise<void> {
    // normalizePhone yields E.164 (`+66...`); ThaiBulkSMS accepts `+66...`,
    // `66...` and Thai mobile formats in the `msisdn` form field.
    const msisdn = input.phone.replace(/^\+/, "");
    const purposeLabel = PURPOSE_LABELS_TH[input.purpose] ?? input.purpose;
    const message = `รหัส OTP Lottify สำหรับ${purposeLabel}: ${input.code} (ใช้ได้ 5 นาที ห้ามบอกผู้อื่น)`;
    const form = new URLSearchParams({
      sender: this.config.sender,
      msisdn,
      message,
      force: this.config.force,
    });
    const auth = Buffer.from(`${this.config.apiKey}:${this.config.apiSecret}`).toString("base64");
    const response = await this.postForm(THAIBULKSMS_SMS_ENDPOINT, {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new ThaiBulkSmsDeliveryError(
        response.status,
        `ThaiBulkSMS OTP delivery failed with status ${response.status}`,
      );
    }
  }
}
