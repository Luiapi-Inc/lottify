import { Module } from "@nestjs/common";
import { BettingQuoteDrawAdapter } from "../../platform/integration/quote-draw.adapter";
import { BETTING_QUOTE_DRAW_PORT } from "./application/betting-quote-draw.port";

@Module({
  providers: [
    BettingQuoteDrawAdapter,
    {
      provide: BETTING_QUOTE_DRAW_PORT,
      useExisting: BettingQuoteDrawAdapter,
    },
  ],
  // The draw port is exported so ContextsModule can compose Quote/Order next
  // to the Wallet & Ledger and Eligibility adapters while Betting remains
  // decoupled from Lottery internals.
  exports: [BETTING_QUOTE_DRAW_PORT],
})
export class BettingModule {}
