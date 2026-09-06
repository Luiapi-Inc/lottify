CREATE OR REPLACE FUNCTION protect_published_lottery_configuration_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'PUBLISHED' THEN
    RAISE EXCEPTION 'Published Lottery configuration versions are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
