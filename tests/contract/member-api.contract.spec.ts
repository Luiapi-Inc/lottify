import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemberAuthController } from "../../apps/api/src/member-auth.controller";
import { MemberSessionDeviceController } from "../../apps/api/src/member-session-device.controller";
import { MemberAuthGuard } from "../../apps/api/src/member-auth.guard";
import { MemberAuthService } from "../../src/contexts/identity-access/application/member-auth.service";
import { SessionService } from "../../src/contexts/identity-access/application/session.service";

describe("Member API contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    @Module({
      controllers: [MemberAuthController, MemberSessionDeviceController],
      providers: [
        MemberAuthGuard,
        { provide: SessionService, useValue: {} },
        { provide: MemberAuthService, useValue: {} },
      ],
    })
    class ContractModule {}

    app = await NestFactory.create(ContractModule, { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("publishes the purpose-scoped OTP and session/device resource paths", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").addBearerAuth().build(),
    );
    expect(document.paths["/api/v1/member/auth/otp/request"]?.post).toBeDefined();
    expect(document.paths["/api/v1/member/auth/otp/verify"]?.post).toBeDefined();
    expect(document.paths["/api/v1/member/auth/refresh"]?.post).toBeDefined();
    expect(document.paths["/api/v1/member/auth/logout"]?.post).toBeDefined();
    expect(document.paths["/api/v1/member/auth/revoke-all"]?.post).toBeDefined();
    expect(document.paths["/api/v1/member/auth/me"]?.get).toBeDefined();
    expect(document.paths["/api/v1/member/sessions"]?.get).toBeDefined();
    expect(document.paths["/api/v1/member/sessions/{id}"]?.delete).toBeDefined();
    expect(document.paths["/api/v1/member/devices"]?.get).toBeDefined();
    expect(document.paths["/api/v1/member/devices/{id}"]?.delete).toBeDefined();
  });

  it("does not leak Prisma persistence models into the contract schemas", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").build(),
    );
    const schemaNames = Object.keys(document.components?.schemas ?? {});
    const leaked = schemaNames.filter(
      (name) => /member_device|otp_challenge|refresh_token_hash|code_hash/i.test(name),
    );
    expect(leaked).toEqual([]);
  });
});
