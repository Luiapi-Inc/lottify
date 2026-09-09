import "reflect-metadata";
import { type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiModule } from "../apps/api/src/app.module";

describe("openapi spec generator (vitest boot)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(ApiModule, { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
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
  });
});
