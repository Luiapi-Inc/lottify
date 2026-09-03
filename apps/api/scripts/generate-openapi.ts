import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ApiModule } from "../src/app.module";

async function generate(): Promise<void> {
  const app = await NestFactory.create(ApiModule, { logger: false });
  await app.init();
  const config = new DocumentBuilder()
    .setTitle("Lottify v1 API")
    .setDescription("Authoritative REST/OpenAPI contract for Lottify v1")
    .setVersion("1.0.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  const outputDirectory = resolve(process.cwd(), "apps/api/openapi");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, "openapi.json"), `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await app.close();
}

void generate();
