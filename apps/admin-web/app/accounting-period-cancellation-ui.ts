export interface AccountingPeriodCancellationUiInput {
  state: string;
  cancellationRequestedByAdminId: string | null;
  allowedActions: readonly string[];
}

export interface AccountingPeriodCancellationUiState {
  actionLabel: string;
  governed: boolean;
  approvingCancellation: boolean;
  requiresMfa: boolean;
  reasonReadOnly: boolean;
  permissionNote: string | null;
}

export function accountingPeriodCancellationUi(
  period: AccountingPeriodCancellationUiInput,
): AccountingPeriodCancellationUiState | null {
  if (!period.allowedActions.includes("cancel")) return null;

  if (period.state === "DRAFT") {
    return {
      actionLabel: "ยกเลิก DRAFT",
      governed: false,
      approvingCancellation: false,
      requiresMfa: false,
      reasonReadOnly: false,
      permissionNote: null,
    };
  }

  if (period.state === "PENDING_APPROVAL") {
    return {
      actionLabel: "ถอนคำขอ",
      governed: false,
      approvingCancellation: false,
      requiresMfa: false,
      reasonReadOnly: false,
      permissionNote: null,
    };
  }

  const approvingCancellation =
    period.state === "SCHEDULED" && period.cancellationRequestedByAdminId !== null;
  return {
    actionLabel: approvingCancellation ? "อนุมัติการยกเลิก" : "ส่งคำขอยกเลิก",
    governed: period.state === "SCHEDULED",
    approvingCancellation,
    requiresMfa: approvingCancellation,
    reasonReadOnly: approvingCancellation,
    permissionNote:
      period.state !== "SCHEDULED"
        ? null
        : approvingCancellation
          ? "คำขอยกเลิกถูกบันทึกแล้ว ช่วงนี้ยังคงเป็น SCHEDULED และ coverage ยังไม่เปลี่ยน ผู้อนุมัติคนอื่นต้องยืนยันด้วย MFA ก่อนระบบคืน Automatic coverage แบบ atomic"
          : "การส่งคำขอยกเลิกจะยังไม่เปลี่ยน SCHEDULED หรือ coverage ผู้อนุมัติคนอื่นต้องอนุมัติในขั้นถัดไปก่อนจึงจะคืน Automatic coverage แบบ atomic",
  };
}
