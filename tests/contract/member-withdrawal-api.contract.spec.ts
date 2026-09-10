import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminWithdrawalController } from "../../apps/api/src/admin-withdrawal.controller";
import { MemberPayoutDestinationController } from "../../apps/api/src/member-payout-destination.controller";
import { MemberWithdrawalController } from "../../apps/api/src/member-withdrawal.controller";
import { AdminAuthGuard } from "../../apps/api/src/admin-auth.guard";
import { AdminCapabilityGuard } from "../../apps/api/src/admin-capability.guard";
import { MemberAuthGuard } from "../../apps/api/src/member-auth.guard";
import { WithdrawalReviewService } from "../../apps/api/src/withdrawal-review.service";
import { SessionService } from "../../src/contexts/identity-access/application/session.service";
import { AdminAuthService } from "../../src/contexts/identity-access/application/admin-auth.service";
import { WithdrawalService } from "../../src/contexts/payments/application/withdrawal.service";
import { PayoutDestinationService } from "../../src/contexts/payments/application/payout-destination.service";
import { IdempotencyService } from "../../src/platform/idempotency/idempotency.service";

describe("Member Withdrawal & Payout Destination API contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    @Module({
      controllers: [
        MemberWithdrawalController,
        MemberPayoutDestinationController,
        AdminWithdrawalController,
      ],
      providers: [
        MemberAuthGuard,
        AdminAuthGuard,
        AdminCapabilityGuard,
        { provide: SessionService, useValue: {} },
        { provide: AdminAuthService, useValue: {} },
        { provide: WithdrawalService, useValue: {} },
        { provide: PayoutDestinationService, useValue: {} },
        { provide: WithdrawalReviewService, useValue: {} },
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

  function document() {
    return SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").addBearerAuth().build(),
    );
  }

  it("publishes the Member Payout Destination and Withdrawal resources", () => {
    const spec = document();
    expect(spec.paths["/api/v1/member/payout-destinations"]?.post).toBeDefined();
    expect(spec.paths["/api/v1/member/payout-destinations"]?.get).toBeDefined();
    expect(spec.paths["/api/v1/member/payout-destinations/{id}"]?.get).toBeDefined();
    expect(spec.paths["/api/v1/member/payout-destinations/{id}/verify"]?.post).toBeDefined();
    expect(spec.paths["/api/v1/member/withdrawals"]?.post).toBeDefined();
    expect(spec.paths["/api/v1/member/withdrawals/preflight"]?.post).toBeDefined();
    expect(spec.paths["/api/v1/member/withdrawals"]?.get).toBeDefined();
    expect(spec.paths["/api/v1/member/withdrawals/{id}"]?.get).toBeDefined();
    expect(spec.paths["/api/v1/member/withdrawals/{id}/cancel"]?.post).toBeDefined();
  });

  it("publishes the Admin withdrawal queue and the explicit governed commands", () => {
    const spec = document();
    expect(spec.paths["/api/v1/admin/withdrawals"]?.get).toBeDefined();
    expect(spec.paths["/api/v1/admin/withdrawals/{id}"]?.get).toBeDefined();
    expect(spec.paths["/api/v1/admin/withdrawals/{id}/approve"]?.post).toBeDefined();
    expect(spec.paths["/api/v1/admin/withdrawals/{id}/reject"]?.post).toBeDefined();
    expect(spec.paths["/api/v1/admin/withdrawals/{id}/payout"]?.post).toBeDefined();
    expect(spec.paths["/api/v1/admin/withdrawals/{id}/reconcile"]?.post).toBeDefined();
    expect(spec.paths["/api/v1/admin/withdrawals/{id}/finalize"]?.post).toBeDefined();
  });

  it("requires a scoped Idempotency-Key for withdrawal create and cancel", () => {
    const spec = document();
    const create = spec.paths["/api/v1/member/withdrawals"]?.post;
    const cancel = spec.paths["/api/v1/member/withdrawals/{id}/cancel"]?.post;
    const createHeader = (create?.parameters ?? []).find(
      (parameter) => "name" in parameter && parameter.name === "Idempotency-Key",
    );
    const cancelHeader = (cancel?.parameters ?? []).find(
      (parameter) => "name" in parameter && parameter.name === "Idempotency-Key",
    );
    expect(createHeader).toMatchObject({ required: true });
    expect(cancelHeader).toMatchObject({ required: true });
    expect(create?.responses["202"]).toBeDefined();
  });

  it("uses integer-minor money, exposes allowedActions, and never leaks persistence internals", () => {
    const spec = document();
    const schemaNames = Object.keys(spec.components?.schemas ?? {});
    const withdrawalBody = spec.components?.schemas?.WithdrawalBody as
      | { properties?: Record<string, unknown> }
      | undefined;
    const adminBody = spec.components?.schemas?.AdminWithdrawalBody as
      | { properties?: Record<string, unknown> }
      | undefined;
    expect(withdrawalBody?.properties?.amountMinor).toBeTruthy();
    expect(withdrawalBody?.properties?.allowedActions).toBeTruthy();
    expect(adminBody?.properties?.severity).toBeTruthy();
    expect(adminBody?.properties?.queue).toBeTruthy();
    const leaked = schemaNames.filter((name) =>
      /payment_withdrawal|payout_destination|withdrawal_repository|prisma/i.test(name),
    );
    expect(leaked).toEqual([]);
  });
});
