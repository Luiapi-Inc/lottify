import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Reflector } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemberPromotionController } from "../../apps/api/src/member-promotion.controller";
import { MemberNotificationPreferenceController } from "../../apps/api/src/member-notification-preference.controller";
import { AdminPromotionController } from "../../apps/api/src/admin-promotion.controller";
import { AdminAuthGuard } from "../../apps/api/src/admin-auth.guard";
import { MemberAuthGuard } from "../../apps/api/src/member-auth.guard";
import { AdminCapabilityGuard } from "../../apps/api/src/admin-capability.guard";
import { PromotionCampaignService } from "../../src/contexts/promotion/application/promotion-campaign.service";
import { PromotionEntitlementService } from "../../src/contexts/promotion/application/promotion-entitlement.service";
import { NotificationPreferenceService } from "../../src/contexts/promotion/application/notification-preference.service";
import { AdminAuthService } from "../../src/contexts/identity-access/application/admin-auth.service";
import { SessionService } from "../../src/contexts/identity-access/application/session.service";

describe("Promotion API contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    @Module({
      controllers: [
        MemberPromotionController,
        MemberNotificationPreferenceController,
        AdminPromotionController,
      ],
      providers: [
        Reflector,
        MemberAuthGuard,
        AdminAuthGuard,
        AdminCapabilityGuard,
        { provide: SessionService, useValue: {} },
        { provide: AdminAuthService, useValue: {} },
        { provide: PromotionCampaignService, useValue: {} },
        { provide: PromotionEntitlementService, useValue: {} },
        { provide: NotificationPreferenceService, useValue: {} },
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

  it("publishes the Member Promotion and notification preference resource paths", () => {
    const paths = document().paths;
    expect(paths["/api/v1/member/promotions"]?.get).toBeDefined();
    expect(paths["/api/v1/member/promotions/entitlements"]?.get).toBeDefined();
    expect(paths["/api/v1/member/promotions/entitlements"]?.post).toBeDefined();
    expect(paths["/api/v1/member/promotions/entitlements/{id}"]?.get).toBeDefined();
    expect(paths["/api/v1/member/notification-preferences"]?.get).toBeDefined();
    expect(paths["/api/v1/member/notification-preferences"]?.put).toBeDefined();
  });

  it("publishes the Admin Promotion governance paths with explicit command endpoints", () => {
    const paths = document().paths;
    expect(paths["/api/v1/admin/promotions"]?.post).toBeDefined();
    expect(paths["/api/v1/admin/promotions"]?.get).toBeDefined();
    expect(paths["/api/v1/admin/promotions/{id}"]?.get).toBeDefined();
    expect(paths["/api/v1/admin/promotions/{id}/validate"]?.post).toBeDefined();
    expect(paths["/api/v1/admin/promotions/{id}/preview"]?.post).toBeDefined();
    expect(paths["/api/v1/admin/promotions/{id}/approve"]?.post).toBeDefined();
    expect(paths["/api/v1/admin/promotions/{id}/retire"]?.post).toBeDefined();
    // No generic status mutation can bypass the Promotion lifecycle guards.
    expect(paths["/api/v1/admin/promotions/{id}"]?.patch).toBeUndefined();
  });

  it("requires authentication and an Idempotency-Key on the critical Promotion mutations", () => {
    const document_ = document();
    const claim = document_.paths["/api/v1/member/promotions/entitlements"]?.post;
    const approve = document_.paths["/api/v1/admin/promotions/{id}/approve"]?.post;
    const created = document_.paths["/api/v1/admin/promotions"]?.post;
    expect(JSON.stringify(claim)).toContain("idempotency-key");
    expect(JSON.stringify(approve)).toContain("idempotency-key");
    expect(JSON.stringify(created)).toContain("idempotency-key");
    expect(JSON.stringify(claim)).toContain("security");
  });

  it("uses canonical integer-minor money and never leaks persistence internals", () => {
    const document_ = document();
    const schemaNames = Object.keys(document_.components?.schemas ?? {});
    const entitlement = document_.components?.schemas?.PromotionEntitlementBody as
      | { properties?: Record<string, unknown> }
      | undefined;
    const discovery = document_.components?.schemas?.PromotionDiscoveryItemBody as
      | { properties?: Record<string, unknown> }
      | undefined;
    expect(entitlement?.properties?.rewardMinor).toBeTruthy();
    expect(entitlement?.properties?.turnover).toBeTruthy();
    expect(discovery?.properties?.turnoverTargetMinor).toBeTruthy();
    const leaked = schemaNames.filter((name) =>
      /promotion_entitlement|promotion_turnover|notification_preference|_repository/i.test(name),
    );
    expect(leaked).toEqual([]);
  });
});
