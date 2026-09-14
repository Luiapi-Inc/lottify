-- Persist the accepted source-allocation snapshot at reservation time so
-- crash/replay paths can reuse the exact financial/provenance decision instead
-- of recomputing from current promotion or wallet state.
ALTER TABLE "reservations"
  ADD COLUMN "source_allocation_snapshot" JSONB;
