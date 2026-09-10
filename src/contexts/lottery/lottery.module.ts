import { Module } from "@nestjs/common";
import { LotteryConfigurationService } from "./application/lottery-configuration.service";
import { LotteryDrawService } from "./application/lottery-draw.service";

@Module({
  providers: [LotteryConfigurationService, LotteryDrawService],
  exports: [LotteryConfigurationService, LotteryDrawService],
})
export class LotteryModule {}
