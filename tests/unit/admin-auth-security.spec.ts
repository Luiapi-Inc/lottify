import { describe, expect, it } from "vitest";
import {
  hashAdminPassword,
  verifyAdminPassword,
} from "../../src/contexts/identity-access/domain/admin-password";
import {
  capabilitiesForRole,
  parseAdminRole,
} from "../../src/contexts/identity-access/domain/admin-policy";
import {
  decryptAdminSecret,
  encryptAdminSecret,
} from "../../src/contexts/identity-access/domain/admin-secret-crypto";
import {
  generateTotpCode,
  generateTotpSecret,
  verifyTotp,
} from "../../src/contexts/identity-access/domain/totp";

describe("Admin authentication security primitives", () => {
  it("hashes Admin passwords and verifies only the correct credential", async () => {
    const encoded = await hashAdminPassword("Correct horse battery staple 123!");

    await expect(
      verifyAdminPassword(encoded, "Correct horse battery staple 123!"),
    ).resolves.toBe(true);
    await expect(verifyAdminPassword(encoded, "wrong password")).resolves.toBe(false);
    expect(encoded).not.toContain("Correct horse battery staple 123!");
  });

  it("encrypts TOTP secrets at rest with authenticated encryption", () => {
    const encrypted = encryptAdminSecret(
      "JBSWY3DPEHPK3PXP",
      "01234567890123456789012345678901",
    );

    expect(encrypted).not.toContain("JBSWY3DPEHPK3PXP");
    expect(
      decryptAdminSecret(encrypted, "01234567890123456789012345678901"),
    ).toBe("JBSWY3DPEHPK3PXP");
  });

  it("verifies six-digit RFC 6238 TOTP within the accepted clock window", () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000_000;
    const code = generateTotpCode(secret, now);

    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, now)).toBe(true);
    expect(verifyTotp(secret, "not-a-code", now)).toBe(false);
  });

  it("locks the current Admin role vocabulary and read capability mapping", () => {
    expect(parseAdminRole("SUPER_ADMIN")).toBe("SUPER_ADMIN");
    expect(parseAdminRole("ADMIN")).toBe("ADMIN");
    expect(parseAdminRole("AUDITOR")).toBe("AUDITOR");
    expect(parseAdminRole("OPERATOR")).toBeNull();
    expect(capabilitiesForRole("ADMIN")).toEqual([
      "accounting-period.read",
      "accounting-period.create-custom",
      "accounting-period.submit",
      "accounting-period.approve",
      "accounting-period.cancel",
      "accounting-period.close",
      "lottery-configuration.read",
      "lottery-configuration.create",
      "lottery-configuration.submit",
      "lottery-configuration.approve",
      "lottery-draw.read",
      "lottery-draw.manage",
      "result.read",
      "result.manage",
      "settlement.read",
      "settlement.manage",
      "withdrawal.read",
      "withdrawal.review",
      "withdrawal.payout",
      "promotion.read",
      "promotion.manage",
      "promotion.approve",
      "member-terms.read",
      "member-terms.manage",
      "member-terms.approve",
      "member-readiness.read",
      "member-readiness.manage",
      "reconciliation.read",
      "report.read",
      "audit.read",
      "approval.read",
    ]);
    expect(capabilitiesForRole("SUPER_ADMIN")).toEqual([
      "accounting-period.read",
      "accounting-period.create-custom",
      "accounting-period.submit",
      "accounting-period.approve",
      "accounting-period.cancel",
      "accounting-period.close",
      "lottery-configuration.read",
      "lottery-configuration.create",
      "lottery-configuration.submit",
      "lottery-configuration.approve",
      "lottery-draw.read",
      "lottery-draw.manage",
      "result.read",
      "result.manage",
      "settlement.read",
      "settlement.manage",
      "withdrawal.read",
      "withdrawal.review",
      "withdrawal.payout",
      "promotion.read",
      "promotion.manage",
      "promotion.approve",
      "member-terms.read",
      "member-terms.manage",
      "member-terms.approve",
      "member-readiness.read",
      "member-readiness.manage",
      "reconciliation.read",
      "report.read",
      "audit.read",
      "approval.read",
    ]);
    expect(capabilitiesForRole("AUDITOR")).toEqual([
      "accounting-period.read",
      "lottery-configuration.read",
      "lottery-draw.read",
      "result.read",
      "settlement.read",
      "withdrawal.read",
      "promotion.read",
      "member-terms.read",
      "member-readiness.read",
      "reconciliation.read",
      "report.read",
      "audit.read",
      "approval.read",
    ]);
  });
});
