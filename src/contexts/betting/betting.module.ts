import { Module } from "@nestjs/common";
import { BettingQuoteDrawAdapter } from "../../platform/integration/quote-draw.adapter";
import { BETTING_QUOTE_DRAW_PORT } from "./application/betting-quote-draw.port";
import { STAKE_REFUND_REPOSITORY } from "./domain/stake-refund.repository";
import { PrismaStakeRefundRepository } from "./infrastructure/prisma-stake-refund.repository";

@Module({
  providers: [
    BettingQuoteDrawAdapter,
    {
      provide: BETTING_QUOTE_DRAW_PORT,
      useExisting: BettingQuoteDrawAdapter,
    },
    // Betting owns the Draw-cancellation refund obligation, so the persistence
    // seam for it lives here. The refund operation itself is composed in
    // ContextsModule because it also needs the betting→wallet-ledger port.
    PrismaStakeRefundRepository,
    {
      provide: STAKE_REFUND_REPOSITORY,
      useExisting: PrismaStakeRefundRepository,
    },
  ],
  // The draw port is exported so ContextsModule can compose Quote/Order next
  // to the Wallet & Ledger and Eligibility adapters while Betting remains
  // decoupled from Lottery internals; the stake-refund repository is exported
  // for the same reason.
  exports: [BETTING_QUOTE_DRAW_PORT, STAKE_REFUND_REPOSITORY],
})
export class BettingModule {}
