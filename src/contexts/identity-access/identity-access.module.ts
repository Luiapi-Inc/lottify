import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AdminAuthService } from "./application/admin-auth.service";
import { LocalMemberOtpDelivery } from "./application/local-member-otp-delivery";
import { MemberAuthService } from "./application/member-auth.service";
import { MEMBER_OTP_DELIVERY_PORT } from "./application/member-otp-delivery.port";
import { SessionService } from "./application/session.service";
import { ADMIN_AUTH_REPOSITORY } from "./domain/admin-auth.repository";
import { MEMBER_AUTH_REPOSITORY } from "./domain/identity-auth.repository";
import { SESSION_REPOSITORY } from "./domain/session.repository";
import { PrismaAdminAuthRepository } from "./infrastructure/prisma-admin-auth.repository";
import { PrismaMemberAuthRepository } from "./infrastructure/prisma-member-auth.repository";
import { PrismaSessionRepository } from "./infrastructure/prisma-session.repository";

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
  ],
  exports: [AdminAuthService, SessionService, MemberAuthService, LocalMemberOtpDelivery],
})
export class IdentityAccessModule {}
