-- Lock both parents in identity order when moving a link. Publication takes the
-- same parent row lock, making link edits serialize against publication.
CREATE FUNCTION protect_published_lottery_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_parent UUID;
  new_parent UUID;
  parent RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_parent := OLD.product_version_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_parent := NEW.product_version_id; END IF;
  FOR parent IN
    SELECT id, state FROM lottery_product_versions
    WHERE id = old_parent OR id = new_parent ORDER BY id FOR UPDATE
  LOOP
    IF parent.state = 'PUBLISHED' THEN
      RAISE EXCEPTION 'Published Lottery configuration links are immutable';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER lottery_product_version_links_immutable
BEFORE INSERT OR UPDATE OR DELETE ON lottery_product_version_bet_types
FOR EACH ROW EXECUTE FUNCTION protect_published_lottery_links();
