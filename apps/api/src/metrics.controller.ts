import { Controller, Get, Header, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { register } from "prom-client";
import { OpsAuthGuard } from "./ops-auth.guard";

@ApiExcludeController()
@UseGuards(OpsAuthGuard)
@Controller("metrics")
export class MetricsController {
  @Get()
  @Header("Content-Type", register.contentType)
  metrics(): Promise<string> {
    return register.metrics();
  }
}
