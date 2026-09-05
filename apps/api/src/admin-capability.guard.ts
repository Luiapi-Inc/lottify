import {
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import type { AdminCapability } from "../../../src/contexts/identity-access/domain/admin-auth.repository";
import type { AdminAuthenticatedRequest } from "./admin-auth.guard";
import { currentCorrelationId } from "./correlation";

const ADMIN_CAPABILITIES_METADATA = "lottify.admin.required-capabilities";

export const RequireAdminCapabilities = (...capabilities: AdminCapability[]) =>
  SetMetadata(ADMIN_CAPABILITIES_METADATA, capabilities);

@Injectable()
export class AdminCapabilityGuard implements CanActivate {
  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<readonly AdminCapability[]>(
        ADMIN_CAPABILITIES_METADATA,
        [context.getHandler(), context.getClass()],
      ) ?? [];
    if (required.length === 0) return true;

    const request = context
      .switchToHttp()
      .getRequest<AdminAuthenticatedRequest>();
    const admin = request.adminAuth;
    if (!admin) {
      throw new UnauthorizedException({
        code: "AUTHENTICATION_REQUIRED",
        message: "Admin authentication required",
        details: {},
        correlationId: currentCorrelationId() ?? randomUUID(),
      });
    }

    const granted = new Set(admin.capabilities);
    if (!required.every((capability) => granted.has(capability))) {
      throw new ForbiddenException({
        code: "ACCESS_DENIED",
        message: "Insufficient Admin capability",
        details: { required },
        correlationId: currentCorrelationId() ?? randomUUID(),
      });
    }
    return true;
  }
}
