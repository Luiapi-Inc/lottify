import type { Environment } from "../../platform/config/env";
import { LocalMemberOtpDelivery } from "./application/local-member-otp-delivery";
import type { MemberOtpDeliveryPort } from "./application/member-otp-delivery.port";
import { ThaiBulkSmsMemberOtpDelivery } from "./infrastructure/thaibulksms-member-otp-delivery";

/**
 * Member OTP delivery selection (Ticket 09 sequencing). `console` keeps the
 * in-memory local sink so dev/test harnesses can observe codes without a real
 * SMS gateway; `thaibulksms` delivers real SMS. Env validation already
 * guarantees THAIBULKSMS_API_KEY/SECRET are present for the thaibulksms
 * provider.
 */
export function createMemberOtpDelivery(env: Environment): MemberOtpDeliveryPort {
  if (env.OTP_PROVIDER === "thaibulksms") {
    return new ThaiBulkSmsMemberOtpDelivery({
      apiKey: env.THAIBULKSMS_API_KEY as string,
      apiSecret: env.THAIBULKSMS_API_SECRET as string,
      sender: env.THAIBULKSMS_SENDER,
      force: env.THAIBULKSMS_FORCE,
    });
  }
  return new LocalMemberOtpDelivery();
}
