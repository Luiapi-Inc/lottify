import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemberWalletController } from "../../apps/api/src/member-wallet.controller";
import { MemberDepositController } from "../../apps/api/src/member-deposit.controller";
import { MemberAuthGuard } from "../../apps/api/src/member-auth.guard";
import { MemberWalletService } from "../../src/contexts/wallet-ledger/application/member-wallet.service";
import { DepositService } from "../../src/contexts/payments/application/deposit.service";
import { SessionService } from "../../src/contexts/identity-access/application/session.service";

describe("Member Wallet & Deposit API contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    @Module({
      controllers: [MemberWalletController, MemberDepositController],
      providers: [
        MemberAuthGuard,
        { provide: SessionService, useValue: {} },
        { provide: MemberWalletService, useValue: {} },
        { provide: DepositService, useValue: {} },
      ],
    })
    class ContractModule {}

    app = await NestFactory.create(ContractModule, { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("publishes the Member Wallet and Deposit resource paths", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").addBearerAuth().build(),
    );
    expect(document.paths["/api/v1/member/wallet"]?.get).toBeDefined();
    expect(document.paths["/api/v1/member/wallet/transactions"]?.get).toBeDefined();
    expect(document.paths["/api/v1/member/deposits"]?.post).toBeDefined();
    expect(document.paths["/api/v1/member/deposits/{id}"]?.get).toBeDefined();
    expect(document.paths["/api/v1/member/deposits/{id}/reconcile"]?.post).toBeDefined();
  });

  it("uses canonical integer-minor money and never leaks Prisma persistence internals into the contract", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").addBearerAuth().build(),
    );
    const schemaNames = Object.keys(document.components?.schemas ?? {});
    const depositBody = document.components?.schemas?.DepositBody as
      | { properties?: Record<string, unknown> }
      | undefined;
    const walletBalanceBody = document.components?.schemas?.WalletBalanceBody as
      | { properties?: Record<string, unknown> }
      | undefined;
    expect(depositBody?.properties?.amountMinor).toBeTruthy();
    expect(walletBalanceBody?.properties?.buckets).toBeTruthy();
    const leaked = schemaNames.filter((name) =>
      /payment_deposit|deposit_repository|ledger_account|ledger_posting|bucket_repo/i.test(name),
    );
    expect(leaked).toEqual([]);
  });
});