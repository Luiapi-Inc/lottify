import { Module } from "@nestjs/common";

/**
 * Promotion bounded context.
 *
 * The Promotion application services depend on cross-context seams (the
 * Wallet & Ledger posting port and the Member facts port), so they are
 * instantiated at the composition root (`ContextsModule`) alongside the
 * platform adapters that implement those ports — the same wiring used by the
 * Deposit vertical. Promotion owns its own persistence, domain rules and
 * monetary semantics; it never mutates a Wallet balance directly.
 */
@Module({})
export class PromotionModule {}
