import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AdminAuthService } from "./application/admin-auth.service";
import { SessionService } from "./application/session.service";
import { ADMIN_AUTH_REPOSITORY } from "./domain/admin-auth.repository";
import { SESSION_REPOSITORY } from "./domain/session.repository";
import { PrismaAdminAuthRepository } from "./infrastructure/prisma-admin-auth.repository";
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
  ],
  exports: [AdminAuthService, SessionService],
})
export class IdentityAccessModule {}
