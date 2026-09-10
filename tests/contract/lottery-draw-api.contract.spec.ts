import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AdminDrawController } from "../../apps/api/src/admin-draw.controller";
import { MemberDrawController } from "../../apps/api/src/member-draw.controller";
import { AdminAuthGuard } from "../../apps/api/src/admin-auth.guard";
import { AdminCapabilityGuard } from "../../apps/api/src/admin-capability.guard";
import { MemberAuthGuard } from "../../apps/api/src/member-auth.guard";
import { AdminAuthService } from "../../src/contexts/identity-access/application/admin-auth.service";
import { SessionService } from "../../src/contexts/identity-access/application/session.service";
import { LotteryDrawService } from "../../src/contexts/lottery/application/lottery-draw.service";
import { IdempotencyService } from "../../src/platform/idempotency/idempotency.service";

describe("Lottery Draw API contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    @Module({
      controllers: [AdminDrawController, MemberDrawController],
      providers: [
        AdminAuthGuard,
        AdminCapabilityGuard,
        MemberAuthGuard,
        { provide: AdminAuthService, useValue: { authenticateAccess: vi.fn() } },
        { provide: SessionService, useValue: { authenticateAccess: vi.fn() } },
        { provide: LotteryDrawService, useValue: {} },
        { provide: IdempotencyService, useValue: {} },
      ],
    })
    class ContractModule {}

    app = await NestFactory.create(ContractModule, { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("publishes the Admin draw management surface with bearer auth and capability guards", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").addBearerAuth().build(),
    );
    expect(document.paths["/api/v1/admin/draws"]?.get).toBeDefined();
    expect(document.paths["/api/v1/admin/draws/{id}"]?.get).toBeDefined();
    expect(document.paths["/api/v1/admin/draws/{id}/transition"]?.post).toBeDefined();
    expect(document.paths["/api/v1/admin/draws/{id}/override"]?.post).toBeDefined();

    const generate = document.paths["/api/v1/admin/products/{productId}/draws/generate"]?.post;
    expect(generate).toBeDefined();
    expect(generate?.security).toEqual([{ bearer: [] }]);
    expect(generate?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Idempotency-Key", in: "header", required: true }),
      ]),
    );
  });

  it("publishes the Member draw discovery surface as read-only", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").addBearerAuth().build(),
    );
    expect(document.paths["/api/v1/member/products/{productId}/draws"]?.get).toBeDefined();
    expect(document.paths["/api/v1/member/draws/{id}"]?.get).toBeDefined();
    expect(document.paths["/api/v1/member/draws/{id}/eligibility"]?.get).toBeDefined();
    // Member discovery exposes no mutation surface.
    for (const path of Object.keys(document.paths)) {
      if (path.startsWith("/api/v1/member/products/{productId}/draws") || path === "/api/v1/member/draws/{id}") {
        expect(document.paths[path]?.post).toBeUndefined();
      }
    }
  });
});
