DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='inspiration_hub_app') THEN
    CREATE ROLE inspiration_hub_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;
GRANT USAGE ON SCHEMA inspiration_hub TO inspiration_hub_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA inspiration_hub TO inspiration_hub_app;
CREATE POLICY app_access ON inspiration_hub.projects TO inspiration_hub_app USING (true) WITH CHECK (true);
CREATE POLICY app_access ON inspiration_hub.nodes TO inspiration_hub_app USING (true) WITH CHECK (true);
CREATE POLICY app_access ON inspiration_hub.meta TO inspiration_hub_app USING (true) WITH CHECK (true);
CREATE POLICY app_access ON inspiration_hub.ai_jobs TO inspiration_hub_app USING (true) WITH CHECK (true);
