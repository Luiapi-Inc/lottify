import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminMemberTermsController } from "../../apps/api/src/admin-member-terms.controller";
import { MemberProfileController } from "../../apps/api/src/member-profile.controller";
import { MemberTermsController } from "../../apps/api/src/member-terms.controller";
import { AdminAuthGuard } from "../../apps/api/src/admin-auth.guard";
import { AdminCapabilityGuard, ADMIN_CAPABILITIES_METADATA } from "../../apps/api/src/admin-capability.guard";
import { MemberAuthGuard } from "../../apps/api/src/member-auth.guard";
import { AdminAuthService } from "../../src/contexts/identity-access/application/admin-auth.service";
import { SessionService } from "../../src/contexts/identity-access/application/session.service";
import { ProfileService } from "../../src/contexts/member/application/profile.service";
import { TermsService } from "../../src/contexts/member/application/terms.service";

/**
 * Member onboarding contract (Ticket 10): a frontend must be able to rely on the
 * generated client, so every published route carries a declared success schema
 * (never `unknown`) and no persistence/entity internals leak into the contract.
 */
describe("Member onboarding API contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    @Module({
      controllers: [MemberTermsController, MemberProfileController, AdminMemberTermsController],
      providers: [
        Reflector,
        MemberAuthGuard,
        AdminAuthGuard,
        AdminCapabilityGuard,
        { provide: SessionService, useValue: {} },
        { provide: AdminAuthService, useValue: {} },
        { provide: TermsService, useValue: {} },
        { provide: ProfileService, useValue: {} },
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

  it("publishes the Member Terms and profile routes with declared success schemas", () => {
    const doc = document();
    const terms = doc.paths["/api/v1/member/terms"]?.get;
    const accept = doc.paths["/api/v1/member/terms/accept"]?.post;
    const profile = doc.paths["/api/v1/member/profile"]?.get;
    const patch = doc.paths["/api/v1/member/profile"]?.patch;

    expect(terms).toBeDefined();
    expect(accept).toBeDefined();
    expect(profile).toBeDefined();
    expect(patch).toBeDefined();

    expect(terms!.responses["200"]).toMatchObject({
      content: { "application/json": { schema: { $ref: expect.stringContaining("MemberTermsBody") } } },
    });
    expect(accept!.responses["200"]).toMatchObject({
      content: { "application/json": { schema: { $ref: expect.stringContaining("AcceptTermsBody") } } },
    });
    expect(profile!.responses["200"]).toMatchObject({
      content: { "application/json": { schema: { $ref: expect.stringContaining("MemberProfileBody") } } },
    });
    expect(patch!.responses["200"]).toMatchObject({
      content: { "application/json": { schema: { $ref: expect.stringContaining("MemberProfileBody") } } },
    });
  });

  it("publishes the Admin Terms governance routes with declared success schemas", () => {
    const doc = document();
    const created = doc.paths["/api/v1/admin/member-terms"]?.post;
    const list = doc.paths["/api/v1/admin/member-terms"]?.get;
    const detail = doc.paths["/api/v1/admin/member-terms/{id}"]?.get;
    const publish = doc.paths["/api/v1/admin/member-terms/{id}/publish"]?.post;
    const retire = doc.paths["/api/v1/admin/member-terms/{id}/retire"]?.post;

    expect(created!.responses["201"]).toMatchObject({
      content: { "application/json": { schema: { $ref: expect.stringContaining("TermsVersionBody") } } },
    });
    expect(list!.responses["200"]).toMatchObject({
      content: {
        "application/json": { schema: { $ref: expect.stringContaining("TermsVersionListBody") } },
      },
    });
    for (const operation of [detail, publish, retire]) {
      expect(operation).toBeDefined();
      expect(operation!.responses["200"]).toMatchObject({
        content: { "application/json": { schema: { $ref: expect.stringContaining("TermsVersionBody") } } },
      });
    }
    // No generic status mutation exists that could bypass the Terms lifecycle.
    expect(doc.paths["/api/v1/admin/member-terms/{id}"]?.patch).toBeUndefined();
  });

  it("requires authentication and an Idempotency-Key on every critical mutation", () => {
    const doc = document();
    const accept = doc.paths["/api/v1/member/terms/accept"]?.post;
    const created = doc.paths["/api/v1/admin/member-terms"]?.post;
    const publish = doc.paths["/api/v1/admin/member-terms/{id}/publish"]?.post;

    for (const operation of [accept, created, publish]) {
      expect(JSON.stringify(operation)).toContain("idempotency-key");
      expect(JSON.stringify(operation)).toContain("security");
    }
    // Discovering required Terms and reading the profile are plain authenticated reads.
    expect(JSON.stringify(doc.paths["/api/v1/member/terms"]?.get)).toContain("security");
    expect(JSON.stringify(doc.paths["/api/v1/member/profile"]?.get)).toContain("security");
  });

  it("gates Terms publication behind the dedicated Admin capability", () => {
    const required = (handler: object) =>
      Reflect.getMetadata(ADMIN_CAPABILITIES_METADATA, handler) as string[] | undefined;
    expect(required(AdminMemberTermsController.prototype.createVersion)).toEqual([
      "member-terms.manage",
    ]);
    expect(required(AdminMemberTermsController.prototype.publish)).toEqual([
      "member-terms.approve",
    ]);
    expect(required(AdminMemberTermsController.prototype.retire)).toEqual(["member-terms.manage"]);
    expect(required(AdminMemberTermsController.prototype.list)).toEqual(["member-terms.read"]);
  });

  it("never leaks persistence or entity internals into the contract", () => {
    const names = Object.keys(document().components?.schemas ?? {});
    const leaked = names.filter((name) =>
      /member_terms|terms_document|terms_acceptance|profile_service|prisma|_repository/i.test(name),
    );
    expect(leaked).toEqual([]);
    const body = document().components?.schemas?.MemberTermsBody as
      | { properties?: Record<string, unknown> }
      | undefined;
    expect(body?.properties?.required).toBeTruthy();
    expect(body?.properties?.acceptances).toBeTruthy();
    expect(body?.properties?.satisfied).toBeTruthy();
  });
});
