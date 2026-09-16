import { describe, expect, it } from "vitest";
import { LocalMemberOtpDelivery } from "../../src/contexts/identity-access/application/local-member-otp-delivery";
import { createMemberOtpDelivery } from "../../src/contexts/identity-access/application/member-otp-delivery.factory";
import {
  ThaiBulkSmsDeliveryError,
  ThaiBulkSmsMemberOtpDelivery,
} from "../../src/contexts/identity-access/infrastructure/thaibulksms-member-otp-delivery";
import type { Environment } from "../../src/platform/config/env";

function envWith(overrides: Partial<Environment>): Environment {
  return {
    ...({} as Environment),
    OTP_PROVIDER: "console",
    THAIBULKSMS_SENDER: "Demo",
    THAIBULKSMS_FORCE: "standard",
    ...overrides,
  } as Environment;
}

describe("createMemberOtpDelivery", () => {
  it("keeps the local in-memory sink for the console provider", () => {
    const delivery = createMemberOtpDelivery(envWith({ OTP_PROVIDER: "console" }));
    expect(delivery).toBeInstanceOf(LocalMemberOtpDelivery);
  });

  it("selects the ThaiBulkSMS adapter when configured", () => {
    const delivery = createMemberOtpDelivery(
      envWith({
        OTP_PROVIDER: "thaibulksms",
        THAIBULKSMS_API_KEY: "key",
        THAIBULKSMS_API_SECRET: "secret",
      }),
    );
    expect(delivery).toBeInstanceOf(ThaiBulkSmsMemberOtpDelivery);
  });
});

describe("ThaiBulkSmsMemberOtpDelivery", () => {
  const config = {
    apiKey: "test-key",
    apiSecret: "test-secret",
    sender: "Demo",
    force: "standard" as const,
  };

  it("posts the form-encoded OTP message to the ThaiBulkSMS standard API with Basic auth", async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const delivery = new ThaiBulkSmsMemberOtpDelivery(config, async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });
      return { status: 201 };
    });

    await delivery.deliver({ phone: "+66812345678", purpose: "LOGIN", code: "123456" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api-v2.thaibulksms.com/sms");
    expect(calls[0].headers.Authorization).toBe(
      `Basic ${Buffer.from("test-key:test-secret").toString("base64")}`,
    );
    expect(calls[0].headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(calls[0].body);
    expect(form.get("sender")).toBe("Demo");
    expect(form.get("msisdn")).toBe("66812345678");
    expect(form.get("force")).toBe("standard");
    expect(form.get("message")).toContain("123456");
    expect(form.get("message")).toContain("เข้าสู่ระบบ");
  });

  it("maps each OTP purpose to its Thai label in the message", async () => {
    const bodies: string[] = [];
    const delivery = new ThaiBulkSmsMemberOtpDelivery(config, async (_url, init) => {
      bodies.push(init.body);
      return { status: 201 };
    });

    await delivery.deliver({ phone: "+66812345678", purpose: "RECOVERY", code: "654321" });
    await delivery.deliver({ phone: "+66812345678", purpose: "REGISTER", code: "111111" });

    expect(new URLSearchParams(bodies[0]).get("message")).toContain("กู้คืนบัญชี");
    expect(new URLSearchParams(bodies[1]).get("message")).toContain("สมัครสมาชิก");
  });

  it("throws a typed error when the gateway answers non-2xx", async () => {
    const delivery = new ThaiBulkSmsMemberOtpDelivery(config, async () => ({ status: 400 }));

    await expect(
      delivery.deliver({ phone: "+66812345678", purpose: "LOGIN", code: "123456" }),
    ).rejects.toBeInstanceOf(ThaiBulkSmsDeliveryError);
  });

  it("honors the corporate force override", async () => {
    let capturedForce: string | null;
    const delivery = new ThaiBulkSmsMemberOtpDelivery(
      { ...config, force: "corporate" },
      async (_url, init) => {
        capturedForce = new URLSearchParams(init.body).get("force");
        return { status: 201 };
      },
    );

    await delivery.deliver({ phone: "+66812345678", purpose: "LOGIN", code: "123456" });

    expect(capturedForce).toBe("corporate");
  });
});
