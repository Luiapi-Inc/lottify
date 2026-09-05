import { describe, expect, it } from "vitest";
import { accountingPeriodCancellationUi } from "../../apps/admin-web/app/accounting-period-cancellation-ui";

describe("Accounting Period cancellation UI contract", () => {
  it("hides cancellation when the server does not allow the action", () => {
    expect(
      accountingPeriodCancellationUi({
        state: "SCHEDULED",
        cancellationRequestedByAdminId: null,
        allowedActions: [],
      }),
    ).toBeNull();
  });

  it("exposes immediate creator cancellation for DRAFT without MFA", () => {
    expect(
      accountingPeriodCancellationUi({
        state: "DRAFT",
        cancellationRequestedByAdminId: null,
        allowedActions: ["cancel"],
      }),
    ).toMatchObject({
      actionLabel: "ยกเลิก DRAFT",
      governed: false,
      requiresMfa: false,
      reasonReadOnly: false,
    });
  });

  it("exposes creator withdrawal for PENDING_APPROVAL without MFA", () => {
    expect(
      accountingPeriodCancellationUi({
        state: "PENDING_APPROVAL",
        cancellationRequestedByAdminId: null,
        allowedActions: ["cancel"],
      }),
    ).toMatchObject({
      actionLabel: "ถอนคำขอ",
      governed: false,
      requiresMfa: false,
      reasonReadOnly: false,
    });
  });

  it("exposes a request-only SCHEDULED cancellation before approval exists", () => {
    const ui = accountingPeriodCancellationUi({
      state: "SCHEDULED",
      cancellationRequestedByAdminId: null,
      allowedActions: ["cancel"],
    });
    expect(ui).toMatchObject({
      actionLabel: "ส่งคำขอยกเลิก",
      governed: true,
      approvingCancellation: false,
      requiresMfa: false,
      reasonReadOnly: false,
    });
    expect(ui?.permissionNote).toContain("ยังไม่เปลี่ยน SCHEDULED หรือ coverage");
  });

  it("exposes approval/execute for a pending SCHEDULED cancellation and requires MFA", () => {
    const ui = accountingPeriodCancellationUi({
      state: "SCHEDULED",
      cancellationRequestedByAdminId: "requester-admin-id",
      allowedActions: ["cancel"],
    });
    expect(ui).toMatchObject({
      actionLabel: "อนุมัติการยกเลิก",
      governed: true,
      approvingCancellation: true,
      requiresMfa: true,
      reasonReadOnly: true,
    });
    expect(ui?.permissionNote).toContain("ยังคงเป็น SCHEDULED และ coverage ยังไม่เปลี่ยน");
  });
});
