import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AdminAuthService } from "./application/admin-auth.service";
import { LocalMemberOtpDelivery } from "./application/local-member-otp-delivery";
import { MemberAuthService } from "./application/member-auth.service";
import { MEMBER_OTP_DELIVERY_PORT } from "./application/member-otp-delivery.port";
import { MEMBER_LOGIN_CAPABILITY_PORT } from "./application/pre-auth-login-capability.port";
import { SessionService } from "./application/session.service";
import { ADMIN_AUTH_REPOSITORY } from "./domain/admin-auth.repository";
import { MEMBER_AUTH_REPOSITORY } from "./domain/identity-auth.repository";
import { SESSION_REPOSITORY } from "./domain/session.repository";
import { PrismaAdminAuthRepository } from "./infrastructure/prisma-admin-auth.repository";
import { PrismaMemberAuthRepository } from "./infrastructure/prisma-member-auth.repository";
import { PrismaSessionRepository } from "./infrastructure/prisma-session.repository";
import { PreAuthLoginCapabilityAdapter } from "../../platform/integration/pre-auth-login-capability.adapter";

@Module({
  imports: [JwtModule.register({})],
  providers: [
    AdminAuthService,
    PrismaAdminAuthRepository,
    { provide: ADMIN_AUTH_REPOSITORY, useExisting: PrismaAdminAuthRepository },
    SessionService,
    PrismaSessionRepository,
    { provide: SESSION_REPOSITORY, useExisting: PrismaSessionRepository },
    MemberAuthService,
    PrismaMemberAuthRepository,
    { provide: MEMBER_AUTH_REPOSITORY, useExisting: PrismaMemberAuthRepository },
    LocalMemberOtpDelivery,
    { provide: MEMBER_OTP_DELIVERY_PORT, useExisting: LocalMemberOtpDelivery },
    // The Member capability restriction that gates the pre-auth login boundary
    // is read through a cross-context adapter, so Identity & Access never
    // reaches into the Member context's storage or re-derives Ticket 06 rules.
    PreAuthLoginCapabilityAdapter,
    {
      provide: MEMBER_LOGIN_CAPABILITY_PORT,
      useExisting: PreAuthLoginCapabilityAdapter,
    },
  ],
  exports: [AdminAuthService, SessionService, MemberAuthService, LocalMemberOtpDelivery],
})
export class IdentityAccessModule {}
