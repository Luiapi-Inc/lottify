import { Injectable, type NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { correlationStorage } from "./correlation";

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const header = request.header("x-correlation-id");
    const correlationId = header && header.length <= 128 ? header : randomUUID();
    response.setHeader("x-correlation-id", correlationId);
    correlationStorage.run({ correlationId }, next);
  }
}
