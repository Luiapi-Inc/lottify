import "reflect-metadata";
import type { Prisma } from "@prisma/client";
import { LotteryConfigurationService } from "../../../src/contexts/lottery/application/lottery-configuration.service";
import type { LotteryConfigurationActor } from "../../../src/contexts/lottery/application/lottery-configuration.service";
import { PrismaService } from "../../../src/platform/persistence/prisma.service";

export interface ProcessCommand {
  phase: "before-commit" | "after-commit" | "retry";
  command: { scope: string; key: string; fingerprint: string; responseCode: number };
  code: string;
  publication?: { kind: "PRODUCT" | "BET_TYPE"; id: string; expectedRevision: number; reauthEvidenceId: string; correlationId: string };
  actor: LotteryConfigurationActor;
}

// IPC is the test barrier, separate from the command response. The parent kills
// this process at a known transaction boundary, without a graceful disconnect.
process.once("message", async (input: ProcessCommand) => {
  const prisma = new PrismaService();
  let backendPid: number | undefined;
  // Test-only transaction lifetime exceeds the entire parent test deadline.
  // Capture its backend inside the very transaction executing the real command.
  const instrumented = new Proxy(prisma, {
    get(target, property) {
      if (property === "$transaction") return (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        target.$transaction(async tx => {
          const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          backendPid = backend!.pid;
          return work(tx);
        }, { timeout: 30_000 });
      return Reflect.get(target, property, target);
    },
  });
  const service = new LotteryConfigurationService(instrumented);
  try {
    const result = await service.executeCommand(input.command, async () => {
      const resource = input.publication
        ? await service.approveAndPublish({ ...input.publication, actor: input.actor })
        : await service.createBetType({ code: input.code, actor: input.actor });
      if (input.phase === "before-commit") {
        process.send!({ phase: "before-commit", resourceId: resource.id, backendPid });
        await new Promise<never>(() => {});
      }
      return resource;
    });
    if (input.phase === "after-commit") {
      process.send!({ phase: "after-commit" });
      // Keep the IPC channel open, withholding the caller's response until killed.
      process.on("message", () => {});
      return;
    }
    await prisma.$disconnect();
    process.send!({ phase: "result", result }, undefined, {}, () => process.disconnect());
  } catch (error) {
    await prisma.$disconnect();
    process.send!({ phase: "error", message: error instanceof Error ? error.message : String(error) }, undefined, {}, () => process.disconnect());
    process.exitCode = 1;
  }
});
