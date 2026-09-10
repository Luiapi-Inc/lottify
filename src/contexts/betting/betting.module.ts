import { Module } from "@nestjs/common";
import { BettingQuoteDrawAdapter } from "../../platform/integration/quote-draw.adapter";
import { BettingQuoteService } from "./application/betting-quote.service";
import { BETTING_QUOTE_DRAW_PORT } from "./application/betting-quote-draw.port";

@Module({
  providers: [
    BettingQuoteService,
    BettingQuoteDrawAdapter,
    {
      provide: BETTING_QUOTE_DRAW_PORT,
      useExisting: BettingQuoteDrawAdapter,
    },
  ],
  exports: [BettingQuoteService],
})
export class BettingModule {}
