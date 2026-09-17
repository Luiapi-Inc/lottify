import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { getEnvironment } from "../../../src/platform/config/env";

/**
 * Guards the operational surface (`/metrics`, `/internal/health/*`).
 *
 * When `OPS_AUTH_TOKEN` is set (production), requests must present
 * `Authorization: Bearer <OPS_AUTH_TOKEN>`; otherwise 401. The environment
 * schema (`src/platform/config/env.ts`) refuses to boot `staging`/`production`
 * without `OPS_AUTH_TOKEN`, so in those environments the token is always
 * present and this guard is never a pass-through. When the token is empty
 * (local/test only) the guard is a pass-through so sandbox probes and the
 * container smoke test keep working without extra configuration. This satisfies
 * "separate ops exposure ... or auth" (GH #92 / W5-F4) by isolating the ops
 * endpoints behind a bearer token on the shared listener, and the committed
 * Prometheus scrape config (deploy/observability/prometheus/prometheus.yml)
 * supplies that token on scrape.
 */
@Injectable()
export class OpsAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const token = getEnvironment().OPS_AUTH_TOKEN;
    if (!token) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.headers.authorization;
    if (authorization === `Bearer ${token}`) return true;

    throw new UnauthorizedException();
  }
}
