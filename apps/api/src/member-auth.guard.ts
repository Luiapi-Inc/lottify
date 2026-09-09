import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import {
  SessionService,
} from "../../../src/contexts/identity-access/application/session.service";
import { currentCorrelationId } from "./correlation";

export interface MemberAuthenticatedRequest extends Request {
  memberAuth?: {
    memberId: string;
    sessionId: string;
    deviceId: string | null;
  };
}

@Injectable()
export class MemberAuthGuard implements CanActivate {
  constructor(
    @Inject(SessionService)
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<MemberAuthenticatedRequest>();
    const authorization = request.header("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      throw memberAuthenticationRequired();
    }
    try {
      request.memberAuth = await this.sessions.authenticateAccess(
        authorization.slice(7).trim(),
      );
    } catch {
      throw memberAuthenticationRequired();
    }
    return true;
  }
}

function memberAuthenticationRequired(): UnauthorizedException {
  return new UnauthorizedException({
    code: "AUTHENTICATION_REQUIRED",
    message: "Member authentication required",
    details: {},
    correlationId: currentCorrelationId() ?? randomUUID(),
  });
}
