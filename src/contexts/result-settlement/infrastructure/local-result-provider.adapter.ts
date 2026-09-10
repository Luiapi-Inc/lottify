// Local (v1) Result provider adapter. Real provider integrations are
// vendor-specific (Ticket 09); this adapter is the deterministic, local seam the
// settlement flow uses when a provider is not configured. It is seeded per Draw
// with an authoritative winning-number map and returns it unchanged, which lets
// integration evidence drive matching, mismatch and correction scenarios
// without an external dependency.

import { Inject, Injectable } from "@nestjs/common";
import {
  ResultProviderAdapterError,
  type ResultProviderAdapter,
  type ResultProviderResult,
} from "../domain/result-provider.adapter";

export type SeededResult = {
  winningNumbers: Readonly<Record<string, string>>;
  resultSchemaVersionRef: string;
  providerEvidenceRef?: string | null;
};

@Injectable()
export class LocalResultProviderAdapter implements ResultProviderAdapter {
  /** Mutable seed table: drawId -> authoritative Result. */
  private readonly seeds = new Map<string, SeededResult>();

  seed(drawId: string, result: SeededResult): void {
    this.seeds.set(drawId, result);
  }

  async fetchResult(input: {
    drawId: string;
    resultSourceRef: string | null;
    correlationId: string;
  }): Promise<ResultProviderResult> {
    const seed = this.seeds.get(input.drawId);
    if (!seed) {
      throw new ResultProviderAdapterError(
        "DEFINITIVE_FAILURE",
        `No Result source configured for Draw ${input.drawId}`,
      );
    }
    return {
      identity: {
        providerId: "local-result-provider",
        providerTransactionId: `local:${input.drawId}`,
      },
      result: {
        winningNumbers: { ...seed.winningNumbers },
        resultSchemaVersionRef: seed.resultSchemaVersionRef,
        providerEvidenceRef: seed.providerEvidenceRef ?? null,
      },
    };
  }
}
