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
import {
  MEMBER_LOGIN_CAPABILITY_REASON_CODES,
} from "../../../src/contexts/identity-access/application/pre-auth-login-capability.port";
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
    } catch (error) {
      // Preserve the capability denial (an effective `LOGIN_BLOCKED` rejects an
      // in-flight access token with the same coded reason as the pre-auth
      // boundary) instead of collapsing it to AUTHENTICATION_REQUIRED.
      if (isLoginCapabilityDenial(error)) throw error;
      throw memberAuthenticationRequired();
    }
    return true;
  }
}

function isLoginCapabilityDenial(error: unknown): boolean {
  if (!(error instanceof UnauthorizedException)) return false;
  const response = error.getResponse();
  const code =
    response && typeof response === "object"
      ? (response as { code?: unknown }).code
      : undefined;
  return (
    typeof code === "string" &&
    (MEMBER_LOGIN_CAPABILITY_REASON_CODES as readonly string[]).includes(code)
  );
}

function memberAuthenticationRequired(): UnauthorizedException {
  return new UnauthorizedException({
    code: "AUTHENTICATION_REQUIRED",
    message: "Member authentication required",
    details: {},
    correlationId: currentCorrelationId() ?? randomUUID(),
  });
}
