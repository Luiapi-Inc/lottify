import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { SessionService } from "./application/session.service";
import { SESSION_REPOSITORY } from "./domain/session.repository";
import { PrismaSessionRepository } from "./infrastructure/prisma-session.repository";

@Module({
  imports: [JwtModule.register({})],
  providers: [
    SessionService,
    PrismaSessionRepository,
    { provide: SESSION_REPOSITORY, useExisting: PrismaSessionRepository },
  ],
  exports: [SessionService],
})
export class IdentityAccessModule {}
