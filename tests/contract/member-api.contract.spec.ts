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
    expect(document.paths["/api/v1/member/auth/recovery/otp/request"]?.post).toBeDefined();
    expect(document.paths["/api/v1/member/auth/recovery/otp/verify"]?.post).toBeDefined();
    expect(document.paths["/api/v1/member/auth/refresh"]?.post).toBeDefined();
    expect(document.paths["/api/v1/member/auth/logout"]?.post).toBeDefined();
    expect(document.paths["/api/v1/member/auth/revoke-all"]?.post).toBeDefined();
    expect(document.paths["/api/v1/member/auth/me"]?.get).toBeDefined();
    expect(document.paths["/api/v1/member/sessions"]?.get).toBeDefined();
    expect(document.paths["/api/v1/member/sessions/{id}"]?.delete).toBeDefined();
    expect(document.paths["/api/v1/member/devices"]?.get).toBeDefined();
    expect(document.paths["/api/v1/member/devices/{id}"]?.delete).toBeDefined();
  });

  it("publishes RECOVERY OTP as possession evidence without a session response", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").build(),
    );
    const schema = document.components?.schemas?.RecoveryOtpVerificationResponse as
      | { properties?: Record<string, unknown> }
      | undefined;
    expect(schema).toBeDefined();
    expect(Object.keys(schema?.properties ?? {})).toEqual(
      expect.arrayContaining(["purpose", "verified", "evidenceRef"]),
    );
    expect(Object.keys(schema?.properties ?? {})).not.toContain("accessToken");
    expect(Object.keys(schema?.properties ?? {})).not.toContain("refreshToken");
    expect(Object.keys(schema?.properties ?? {})).not.toContain("memberId");
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

  it("publishes the CR #141 password login, enrollment and reset contract", () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").addBearerAuth().build(),
    );

    const login = document.paths["/api/v1/member/auth/login"]?.post;
    expect(login).toBeDefined();
    expect(document.paths["/api/v1/member/auth/password/reset"]?.post).toBeDefined();
    expect(login!.responses["200"]).toMatchObject({
      content: {
        "application/json": { schema: { $ref: expect.stringContaining("MemberLoginResponse") } },
      },
    });

    const schemas = document.components?.schemas ?? {};
    const loginBody = schemas.MemberLoginBody as
      | { properties?: Record<string, unknown>; required?: string[] }
      | undefined;
    expect(Object.keys(loginBody?.properties ?? {}).sort()).toEqual([
      "deviceName",
      "password",
      "phone",
    ]);

    // CR #141 retires LOGIN as an OTP purpose and requires a password for the
    // remaining purposes: registering creates the credential, enrolling sets one.
    const verifyBody = schemas.OtpVerifyBody as
      | { properties?: { purpose?: { enum?: string[] } }; required?: string[] }
      | undefined;
    expect(verifyBody?.properties?.purpose?.enum).toEqual(["REGISTER", "PASSWORD_ENROLL"]);
    expect(Object.keys(verifyBody?.properties ?? {})).toContain("password");
    expect(verifyBody?.required ?? []).toContain("password");

    // The enrollment answer carries no session: OTP is not a login channel.
    const enroll = schemas.PasswordEnrollResponse as
      | { properties?: Record<string, unknown> }
      | undefined;
    expect(Object.keys(enroll?.properties ?? {})).toEqual(
      expect.arrayContaining(["purpose", "memberId", "passwordSet", "passwordUpdatedAt"]),
    );
    for (const forbidden of ["accessToken", "refreshToken", "deviceId"]) {
      expect(Object.keys(enroll?.properties ?? {})).not.toContain(forbidden);
    }

    // No encoded credential field is ever part of the published contract.
    const published = JSON.stringify(document).toLowerCase();
    expect(published).not.toContain("passwordhash");
    expect(published).not.toContain("scrypt");
  });
});
