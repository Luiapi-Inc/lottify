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
  // The draw port is exported so the Bet Order service (composed in
  // ContextsModule next to its Wallet & Ledger adapter) revalidates the same
  // authoritative Draw cutoff at Confirm.
  exports: [BettingQuoteService, BETTING_QUOTE_DRAW_PORT],
})
export class BettingModule {}
