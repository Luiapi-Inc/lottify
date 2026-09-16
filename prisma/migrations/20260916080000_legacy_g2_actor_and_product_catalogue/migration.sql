-- S2 schema lane (kanban card t_205c14d4), additive only: one nullable column on
-- result_revisions (D6), four columns + one unique index on lottery_products and
-- one new table (D8). No existing column is renamed, retyped or dropped, and no
-- existing row is invalidated: every new NOT NULL column carries a default.
--
-- Prisma-rendered equivalent (verify with):
--   prisma migrate diff --from-schema <parent schema> --to-schema prisma/schema.prisma --script
-- The rendered delta carries the same statements in the same order; this file adds
-- only the two CHECK constraints (which the Prisma schema language cannot express)
-- and the extended immutability trigger function body, both carried as raw SQL. The
-- D6 column, D8 columns/table/indexes and the composite FK are all schema-expressible
-- and are mirrored in prisma/schema.prisma.

-- D6. result_revisions legacy actor provenance ---------------------------------
-- G2 draw_results.announced_by is a G2 users.id and cannot be an AdminUser, so a
-- migrated CONFIRMED revision is attributed to the DISABLED migration principal
-- (result_revisions_confirmed_effect_check keeps its meaning: an admin actor is
-- still required). The original actor is preserved here, typed and queryable,
-- instead of surviving only inside result_source_ref text. No foreign key: an
-- ADMIN/SUPERADMIN G2 actor is not migrated as a Member (D3) and G2 users has no
-- G3 counterpart, so an FK would reject exactly the rows this column exists for.
-- NULL = confirmed by a G3 admin, i.e. the ordinary post-cutover case.
ALTER TABLE "result_revisions" ADD COLUMN "legacy_confirmed_by_user_id" UUID;

-- D6 immutability. The migration-principal attribution makes legacy_confirmed_by_user_id
-- an audit-quality provenance field: once a ResultRevision is CONFIRMED (or already
-- SUPERSEDED), the asserted G2 actor must be as immutable as the winning payload itself.
-- protect_result_revision_immutability (20260911120000_settlement) is extended so an
-- UPDATE that rewrites or erases this column on a terminal revision is rejected, exactly
-- like the other immutable payload fields. CREATE OR REPLACE keeps the existing trigger
-- attachment intact while upgrading the guarded column set.
CREATE OR REPLACE FUNCTION "protect_result_revision_immutability"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.state IN ('CONFIRMED','SUPERSEDED') THEN
    RAISE EXCEPTION 'Terminal Result revisions are immutable';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state IN ('CONFIRMED','SUPERSEDED') THEN
      IF NEW.result_data IS DISTINCT FROM OLD.result_data
         OR NEW.winning_numbers IS DISTINCT FROM OLD.winning_numbers
         OR NEW.draw_id IS DISTINCT FROM OLD.draw_id
         OR NEW.revision IS DISTINCT FROM OLD.revision
         OR NEW.result_schema_version_ref IS DISTINCT FROM OLD.result_schema_version_ref
         OR NEW.result_source_ref IS DISTINCT FROM OLD.result_source_ref
         OR NEW.supersedes_revision_id IS DISTINCT FROM OLD.supersedes_revision_id
         OR NEW.legacy_confirmed_by_user_id IS DISTINCT FROM OLD.legacy_confirmed_by_user_id THEN
        RAISE EXCEPTION 'Confirmed Result revision payload is immutable';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- D8. lottery_products display metadata ---------------------------------------
-- G2 lottery_categories carries name/slug/is_active/display_order; without them
-- the migrated catalogue is identity-only and cannot be listed or ordered.
ALTER TABLE "lottery_products" ADD COLUMN "name" TEXT NOT NULL DEFAULT '',
ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "display_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "slug" TEXT;

-- slug is nullable on purpose: a NOT NULL unique slug needs a fabricated default
-- for the products that already exist, while a partial unique index (WHERE slug
-- IS NOT NULL) cannot be declared in the Prisma schema and would leave permanent
-- migrate-diff drift. Postgres treats NULLs as distinct in a unique index, so this
-- index constrains exactly the rows that carry a slug - the partial-index
-- behaviour, declared where Prisma can see it.
CREATE UNIQUE INDEX "lottery_products_slug_key" ON "lottery_products"("slug");

-- D8. number limits ------------------------------------------------------------
-- The G2 source table is itself named number_limits, so the G3 table keeps the
-- lottery_ prefix. The two generations' table names must stay disjoint or
-- `prisma migrate deploy` fails on the cutover shape, where a G2 restore and the
-- G3 schema live in one database (T13 design record section 2): a G3 table named
-- number_limits would collide with the G2 table the ETL still has to read.
CREATE TABLE "lottery_number_limits" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "bet_type_id" UUID,
    "draw_id" UUID,
    "number" TEXT,
    "tiers" JSONB,
    "min_stake_minor" BIGINT,
    "max_stake_minor" BIGINT,
    "max_stake_per_bet_minor" BIGINT,
    "max_payout_minor" BIGINT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lottery_number_limits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lottery_number_limits_scope_check" CHECK ("scope" IN ('GLOBAL', 'TYPE', 'DRAW')),
    -- The resolution invariant (Lead review round 2): a DRAW-scoped limit must name
    -- its Draw and (because a named Draw must name its Bet Type too) its Bet Type; a
    -- TYPE-scoped limit must name a Bet Type and may not carry a Draw; a GLOBAL limit
    -- must be fully untargeted (no Draw, no Bet Type). G2's five GLOBAL rows carry a
    -- lottery_type_id (a per-product instance of one G3 Bet Type code) and no draw_id,
    -- and its single DRAW row carries both, so the migrated set satisfies this exactly.
    CONSTRAINT "lottery_number_limits_scope_target_check" CHECK (
        ("scope" <> 'DRAW' OR "draw_id" IS NOT NULL)
        AND ("scope" <> 'TYPE' OR ("draw_id" IS NULL AND "bet_type_id" IS NOT NULL))
        AND ("scope" <> 'GLOBAL' OR ("draw_id" IS NULL AND "bet_type_id" IS NULL))
        AND ("draw_id" IS NULL OR "bet_type_id" IS NOT NULL)
    )
);

CREATE INDEX "lottery_number_limits_bet_type_id_number_idx" ON "lottery_number_limits"("bet_type_id", "number");

CREATE INDEX "lottery_number_limits_draw_id_number_idx" ON "lottery_number_limits"("draw_id", "number");

ALTER TABLE "lottery_number_limits" ADD CONSTRAINT "lottery_number_limits_bet_type_id_fkey" FOREIGN KEY ("bet_type_id") REFERENCES "lottery_bet_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lottery_number_limits" ADD CONSTRAINT "lottery_number_limits_draw_id_fkey" FOREIGN KEY ("draw_id") REFERENCES "lottery_draws"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- D8 (Lead review round 2): a DRAW-scoped limit must reference a Bet Type that is
-- actually enabled on that Draw. The composite FK (draw_id, bet_type_id) targets the
-- unique [drawId, betTypeId] key of lottery_draw_bet_types, so Postgres rejects any
-- (draw, bet_type) pairing the Draw does not carry. The standalone draw_id/bet_type_id
-- FKs above remain for the GLOBAL/TYPE paths; the composite FK is the additive guard.
ALTER TABLE "lottery_number_limits" ADD CONSTRAINT "lottery_number_limits_draw_id_bet_type_id_fkey" FOREIGN KEY ("draw_id", "bet_type_id") REFERENCES "lottery_draw_bet_types"("draw_id", "bet_type_id") ON DELETE RESTRICT ON UPDATE CASCADE;
