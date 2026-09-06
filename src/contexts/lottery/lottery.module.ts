import { Module } from "@nestjs/common";
import { LotteryConfigurationService } from "./application/lottery-configuration.service";

@Module({
  providers: [LotteryConfigurationService],
  exports: [LotteryConfigurationService],
})
export class LotteryModule {}
