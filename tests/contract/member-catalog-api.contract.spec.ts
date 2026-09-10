import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MemberCatalogController } from "../../apps/api/src/member-catalog.controller";
import { MemberAuthGuard } from "../../apps/api/src/member-auth.guard";
import { SessionService } from "../../src/contexts/identity-access/application/session.service";
import { LotteryConfigurationService } from "../../src/contexts/lottery/application/lottery-configuration.service";

/**
 * The Member catalog contract: a frontend must be able to rely on the
 * generated client, so every published discovery route must carry a declared
 * success response schema (never `unknown`).
 */
describe("Member catalog API contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    @Module({
      controllers: [MemberCatalogController],
      providers: [
        MemberAuthGuard,
        { provide: SessionService, useValue: { authenticateAccess: vi.fn() } },
        { provide: LotteryConfigurationService, useValue: {} },
      ],
    })
    class ContractModule {}

    app = await NestFactory.create(ContractModule, { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function document() {
    return SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").addBearerAuth().build(),
    );
  }

  it("publishes the Member product discovery routes with declared response schemas", () => {
    const doc = document();
    const list = doc.paths["/api/v1/member/products"]?.get;
    const detail = doc.paths["/api/v1/member/products/{id}"]?.get;
    expect(list).toBeDefined();
    expect(detail).toBeDefined();
    expect(list!.responses["200"]).toMatchObject({
      content: {
        "application/json": {
          schema: { $ref: expect.stringContaining("MemberProductPageBody") },
        },
      },
    });
    expect(detail!.responses["200"]).toMatchObject({
      content: {
        "application/json": {
          schema: { $ref: expect.stringContaining("MemberProductDetailBody") },
        },
      },
    });
  });

  it("publishes the Member Bet Type discovery routes with declared response schemas", () => {
    const doc = document();
    const list = doc.paths["/api/v1/member/bet-types"]?.get;
    const detail = doc.paths["/api/v1/member/bet-types/{id}"]?.get;
    expect(list).toBeDefined();
    expect(detail).toBeDefined();
    expect(list!.responses["200"]).toMatchObject({
      content: {
        "application/json": {
          schema: { $ref: expect.stringContaining("MemberBetTypePageBody") },
        },
      },
    });
    expect(detail!.responses["200"]).toMatchObject({
      content: {
        "application/json": {
          schema: { $ref: expect.stringContaining("MemberBetTypeDetailBody") },
        },
      },
    });
  });

  it("requires Member bearer authentication on every discovery route", () => {
    const doc = document();
    for (const path of [
      "/api/v1/member/products",
      "/api/v1/member/products/{id}",
      "/api/v1/member/bet-types",
      "/api/v1/member/bet-types/{id}",
    ]) {
      // @ApiBearerAuth() marks the operation as secured.
      expect(doc.paths[path]?.get?.security).toBeDefined();
    }
  });

  it("exposes pagination query parameters on the list routes only", () => {
    const doc = document();
    const listNames = (doc.paths["/api/v1/member/products"]?.get?.parameters ?? []).map(
      (p) => (p as { name: string }).name,
    );
    expect(listNames).toContain("limit");
    expect(listNames).toContain("cursor");
    const detailNames = (
      doc.paths["/api/v1/member/products/{id}"]?.get?.parameters ?? []
    ).map((p) => (p as { name: string }).name);
    expect(detailNames).not.toContain("limit");
  });
});
