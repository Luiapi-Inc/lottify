ALTER TABLE "lottery_bet_type_versions"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "lottery_product_versions"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
