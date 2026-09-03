import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

@ApiTags("system")
@Controller("api/v1")
export class ApiV1Controller {
  @Get()
  @ApiOperation({ summary: "Lottify v1 API contract root" })
  root(): { name: string; version: string; status: string } {
    return { name: "Lottify", version: "v1", status: "foundation" };
  }
}
