import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemberOrderController } from "../../apps/api/src/member-order.controller";
import { MemberAuthGuard } from "../../apps/api/src/member-auth.guard";
import { SessionService } from "../../src/contexts/identity-access/application/session.service";
import { BettingOrderService } from "../../src/contexts/betting/application/betting-order.service";

describe("Bet Order API contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    @Module({
      controllers: [MemberOrderController],
      providers: [
        MemberAuthGuard,
        { provide: SessionService, useValue: { authenticateAccess: async () => ({ memberId: "m", sessionId: "s", deviceId: null }) } },
        { provide: BettingOrderService, useValue: {} },
      ],
    })
    class ContractModule {}

    app = await NestFactory.create(ContractModule, { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("publishes the Member Bet Order create/read/command/receipt surface with bearer auth", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").addBearerAuth().build(),
    );

    const create = document.paths["/api/v1/member/quotes/{quoteId}/orders"]?.post;
    expect(create).toBeDefined();
    expect(create?.security).toEqual([{ bearer: [] }]);
    expect(create?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "idempotency-key", in: "header", required: true }),
      ]),
    );

    const read = document.paths["/api/v1/member/orders/{id}"]?.get;
    expect(read).toBeDefined();
    expect(read?.security).toEqual([{ bearer: [] }]);

    for (const command of ["confirm", "cancel"]) {
      const path = document.paths[`/api/v1/member/orders/{id}/${command}`]?.post;
      expect(path, command).toBeDefined();
      expect(path?.security).toEqual([{ bearer: [] }]);
      expect(path?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "idempotency-key", in: "header", required: true }),
        ]),
      );
    }

    const receipt = document.paths["/api/v1/member/orders/{id}/receipt"]?.get;
    expect(receipt).toBeDefined();
    expect(receipt?.security).toEqual([{ bearer: [] }]);
  });

  it("exposes explicit commands only: no generic status mutation on a Bet Order", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").build(),
    );
    // A Bet Order is never advanced by a generic status write.
    expect(document.paths["/api/v1/member/orders/{id}"]?.patch).toBeUndefined();
    expect(document.paths["/api/v1/member/orders/{id}"]?.put).toBeUndefined();
  });

  it("does not leak Prisma persistence models into the contract schemas", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").build(),
    );
    const schemaNames = Object.keys(document.components?.schemas ?? {});
    const leaked = schemaNames.filter((name) =>
      /idempotency_scope|idempotency_key|fingerprint|terms_canonical|content_digest|created_at|stake_transaction_id/i.test(
        name,
      ),
    );
    expect(leaked).toEqual([]);
  });
});
