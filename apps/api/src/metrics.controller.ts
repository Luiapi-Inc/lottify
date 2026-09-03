import { Controller, Get, Header } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { register } from "prom-client";

@ApiExcludeController()
@Controller("metrics")
export class MetricsController {
  @Get()
  @Header("Content-Type", register.contentType)
  metrics(): Promise<string> {
    return register.metrics();
  }
}
