import { Injectable, type NestMiddleware } from "@nestjs/common";
import { context, trace } from "@opentelemetry/api";
import type { NextFunction, Request, Response } from "express";
import {
  CORRELATION_HEADER,
  correlationStorage,
  resolveCorrelationId,
} from "./correlation";

/** A request that has had its correlation id resolved by pino's `genReqId`. */
type CorrelationRequest = Request & { correlationId?: string };

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    // Reuse the id already resolved by pino-http (if the request passed through it)
    // so the log record and the trace span carry the identical id.
    const correlationId =
      (request as CorrelationRequest).correlationId ??
      resolveCorrelationId(request.header(CORRELATION_HEADER));
    response.setHeader(CORRELATION_HEADER, correlationId);

    // Bind the id to the active trace span (GH #92 / W5-F3) so the exported OTLP
    // payload carries it and the transaction is joinable from telemetry.
    const span = trace.getSpan(context.active());
    span?.setAttribute("lottify.correlation_id", correlationId);

    correlationStorage.run({ correlationId }, next);
  }
}
