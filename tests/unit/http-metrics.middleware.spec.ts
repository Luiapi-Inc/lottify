import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it } from "vitest";
import {
  HttpMetricsMiddleware,
  httpRequestDurationSeconds,
  httpRequestsTotal,
  matchedRouteTemplate,
} from "../../apps/api/src/http-metrics.middleware";

function createResponse(statusCode: number): Response {
  const response = new EventEmitter() as unknown as Response;
  response.statusCode = statusCode;
  return response;
}

function finish(response: Response): void {
  (response as unknown as EventEmitter).emit("finish");
}

function createRequest(method: string, routePath?: string): Request {
  return {
    method,
    ...(routePath === undefined ? {} : { route: { path: routePath } }),
  } as Request;
}

describe("API HTTP SLO metrics", () => {
  beforeEach(() => {
    httpRequestsTotal.reset();
    httpRequestDurationSeconds.reset();
  });

  it("uses the matched route template instead of the raw request URL", () => {
    expect(createRequest("GET", "/api/v1/bet-orders/:id").route.path).toBe(
      "/api/v1/bet-orders/:id",
    );
    expect(matchedRouteTemplate(createRequest("GET", "/api/v1/bet-orders/:id"))).toBe(
      "/api/v1/bet-orders/:id",
    );
  });

  it("uses a fixed unmatched label when no route template was matched", () => {
    expect(matchedRouteTemplate(createRequest("GET"))).toBe("unmatched");
  });

  it("records method, matched route, status and completed request count", async () => {
    const middleware = new HttpMetricsMiddleware();
    const response = createResponse(201);

    middleware.use(createRequest("POST", "/api/v1/bet-quotes"), response, () => {
      finish(response);
    });

    const metric = await httpRequestsTotal.get();
    expect(metric.values).toContainEqual(
      expect.objectContaining({
        labels: {
          method: "POST",
          route: "/api/v1/bet-quotes",
          status_code: "201",
        },
        value: 1,
      }),
    );
  });

  it("aggregates repeated requests on the same bounded label set", async () => {
    const middleware = new HttpMetricsMiddleware();

    for (let index = 0; index < 2; index += 1) {
      const response = createResponse(200);
      middleware.use(createRequest("GET", "/api/v1/draws/:id"), response, () => {
        finish(response);
      });
    }

    const metric = await httpRequestsTotal.get();
    expect(metric.values).toContainEqual(
      expect.objectContaining({
        labels: {
          method: "GET",
          route: "/api/v1/draws/:id",
          status_code: "200",
        },
        value: 2,
      }),
    );
  });

  it("records request duration on the same bounded labels", async () => {
    const middleware = new HttpMetricsMiddleware();
    const response = createResponse(503);

    middleware.use(createRequest("GET"), response, () => {
      finish(response);
    });

    const metric = await httpRequestDurationSeconds.get();
    expect(metric.values).toContainEqual(
      expect.objectContaining({
        metricName: "lottify_http_request_duration_seconds_count",
        labels: {
          method: "GET",
          route: "unmatched",
          status_code: "503",
        },
        value: 1,
      }),
    );
  });
});
