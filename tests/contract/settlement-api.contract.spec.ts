import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemberSettlementController } from "../../apps/api/src/member-settlement.controller";
import { AdminResultSettlementController } from "../../apps/api/src/admin-result-settlement.controller";
import { AdminAuthGuard } from "../../apps/api/src/admin-auth.guard";
import { AdminCapabilityGuard } from "../../apps/api/src/admin-capability.guard";
import { MemberAuthGuard } from "../../apps/api/src/member-auth.guard";
import { AdminAuthService } from "../../src/contexts/identity-access/application/admin-auth.service";
import { SessionService } from "../../src/contexts/identity-access/application/session.service";
import { SettlementService } from "../../src/contexts/result-settlement/application/settlement.service";

describe("Result & Settlement API contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    @Module({
      controllers: [MemberSettlementController, AdminResultSettlementController],
      providers: [
        MemberAuthGuard,
        AdminAuthGuard,
        AdminCapabilityGuard,
        {
          provide: SessionService,
          useValue: {
            authenticateAccess: async () => ({ memberId: "m", sessionId: "s", deviceId: null }),
          },
        },
        {
          provide: AdminAuthService,
          useValue: {
            authenticateAccess: async () => ({ adminId: "a", sessionId: "s", role: "ADMIN", capabilities: [] }),
          },
        },
        { provide: SettlementService, useValue: {} },
      ],
    })
    class ContractModule {}

    app = await NestFactory.create(ContractModule, { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("publishes the Member settlement-outcome read with bearer auth", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").addBearerAuth().build(),
    );
    const read = document.paths["/api/v1/member/orders/{id}/settlement"]?.get;
    expect(read).toBeDefined();
    expect(read?.security).toEqual([{ bearer: [] }]);
  });

  it("exposes explicit Admin Result/Settlement command and read surfaces under /api/v1/admin", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").addBearerAuth().build(),
    );
    expect(document.paths["/api/v1/admin/draws/{drawId}/result"]?.post).toBeDefined();
    expect(document.paths["/api/v1/admin/draws/{drawId}/result/ingest-from-provider"]?.post).toBeDefined();
    expect(document.paths["/api/v1/admin/draws/{drawId}/results/{revision}/confirm"]?.post).toBeDefined();
    expect(document.paths["/api/v1/admin/draws/{drawId}/results/{revision}/correct"]?.post).toBeDefined();
    expect(document.paths["/api/v1/admin/draws/{drawId}/settlement"]?.post).toBeDefined();
    expect(document.paths["/api/v1/admin/draws/{drawId}/settlement"]?.get).toBeDefined();
    expect(document.paths["/api/v1/admin/settlement/{batchId}/orders"]?.get).toBeDefined();
    // Invariant-bearing transitions are explicit commands, never generic PATCH.
    expect(document.paths["/api/v1/admin/draws/{drawId}/result"]?.patch).toBeUndefined();
    expect(document.paths["/api/v1/admin/draws/{drawId}/settlement"]?.patch).toBeUndefined();
  });

  it("does not leak persistence internals into the contract schemas", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").build(),
    );
    const schemaNames = Object.keys(document.components?.schemas ?? {});
    const leaked = schemaNames.filter((name) =>
      /idempotency_scope|idempotency_key|fingerprint|result_revisions|settlement_orders|settlement_batches|result_data|winning_numbers/i.test(
        name,
      ),
    );
    expect(leaked).toEqual([]);
  });
});
