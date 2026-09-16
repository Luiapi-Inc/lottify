import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { ApiModule } from "../../apps/api/src/app.module";
import { DrawCancellationOrchestrator } from "../../src/contexts/lottery/application/draw-cancellation-orchestrator";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";

// Env-gated: boots the full API module, so it connects to the shared dev
// Postgres/Redis and must not run inside the default (RUN_INTEGRATION_TESTS=0)
// unit suite, where a full-module boot on a 2-core box destabilizes the
// parallel run. Proves the orchestrator resolves through ContextsModule wiring
// (refund port adapter -> betting service, and the admin controller path).
describe.runIf(runIntegration)("Draw-cancellation orchestration DI wiring", () => {
  it("boots the API module and resolves the orchestrator through ContextsModule", async () => {
    const app = await NestFactory.createApplicationContext(ApiModule, {
      logger: ["error", "warn"],
    });
    try {
      const orch = app.get(DrawCancellationOrchestrator);
      expect(typeof orch.completeDrawCancellation).toBe("function");
    } finally {
      await app.close();
    }
  });
});
