import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaSessionRepository } from "../../src/contexts/identity-access/infrastructure/prisma-session.repository";
import { SessionService } from "../../src/contexts/identity-access/application/session.service";
import { IdempotencyService } from "../../src/platform/idempotency/idempotency.service";
import { OutboxService } from "../../src/platform/outbox/outbox.service";
import { PrismaService } from "../../src/platform/persistence/prisma.service";
import { createQueue } from "../../src/platform/queue/queue.factory";

const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1";

describe.runIf(runIntegration)("foundation integration", () => {
  let prisma: PrismaService;
  let idempotency: IdempotencyService;
  let outbox: OutboxService;
  let sessions: SessionService;

  beforeAll(async () => {
    prisma = new PrismaService();
    idempotency = new IdempotencyService(prisma);
    outbox = new OutboxService(prisma);
    sessions = new SessionService(new PrismaSessionRepository(prisma), new JwtService());
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.outboxEvent.deleteMany();
    await prisma.idempotencyRecord.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.$disconnect();
  });

  it("persists idempotency result and replays the same business record", async () => {
    const key = randomUUID();
    const first = await idempotency.claim({
      scope: "integration.confirm",
      key,
      fingerprint: "sha256:test",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(first.kind).toBe("claimed");
    if (first.kind !== "claimed") return;

    await idempotency.complete(first.recordId, 200, { accepted: true });
    const replay = await idempotency.claim({
      scope: "integration.confirm",
      key,
      fingerprint: "sha256:test",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(replay).toMatchObject({ kind: "existing", status: "COMPLETED", responseCode: 200 });
  });

  it("rotates refresh tokens atomically and rejects reuse", async () => {
    const issued = await sessions.issue(randomUUID(), "integration-device");
    const rotated = await sessions.rotate(issued.sessionId, issued.refreshToken);
    expect(rotated.refreshToken).not.toBe(issued.refreshToken);
    await expect(sessions.rotate(issued.sessionId, issued.refreshToken)).rejects.toThrow();
    await sessions.revoke(issued.sessionId);
    await expect(sessions.rotate(issued.sessionId, rotated.refreshToken)).rejects.toThrow();
  });

  it("revokes sessions at device and all-device scope without crossing member boundaries", async () => {
    const memberId = randomUUID();
    const otherMemberId = randomUUID();
    const selectedDevice = await sessions.issue(memberId, "phone");
    const otherDevice = await sessions.issue(memberId, "tablet");
    const otherMember = await sessions.issue(otherMemberId, "phone");

    await sessions.revokeByDevice(memberId, "phone");

    await expect(sessions.rotate(selectedDevice.sessionId, selectedDevice.refreshToken)).rejects.toThrow();
    const rotatedOtherDevice = await sessions.rotate(otherDevice.sessionId, otherDevice.refreshToken);
    const rotatedOtherMember = await sessions.rotate(otherMember.sessionId, otherMember.refreshToken);

    await sessions.revokeAllForMember(memberId);

    await expect(sessions.rotate(otherDevice.sessionId, rotatedOtherDevice.refreshToken)).rejects.toThrow();
    await expect(sessions.rotate(otherMember.sessionId, rotatedOtherMember.refreshToken)).resolves.toBeDefined();
  });

  it("claims a transactional outbox row once per lease and marks it published", async () => {
    const eventId = await prisma.$transaction((tx) =>
      outbox.enqueue(tx, {
        topic: "notification.integration",
        aggregateType: "IntegrationProbe",
        aggregateId: randomUUID(),
        payload: { ok: true },
        correlationId: randomUUID(),
      }),
    );
    const workerId = randomUUID();
    const claimed = await outbox.claimBatch(workerId, 10, 30);
    expect(claimed.map((event) => event.id)).toContain(eventId);
    await outbox.markPublished(eventId, workerId);
    expect(await prisma.outboxEvent.findUnique({ where: { id: eventId } })).toMatchObject({
      publishedAt: expect.any(Date),
      lockOwner: null,
    });
  });

  it("can durably enqueue and retrieve a BullMQ job through Redis", async () => {
    const queue = createQueue(`lottify.integration.${randomUUID()}`);
    const jobId = randomUUID();
    try {
      await queue.add("integration.probe", { ok: true }, { jobId });
      const job = await queue.getJob(jobId);
      expect(job?.data).toEqual({ ok: true });
      await job?.remove();
    } finally {
      await queue.close();
    }
  });
});
