CREATE SCHEMA IF NOT EXISTS inspiration_hub;
SET search_path TO inspiration_hub, pg_catalog;

CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, color TEXT NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, type TEXT NOT NULL, projectId TEXT REFERENCES projects(id) ON DELETE SET NULL, parentId TEXT REFERENCES nodes(id) ON DELETE SET NULL, status TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS nodes_project ON nodes(projectId);
CREATE INDEX IF NOT EXISTS nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS nodes_created ON nodes(createdAt DESC);
CREATE INDEX IF NOT EXISTS nodes_parent ON nodes(parentId);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_jobs (id TEXT PRIMARY KEY, nodeId TEXT NOT NULL UNIQUE REFERENCES nodes(id) ON DELETE CASCADE, mode TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, maxAttempts INTEGER NOT NULL DEFAULT 3, nextRunAt BIGINT NOT NULL, leaseUntil BIGINT, leaseToken TEXT, error TEXT, createdAt BIGINT NOT NULL, updatedAt BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS ai_jobs_due ON ai_jobs(status,nextRunAt);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA inspiration_hub FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA inspiration_hub FROM PUBLIC, anon, authenticated;
INSERT INTO storage.buckets (id,name,public,file_size_limit) VALUES ('inspiration-hub','inspiration-hub',false,33554432) ON CONFLICT(id) DO NOTHING;
