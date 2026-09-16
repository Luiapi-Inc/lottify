import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export const CORRELATION_HEADER = "x-correlation-id";
export const MAX_CORRELATION_ID_LENGTH = 128;

export interface CorrelationStore {
  correlationId: string;
}

export const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

/**
 * Resolve the correlation id for a request. Accepts a caller-supplied
 * `x-correlation-id` header only when it is present and within the length
 * limit; otherwise generates a fresh UUID. The same rule is used by the HTTP
 * access logger (pino-http `genReqId`) and the CorrelationMiddleware so both
 * log and trace carry the identical id.
 */
export function resolveCorrelationId(header: string | undefined): string {
  if (header && header.length > 0 && header.length <= MAX_CORRELATION_ID_LENGTH) {
    return header;
  }
  return randomUUID();
}

export function currentCorrelationId(): string | undefined {
  return correlationStorage.getStore()?.correlationId;
}
