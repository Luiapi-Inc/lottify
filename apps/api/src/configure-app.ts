import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

export function configureApp(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle("Lottify v1 API")
    .setDescription("Authoritative REST/OpenAPI contract for Lottify v1")
    .setVersion("1.0.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document);
}
