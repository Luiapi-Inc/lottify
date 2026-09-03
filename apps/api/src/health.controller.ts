import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { HealthService } from "./health.service";

@ApiExcludeController()
@Controller("internal/health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("startup")
  startup(): { ok: boolean } {
    const result = this.health.startup();
    if (!result.ok) throw new HttpException(result, HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }

  @Get("live")
  live(): { ok: true } {
    return this.health.liveness();
  }

  @Get("ready")
  async ready(): Promise<unknown> {
    const result = await this.health.readiness();
    if (!result.ok) throw new HttpException(result, HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
