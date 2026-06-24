package automationcontrol

import (
	"database/sql"
	"sync"
)

var db *sql.DB
var mu sync.Mutex

func ConfigureAutomationControlStore(database *sql.DB) error {
	db = database
	if db == nil {
		return nil
	}

	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS automation_control_workflows (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL DEFAULT '',
			description TEXT NOT NULL DEFAULT '',
			active_version_id TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT '',
			updated_at TEXT NOT NULL DEFAULT ''
		);

		CREATE TABLE IF NOT EXISTS automation_control_workflow_versions (
			id TEXT PRIMARY KEY,
			workflow_id TEXT NOT NULL,
			version INTEGER NOT NULL DEFAULT 1,
			definition_json TEXT NOT NULL DEFAULT '{}',
			change_summary TEXT NOT NULL DEFAULT '',
			created_by TEXT NOT NULL DEFAULT 'user',
			created_from_run_id TEXT NOT NULL DEFAULT '',
			created_from_suggestion_ids TEXT NOT NULL DEFAULT '[]',
			status TEXT NOT NULL DEFAULT 'draft',
			created_at TEXT NOT NULL DEFAULT '',
			FOREIGN KEY (workflow_id) REFERENCES automation_control_workflows(id)
		);

		CREATE TABLE IF NOT EXISTS automation_control_workflow_runs (
			id TEXT PRIMARY KEY,
			workflow_id TEXT NOT NULL,
			workflow_version_id TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'pending',
			trigger_type TEXT NOT NULL DEFAULT 'manual',
			trigger_payload_json TEXT NOT NULL DEFAULT '',
			started_at TEXT NOT NULL DEFAULT '',
			ended_at TEXT NOT NULL DEFAULT '',
			duration_ms INTEGER NOT NULL DEFAULT 0,
			failed_node_run_id TEXT NOT NULL DEFAULT '',
			error_message TEXT NOT NULL DEFAULT '',
			last_sequence INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT '',
			FOREIGN KEY (workflow_id) REFERENCES automation_control_workflows(id)
		);

		CREATE TABLE IF NOT EXISTS automation_control_workflow_node_runs (
			id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			node_id TEXT NOT NULL,
			title TEXT NOT NULL DEFAULT '',
			type TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'pending',
			input_json TEXT NOT NULL DEFAULT '',
			output_json TEXT NOT NULL DEFAULT '',
			error_json TEXT NOT NULL DEFAULT '',
			started_at TEXT NOT NULL DEFAULT '',
			ended_at TEXT NOT NULL DEFAULT '',
			duration_ms INTEGER NOT NULL DEFAULT 0,
			retry_count INTEGER NOT NULL DEFAULT 0,
			skipped_reason TEXT NOT NULL DEFAULT '',
			FOREIGN KEY (run_id) REFERENCES automation_control_workflow_runs(id)
		);

		CREATE TABLE IF NOT EXISTS automation_control_trace_spans (
			id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			node_run_id TEXT NOT NULL DEFAULT '',
			parent_span_id TEXT NOT NULL DEFAULT '',
			title TEXT NOT NULL DEFAULT '',
			type TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'pending',
			input_json TEXT NOT NULL DEFAULT '',
			output_json TEXT NOT NULL DEFAULT '',
			error_json TEXT NOT NULL DEFAULT '',
			metadata_json TEXT NOT NULL DEFAULT '{}',
			artifact_ids_json TEXT NOT NULL DEFAULT '[]',
			started_at TEXT NOT NULL DEFAULT '',
			ended_at TEXT NOT NULL DEFAULT '',
			duration_ms INTEGER NOT NULL DEFAULT 0,
			FOREIGN KEY (run_id) REFERENCES automation_control_workflow_runs(id)
		);

		CREATE TABLE IF NOT EXISTS automation_control_run_artifacts (
			id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			node_run_id TEXT NOT NULL DEFAULT '',
			span_id TEXT NOT NULL DEFAULT '',
			type TEXT NOT NULL DEFAULT '',
			name TEXT NOT NULL DEFAULT '',
			url TEXT NOT NULL DEFAULT '',
			storage_key TEXT NOT NULL DEFAULT '',
			content_preview TEXT NOT NULL DEFAULT '',
			metadata_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL DEFAULT '',
			FOREIGN KEY (run_id) REFERENCES automation_control_workflow_runs(id)
		);

		CREATE TABLE IF NOT EXISTS automation_control_workflow_run_reviews (
			id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			workflow_id TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT '',
			summary TEXT NOT NULL DEFAULT '',
			bottlenecks_json TEXT NOT NULL DEFAULT '[]',
			learned_facts_json TEXT NOT NULL DEFAULT '[]',
			suggestion_ids_json TEXT NOT NULL DEFAULT '[]',
			risk_assessment TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT '',
			FOREIGN KEY (run_id) REFERENCES automation_control_workflow_runs(id)
		);

		CREATE TABLE IF NOT EXISTS automation_control_evolution_suggestions (
			id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			workflow_id TEXT NOT NULL,
			target_node_id TEXT NOT NULL DEFAULT '',
			type TEXT NOT NULL DEFAULT '',
			title TEXT NOT NULL DEFAULT '',
			reason TEXT NOT NULL DEFAULT '',
			evidence_json TEXT NOT NULL DEFAULT '[]',
			proposed_change_json TEXT NOT NULL DEFAULT '{}',
			risk TEXT NOT NULL DEFAULT 'low',
			confidence REAL NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'pending',
			created_at TEXT NOT NULL DEFAULT '',
			FOREIGN KEY (run_id) REFERENCES automation_control_workflow_runs(id)
		);
	`)

	return err
}
