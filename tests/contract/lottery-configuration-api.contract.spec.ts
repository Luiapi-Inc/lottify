import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AdminLotteryConfigurationController } from "../../apps/api/src/admin-lottery-configuration.controller";
import { AdminAuthGuard } from "../../apps/api/src/admin-auth.guard";
import { AdminCapabilityGuard } from "../../apps/api/src/admin-capability.guard";
import { AdminAuthService } from "../../src/contexts/identity-access/application/admin-auth.service";
import { LotteryConfigurationService } from "../../src/contexts/lottery/application/lottery-configuration.service";
import { IdempotencyService } from "../../src/platform/idempotency/idempotency.service";

describe("Lottery configuration API contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    @Module({
      controllers: [AdminLotteryConfigurationController],
      providers: [
        AdminAuthGuard,
        AdminCapabilityGuard,
        { provide: AdminAuthService, useValue: { requireFreshMfa: vi.fn() } },
        { provide: IdempotencyService, useValue: {} },
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

  it("publishes authenticated command paths with required idempotency headers", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").addBearerAuth().build(),
    );
    const paths = [
      "/api/v1/admin/lottery/products",
      "/api/v1/admin/lottery/bet-types",
      "/api/v1/admin/lottery/bet-types/{id}/versions",
      "/api/v1/admin/lottery/products/{id}/versions",
      "/api/v1/admin/lottery/bet-type-versions/{id}/submit",
      "/api/v1/admin/lottery/product-versions/{id}/submit",
      "/api/v1/admin/lottery/bet-type-versions/{id}/approve",
      "/api/v1/admin/lottery/product-versions/{id}/approve",
    ];

    for (const path of paths) {
      const operation = document.paths[path]?.post;
      expect(operation, path).toBeDefined();
      expect(operation?.security).toEqual([{ bearer: [] }]);
      expect(operation?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "Idempotency-Key",
            in: "header",
            required: true,
          }),
        ]),
      );
    }

    expect(document.components?.schemas).toMatchObject({
      CreateBetTypeBody: expect.any(Object),
      CreateBetTypeVersionBody: expect.any(Object),
      CreateProductVersionBody: expect.any(Object),
      ExpectedVersionBody: expect.any(Object),
    });
  });
});
