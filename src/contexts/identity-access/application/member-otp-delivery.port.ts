// OTP delivery seam. Notification provider integration (Ticket 09) is out of
// scope for the Member Identity vertical; the application depends on this port
// so a provider adapter can be wired later without touching the auth flow.

export interface MemberOtpDeliveryPort {
  deliver(input: { phone: string; purpose: string; code: string }): Promise<void>;
}

export const MEMBER_OTP_DELIVERY_PORT = Symbol("MEMBER_OTP_DELIVERY_PORT");
