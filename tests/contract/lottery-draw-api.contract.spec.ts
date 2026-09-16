import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
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
import {
  DrawCancellationOrchestrator,
  type CompleteDrawCancellationResult,
} from "../../src/contexts/lottery/application/draw-cancellation-orchestrator";
import { DrawRefundError } from "../../src/contexts/lottery/application/draw-refund.port";
import { IdempotencyService } from "../../src/platform/idempotency/idempotency.service";

/**
 * The COMPLETE_CANCELLATION HTTP contract (Issue 117 rework, Ticket 16).
 *
 * This suite owns the *published shape* of the Admin Draw transition route and
 * the mapping of the cancellation orchestrator's refusals onto HTTP. It runs
 * without a database on purpose: the domain behaviour is proved against real
 * PostgreSQL by tests/integration/admin-draw-cancellation-api.integration.spec.ts
 * and tests/integration/draw-confirm-cancel-race.integration.spec.ts, while this
 * file pins what an API consumer actually sees (status, envelope, field types).
 */
describe("Lottery Draw API contract", () => {
  let app: INestApplication;
  let baseUrl: string;
  const completeDrawCancellation = vi.fn();

  const adminActor = {
    adminId: "contract-admin",
    sessionId: "contract-session",
    email: "contract-admin@example.test",
    name: "Contract Admin",
    role: "ADMIN" as const,
    capabilities: ["lottery-draw.manage", "lottery-draw.read"] as const,
    mfaVerifiedAt: new Date("2026-09-16T00:00:00.000Z"),
  };

  const cancellationResult: CompleteDrawCancellationResult = {
    draw: { id: "draw-contract", state: "CANCELLED", version: 5 },
    refund: {
      considered: 2,
      refunded: 2,
      alreadyRefunded: 0,
      outstanding: 0,
      refundedStakeMinor: 600n,
      obligationsSatisfied: true,
    },
  };

  beforeAll(async () => {
    @Module({
      controllers: [AdminDrawController, MemberDrawController],
      providers: [
        AdminAuthGuard,
        AdminCapabilityGuard,
        MemberAuthGuard,
        {
          provide: AdminAuthService,
          useValue: { authenticateAccess: vi.fn(async () => adminActor) },
        },
        { provide: SessionService, useValue: { authenticateAccess: vi.fn() } },
        { provide: LotteryDrawService, useValue: {} },
        { provide: DrawCancellationOrchestrator, useValue: { completeDrawCancellation } },
        { provide: IdempotencyService, useValue: {} },
        { provide: Reflector, useValue: new Reflector() },
      ],
    })
    class ContractModule {}

    app = await NestFactory.create(ContractModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
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

  function transition(accessToken: string | null, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/api/v1/admin/draws/draw-contract/transition`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it("publishes the Admin draw management surface with bearer auth and capability guards", () => {
    const spec = document();
    expect(spec.paths["/api/v1/admin/draws"]?.get).toBeDefined();
    expect(spec.paths["/api/v1/admin/draws/{id}"]?.get).toBeDefined();
    expect(spec.paths["/api/v1/admin/draws/{id}/transition"]?.post).toBeDefined();
    expect(spec.paths["/api/v1/admin/draws/{id}/override"]?.post).toBeDefined();

    const generate = spec.paths["/api/v1/admin/products/{productId}/draws/generate"]?.post;
    expect(generate).toBeDefined();
    expect(generate?.security).toEqual([{ bearer: [] }]);
    expect(generate?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Idempotency-Key", in: "header", required: true }),
      ]),
    );
  });

  it("requires bearer security and the lifecycle request schema on the transition surface", () => {
    const spec = document();
    const transitionPath = spec.paths["/api/v1/admin/draws/{id}/transition"]?.post;
    expect(transitionPath).toBeDefined();
    expect(transitionPath?.security).toEqual([{ bearer: [] }]);
    expect(transitionPath?.requestBody).toMatchObject({
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/TransitionBody" },
        },
      },
    });

    const schema = spec.components?.schemas?.TransitionBody as {
      required?: string[];
      properties?: Record<string, { enum?: string[]; type?: string }>;
    };
    expect(schema?.required).toEqual(["command", "expectedVersion"]);
    // COMPLETE_CANCELLATION is a published, selectable command of this route.
    expect(schema?.properties?.command?.enum).toContain("COMPLETE_CANCELLATION");
    expect(schema?.properties?.command?.enum).toContain("REQUEST_CANCELLATION");
    expect(schema?.properties?.expectedVersion?.type).toBe("number");
  });

  it("returns the {draw, refund} cancellation result for COMPLETE_CANCELLATION over HTTP", async () => {
    completeDrawCancellation.mockReset();
    completeDrawCancellation.mockResolvedValueOnce(cancellationResult);

    const response = await transition("contract-token", {
      command: "COMPLETE_CANCELLATION",
      expectedVersion: 4,
    });

    expect(response.status).toBe(201);
    // Money is a minor-unit string at the HTTP boundary, like every other
    // Lottify amount (a bare bigint cannot be serialised as JSON).
    expect(await response.json()).toEqual({
      draw: { id: "draw-contract", state: "CANCELLED", version: 5 },
      refund: {
        considered: 2,
        refunded: 2,
        alreadyRefunded: 0,
        outstanding: 0,
        refundedStakeMinor: "600",
        obligationsSatisfied: true,
      },
    });
    expect(completeDrawCancellation).toHaveBeenCalledWith({
      drawId: "draw-contract",
      expectedVersion: 4,
      actor: adminActor,
    });
  });

  it("maps outstanding refund obligations to 409 REFUND_OBLIGATIONS_OUTSTANDING", async () => {
    completeDrawCancellation.mockReset();
    completeDrawCancellation.mockRejectedValueOnce(
      new DrawRefundError(
        "REFUND_OBLIGATIONS_OUTSTANDING",
        "Draw draw-contract still has 2 unrefunded committed stake(s)",
        409,
        { drawId: "draw-contract", outstanding: 2 },
      ),
    );

    const response = await transition("contract-token", {
      command: "COMPLETE_CANCELLATION",
      expectedVersion: 4,
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "REFUND_OBLIGATIONS_OUTSTANDING",
      details: { drawId: "draw-contract", outstanding: 2 },
      correlationId: expect.any(String),
    });
  });

  it("refuses an unauthenticated transition and an invalid lifecycle body", async () => {
    completeDrawCancellation.mockReset();

    const unauthenticated = await transition(null, {
      command: "COMPLETE_CANCELLATION",
      expectedVersion: 4,
    });
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });

    const invalid = await transition("contract-token", {
      command: "NOT_A_DRAW_COMMAND",
      expectedVersion: 4,
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      details: { field: "command" },
    });

    const missingVersion = await transition("contract-token", {
      command: "COMPLETE_CANCELLATION",
    });
    expect(missingVersion.status).toBe(400);
    expect(await missingVersion.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      details: { field: "expectedVersion" },
    });

    // No refused request reached the cancellation orchestrator.
    expect(completeDrawCancellation).not.toHaveBeenCalled();
  });

  it("publishes the Member draw discovery surface as read-only", () => {
    const spec = document();
    expect(spec.paths["/api/v1/member/products/{productId}/draws"]?.get).toBeDefined();
    expect(spec.paths["/api/v1/member/draws/{id}"]?.get).toBeDefined();
    expect(spec.paths["/api/v1/member/draws/{id}/eligibility"]?.get).toBeDefined();
    // Member discovery exposes no mutation surface.
    for (const path of Object.keys(spec.paths)) {
      if (path.startsWith("/api/v1/member/products/{productId}/draws") || path === "/api/v1/member/draws/{id}") {
        expect(spec.paths[path]?.post).toBeUndefined();
      }
    }
  });
});
