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
  AdminAuthService,
  type AdminRequestContext,
} from "../../../src/contexts/identity-access/application/admin-auth.service";
import { currentCorrelationId } from "./correlation";

export interface AdminAuthenticatedRequest extends Request {
  adminAuth?: AdminRequestContext;
}

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    @Inject(AdminAuthService)
    private readonly adminAuth: AdminAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AdminAuthenticatedRequest>();
    const authorization = request.header("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      throw adminAuthenticationRequired();
    }
    try {
      request.adminAuth = await this.adminAuth.authenticateAccess(
        authorization.slice(7).trim(),
      );
    } catch {
      throw adminAuthenticationRequired();
    }
    return true;
  }
}

function adminAuthenticationRequired(): UnauthorizedException {
  return new UnauthorizedException({
    code: "AUTHENTICATION_REQUIRED",
    message: "Admin authentication required",
    details: {},
    correlationId: currentCorrelationId() ?? randomUUID(),
  });
}
