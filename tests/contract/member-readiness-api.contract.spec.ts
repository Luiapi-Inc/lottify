import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminMemberCapabilityRestrictionController } from "../../apps/api/src/admin-member-capability-restriction.controller";
import { MemberReadinessController } from "../../apps/api/src/member-readiness.controller";
import { AdminAuthGuard } from "../../apps/api/src/admin-auth.guard";
import { AdminCapabilityGuard, ADMIN_CAPABILITIES_METADATA } from "../../apps/api/src/admin-capability.guard";
import { MemberAuthGuard } from "../../apps/api/src/member-auth.guard";
import { SessionService } from "../../src/contexts/identity-access/application/session.service";
import { AdminAuthService } from "../../src/contexts/identity-access/application/admin-auth.service";
import { EligibilityService } from "../../src/contexts/kyc-risk/application/eligibility.service";
import { CapabilityRestrictionAdminService } from "../../src/contexts/member/application/capability-restriction-admin.service";

/**
 * Member readiness + KYC eligibility contract (Ticket 10): the frontend must be
 * able to rely on the generated client, so every published route carries a
 * declared success schema (never `unknown`) and no persistence/entity internals
 * leak into the contract.
 */
describe("Member readiness API contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    @Module({
      controllers: [MemberReadinessController, AdminMemberCapabilityRestrictionController],
      providers: [
        Reflector,
        MemberAuthGuard,
        AdminAuthGuard,
        AdminCapabilityGuard,
        { provide: SessionService, useValue: {} },
        { provide: AdminAuthService, useValue: {} },
        { provide: EligibilityService, useValue: {} },
        { provide: CapabilityRestrictionAdminService, useValue: {} },
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

  it("publishes the Member readiness route with a declared success schema", () => {
    const doc = document();
    const readiness = doc.paths["/api/v1/member/readiness"]?.get;
    expect(readiness).toBeDefined();
    expect(readiness!.responses["200"]).toMatchObject({
      content: { "application/json": { schema: { $ref: expect.stringContaining("MemberReadinessBody") } } },
    });
    const schema = doc.components?.schemas?.MemberReadinessBody as
      | { properties?: Record<string, unknown> }
      | undefined;
    expect(schema?.properties?.capabilities).toBeTruthy();
    expect(schema?.properties?.requirements).toBeTruthy();
    expect(schema?.properties?.policyVersion).toBeTruthy();
  });

  it("publishes the Admin capability-restriction routes with declared success schemas", () => {
    const doc = document();
    const create = doc.paths["/api/v1/admin/member-capability-restrictions"]?.post;
    const clear = doc.paths["/api/v1/admin/member-capability-restrictions/{id}"]?.delete;
    expect(create).toBeDefined();
    expect(clear).toBeDefined();
    expect(create!.responses["201"]).toMatchObject({
      content: { "application/json": { schema: { $ref: expect.stringContaining("CapabilityRestrictionBody") } } },
    });
    expect(clear!.responses["200"]).toMatchObject({
      content: { "application/json": { schema: { $ref: expect.stringContaining("ClearRestrictionBody") } } },
    });
  });

  it("requires authentication and an Idempotency-Key on every critical mutation", () => {
    const doc = document();
    const readiness = doc.paths["/api/v1/member/readiness"]?.get;
    const create = doc.paths["/api/v1/admin/member-capability-restrictions"]?.post;
    const clear = doc.paths["/api/v1/admin/member-capability-restrictions/{id}"]?.delete;
    // Reads are authenticated; the Admin mutations are idempotent + authenticated.
    expect(JSON.stringify(readiness)).toContain("security");
    for (const operation of [create, clear]) {
      expect(JSON.stringify(operation)).toContain("idempotency-key");
      expect(JSON.stringify(operation)).toContain("security");
    }
  });

  it("gates Admin restriction mutations behind the dedicated Admin capability", () => {
    const required = (handler: object) =>
      Reflect.getMetadata(ADMIN_CAPABILITIES_METADATA, handler) as string[] | undefined;
    expect(required(AdminMemberCapabilityRestrictionController.prototype.setRestriction)).toEqual([
      "member-readiness.manage",
    ]);
    expect(required(AdminMemberCapabilityRestrictionController.prototype.clearRestriction)).toEqual([
      "member-readiness.manage",
    ]);
  });

  it("never leaks persistence or entity internals into the contract", () => {
    const names = Object.keys(document().components?.schemas ?? {});
    const leaked = names.filter((name) =>
      /capability_restriction|verification_record|kyc_status|prisma|_repository|eligibility_service/i.test(name),
    );
    expect(leaked).toEqual([]);
  });
});
