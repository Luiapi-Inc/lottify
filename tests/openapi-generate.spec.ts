import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiModule } from "../apps/api/src/app.module";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head"] as const;

type SuccessResponse = {
  content?: Record<string, { schema?: unknown }>;
};

describe("openapi spec generator (vitest boot)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    vi.stubEnv("APP_ENV", process.env.APP_ENV ?? "test");
    vi.stubEnv(
      "DATABASE_URL",
      process.env.DATABASE_URL ?? "postgresql://lottify:lottify@localhost:5432/lottify?schema=public",
    );
    vi.stubEnv("REDIS_URL", process.env.REDIS_URL ?? "redis://localhost:6379");
    vi.stubEnv(
      "JWT_ACCESS_SECRET",
      process.env.JWT_ACCESS_SECRET ?? "test-jwt-access-secret-at-least-32-characters",
    );
    app = await NestFactory.create(ApiModule, { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("writes apps/api/openapi/openapi.json", async () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle("Lottify v1 API")
        .setDescription("Authoritative REST/OpenAPI contract for Lottify v1")
        .setVersion("1.0.0")
        .addBearerAuth()
        .build(),
    );
    const outputDirectory = resolve(process.cwd(), "apps/api/openapi");
    await mkdir(outputDirectory, { recursive: true });
    const spec = `${JSON.stringify(document, null, 2)}\n`;
    await writeFile(resolve(outputDirectory, "openapi.json"), spec, "utf8");
    expect(spec).toContain("\"/api/v1/member/wallet\"");
    expect(spec).toContain("\"/api/v1/admin/draws\"");
    expect(spec).toContain("\"/api/v1/admin/draws/{id}\"");
    expect(spec).toContain("\"/api/v1/admin/draws/{id}/transition\"");
    expect(spec).toContain("\"/api/v1/admin/products/{productId}/draws/generate\"");
    expect(spec).toContain("\"/api/v1/member/draws/{id}\"");
    expect(spec).toContain("\"/api/v1/member/products/{productId}/draws\"");
    expect(spec).toContain("\"/api/v1/member/quotes/{quoteId}/orders\"");
    expect(spec).toContain("\"/api/v1/member/orders/{id}\"");
    expect(spec).toContain("\"/api/v1/member/orders/{id}/confirm\"");
    expect(spec).toContain("\"/api/v1/member/orders/{id}/cancel\"");
    expect(spec).toContain("\"/api/v1/member/orders/{id}/receipt\"");
    expect(spec).toContain("\"/api/v1/member/orders/{id}/settlement\"");
    expect(spec).toContain("\"/api/v1/member/auth/recovery/otp/request\"");
    expect(spec).toContain("\"/api/v1/member/auth/recovery/otp/verify\"");
    expect(spec).toContain("\"/api/v1/admin/draws/{drawId}/result\"");
    expect(spec).toContain("\"/api/v1/admin/draws/{drawId}/result/ingest-from-provider\"");
    expect(spec).toContain("\"/api/v1/admin/draws/{drawId}/results/{revision}/confirm\"");
    expect(spec).toContain("\"/api/v1/admin/draws/{drawId}/results/{revision}/correct\"");
    expect(spec).toContain("\"/api/v1/admin/draws/{drawId}/settlement\"");
    expect(spec).toContain("\"/api/v1/admin/settlement/{batchId}/orders\"");

    const missingSuccessSchemas: string[] = [];
    for (const [path, pathItem] of Object.entries(document.paths)) {
      if (!path.startsWith("/api/v1/member")) continue;
      for (const method of HTTP_METHODS) {
        const operation = pathItem?.[method] as
          | { responses?: Record<string, SuccessResponse> }
          | undefined;
        if (!operation) continue;
        const successes = Object.entries(operation.responses ?? {}).filter(([status]) =>
          /^2\d\d$/.test(status),
        );
        if (successes.length === 0) {
          missingSuccessSchemas.push(`${method.toUpperCase()} ${path}: no 2xx response`);
          continue;
        }
        for (const [status, response] of successes) {
          if (status === "204") continue;
          const schema = response.content?.["application/json"]?.schema;
          if (!schema) {
            missingSuccessSchemas.push(
              `${method.toUpperCase()} ${path}: ${status} has no application/json schema`,
            );
          }
        }
      }
    }
    expect(missingSuccessSchemas).toEqual([]);

    const recoveryVerification = document.components?.schemas
      ?.RecoveryOtpVerificationResponse as
      | { properties?: Record<string, unknown>; required?: string[] }
      | undefined;
    expect(recoveryVerification).toBeDefined();
    expect(Object.keys(recoveryVerification?.properties ?? {}).sort()).toEqual([
      "evidenceRef",
      "purpose",
      "verified",
    ]);
    expect(recoveryVerification?.required?.sort()).toEqual([
      "evidenceRef",
      "purpose",
      "verified",
    ]);

    // No persistence/entity internals leak into the generated contract.
    expect(spec.toLowerCase()).not.toMatch(/prisma|lottery_draw|lotteryDrawBetType|lotteryDrawOverride|result_revisions|settlement_orders/);
  });
});
