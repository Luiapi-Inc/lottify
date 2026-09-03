import { AsyncLocalStorage } from "node:async_hooks";

export interface CorrelationStore {
  correlationId: string;
}

export const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

export function currentCorrelationId(): string | undefined {
  return correlationStorage.getStore()?.correlationId;
}
