-- D1 Schema for ClawFooding Managed Service
-- Initialize via: wrangler d1 execute clawfooding-logs --file=src/_schema.sql

CREATE TABLE IF NOT EXISTS test_runs (
	id TEXT PRIMARY KEY,
	target_url TEXT NOT NULL,
	goal TEXT NOT NULL,
	personas TEXT NOT NULL, -- JSON array
	model TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'queued',
	created_at TEXT NOT NULL,
	completed_at TEXT,
	total_cost_usd REAL DEFAULT 0,
	report_key TEXT -- R2 object key for report
);

CREATE TABLE IF NOT EXISTS deployments (
	id TEXT PRIMARY KEY,
	target_url TEXT NOT NULL,
	goal TEXT NOT NULL,
	personas TEXT NOT NULL, -- JSON array
	model TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'deploying',
	created_at TEXT NOT NULL,
	completed_at TEXT,
	total_cost_usd REAL DEFAULT 0,
	report_key TEXT
);

CREATE TABLE IF NOT EXISTS billing_records (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	test_run_id TEXT,
	deployment_id TEXT,
	persona_id TEXT NOT NULL,
	session_id TEXT NOT NULL,
	model TEXT NOT NULL,
	input_tokens INTEGER DEFAULT 0,
	output_tokens INTEGER DEFAULT 0,
	cache_creation_tokens INTEGER DEFAULT 0,
	cache_read_tokens INTEGER DEFAULT 0,
	cost_usd REAL DEFAULT 0,
	step TEXT,
	recovery_level INTEGER DEFAULT 0,
	timestamp TEXT NOT NULL,
	FOREIGN KEY (test_run_id) REFERENCES test_runs(id),
	FOREIGN KEY (deployment_id) REFERENCES deployments(id)
);

CREATE INDEX IF NOT EXISTS idx_billing_persona ON billing_records(persona_id);
CREATE INDEX IF NOT EXISTS idx_billing_test_run ON billing_records(test_run_id);
CREATE INDEX IF NOT EXISTS idx_billing_deployment ON billing_records(deployment_id);
CREATE INDEX IF NOT EXISTS idx_billing_timestamp ON billing_records(timestamp);

CREATE TABLE IF NOT EXISTS audit_log (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	action TEXT NOT NULL,
	entity_type TEXT NOT NULL,
	entity_id TEXT,
	details TEXT, -- JSON
	timestamp TEXT NOT NULL
);
