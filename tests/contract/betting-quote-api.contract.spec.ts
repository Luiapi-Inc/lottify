import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemberQuoteController } from "../../apps/api/src/member-quote.controller";
import { MemberAuthGuard } from "../../apps/api/src/member-auth.guard";
import { SessionService } from "../../src/contexts/identity-access/application/session.service";
import { BettingQuoteService } from "../../src/contexts/betting/application/betting-quote.service";

describe("Betting Quote API contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    @Module({
      controllers: [MemberQuoteController],
      providers: [
        MemberAuthGuard,
        { provide: SessionService, useValue: { authenticateAccess: async () => ({ memberId: "m", sessionId: "s", deviceId: null }) } },
        { provide: BettingQuoteService, useValue: {} },
      ],
    })
    class ContractModule {}

    app = await NestFactory.create(ContractModule, { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("publishes the Member Quote create/read surface with bearer auth", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").addBearerAuth().build(),
    );
    const create = document.paths["/api/v1/member/draws/{drawId}/quotes"]?.post;
    expect(create).toBeDefined();
    expect(create?.security).toEqual([{ bearer: [] }]);
    expect(create?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "idempotency-key", in: "header", required: true }),
      ]),
    );
    const get = document.paths["/api/v1/member/quotes/{id}"]?.get;
    expect(get).toBeDefined();
    expect(get?.security).toEqual([{ bearer: [] }]);
  });

  it("does not leak Prisma persistence models into the contract schemas", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").build(),
    );
    const schemaNames = Object.keys(document.components?.schemas ?? {});
    const leaked = schemaNames.filter(
      (name) => /idempotency_scope|idempotency_key|fingerprint|request_payload|created_at/i.test(name),
    );
    expect(leaked).toEqual([]);
  });
});
