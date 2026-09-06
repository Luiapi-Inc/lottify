import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { Counter, Histogram } from "prom-client";

const HTTP_METRIC_LABELS = ["method", "route", "status_code"] as const;

export const httpRequestsTotal = new Counter({
  name: "lottify_http_requests_total",
  help: "Total completed HTTP requests handled by the Lottify API",
  labelNames: HTTP_METRIC_LABELS,
});

export const httpRequestDurationSeconds = new Histogram({
  name: "lottify_http_request_duration_seconds",
  help: "Lottify API HTTP request duration in seconds",
  labelNames: HTTP_METRIC_LABELS,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 1.5, 2, 5, 10],
});

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();

    response.once("finish", () => {
      const labels = {
        method: request.method,
        route: matchedRouteTemplate(request),
        status_code: String(response.statusCode),
      };
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;

      httpRequestsTotal.inc(labels);
      httpRequestDurationSeconds.observe(labels, durationSeconds);
    });

    next();
  }
}

export function matchedRouteTemplate(request: Request): string {
  const route = request.route as { path?: unknown } | undefined;
  return typeof route?.path === "string" && route.path.length > 0 ? route.path : "unmatched";
}
