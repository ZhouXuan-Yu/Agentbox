package automationcontrol

import (
	"context"
	"fmt"

	"github.com/danielgtaylor/huma/v2"
)

// ── List Versions ─────────────────────────────────────────────

func ListVersions(ctx context.Context, input *ListVersionsInput) (*ListVersionsOutput, error) {
	if db == nil {
		return nil, huma.Error500InternalServerError("database not available")
	}

	mu.Lock()
	defer mu.Unlock()

	rows, err := db.QueryContext(ctx,
		`SELECT id, workflow_id, version, definition_json, change_summary, created_by,
		 created_from_run_id, created_from_suggestion_ids, status, created_at
		 FROM automation_control_workflow_versions
		 WHERE workflow_id = ?
		 ORDER BY version DESC`, input.WorkflowID)
	if err != nil {
		return nil, fmt.Errorf("query versions: %w", err)
	}
	defer rows.Close()

	items := make([]WorkflowVersion, 0)
	for rows.Next() {
		var v WorkflowVersion
		if err := rows.Scan(&v.ID, &v.WorkflowID, &v.Version, &v.DefinitionJSON,
			&v.ChangeSummary, &v.CreatedBy, &v.CreatedFromRunID,
			&v.CreatedFromSuggestionIDs, &v.Status, &v.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan version: %w", err)
		}
		items = append(items, v)
	}

	output := &ListVersionsOutput{}
	output.Body.Items = items
	return output, nil
}

// ── Activate Version ──────────────────────────────────────────

func ActivateVersion(ctx context.Context, input *ActivateVersionInput) (*VersionActionOutput, error) {
	if db == nil {
		return nil, huma.Error500InternalServerError("database not available")
	}

	mu.Lock()
	defer mu.Unlock()

	// Verify version exists and belongs to workflow
	var ver WorkflowVersion
	if err := db.QueryRowContext(ctx,
		`SELECT id, workflow_id, version, definition_json, change_summary, created_by,
		 created_from_run_id, created_from_suggestion_ids, status, created_at
		 FROM automation_control_workflow_versions
		 WHERE id = ? AND workflow_id = ?`,
		input.VersionID, input.WorkflowID).
		Scan(&ver.ID, &ver.WorkflowID, &ver.Version, &ver.DefinitionJSON,
			&ver.ChangeSummary, &ver.CreatedBy, &ver.CreatedFromRunID,
			&ver.CreatedFromSuggestionIDs, &ver.Status, &ver.CreatedAt); err != nil {
		return nil, huma.Error404NotFound("version not found")
	}

	// Deactivate all other versions
	_, err := db.ExecContext(ctx,
		`UPDATE automation_control_workflow_versions SET status = 'archived'
		 WHERE workflow_id = ? AND status = 'active'`, input.WorkflowID)
	if err != nil {
		return nil, fmt.Errorf("deactivate versions: %w", err)
	}

	// Activate target version
	_, err = db.ExecContext(ctx,
		`UPDATE automation_control_workflow_versions SET status = 'active'
		 WHERE id = ?`, input.VersionID)
	if err != nil {
		return nil, fmt.Errorf("activate version: %w", err)
	}

	// Update workflow active_version_id
	_, err = db.ExecContext(ctx,
		`UPDATE automation_control_workflows SET active_version_id = ?, updated_at = ?
		 WHERE id = ?`, input.VersionID, now(), input.WorkflowID)
	if err != nil {
		return nil, fmt.Errorf("update workflow: %w", err)
	}

	ver.Status = "active"
	output := &VersionActionOutput{}
	output.Body.Success = true
	output.Body.Version = ver
	return output, nil
}

// ── Rollback Version ──────────────────────────────────────────

func RollbackVersion(ctx context.Context, input *RollbackVersionInput) (*VersionActionOutput, error) {
	if db == nil {
		return nil, huma.Error500InternalServerError("database not available")
	}

	mu.Lock()
	defer mu.Unlock()

	// Verify target version exists
	var defJSON, createdBy, createdFromRunID string
	if err := db.QueryRowContext(ctx,
		`SELECT definition_json, created_by, created_from_run_id
		 FROM automation_control_workflow_versions
		 WHERE id = ? AND workflow_id = ?`,
		input.VersionID, input.WorkflowID).
		Scan(&defJSON, &createdBy, &createdFromRunID); err != nil {
		return nil, huma.Error404NotFound("version not found")
	}

	// Get next version number
	var maxVer int
	db.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(version), 0) FROM automation_control_workflow_versions WHERE workflow_id = ?`,
		input.WorkflowID).Scan(&maxVer)

	newVerID := genID("ver-")
	ts := now()

	// Create new version based on rollback target
	_, err := db.ExecContext(ctx,
		`INSERT INTO automation_control_workflow_versions
		 (id, workflow_id, version, definition_json, change_summary, created_by, created_from_run_id, created_from_suggestion_ids, status, created_at)
		 VALUES (?, ?, ?, ?, 'Rollback to v' || ?, ?, ?, '', 'draft', ?)`,
		newVerID, input.WorkflowID, maxVer+1, defJSON,
		fmt.Sprintf("Rollback to v%d", maxVer+1), createdBy, createdFromRunID, ts)
	if err != nil {
		return nil, fmt.Errorf("create rollback version: %w", err)
	}

	// Deactivate all active versions
	db.ExecContext(ctx,
		`UPDATE automation_control_workflow_versions SET status = 'archived'
		 WHERE workflow_id = ? AND status = 'active'`, input.WorkflowID)

	// Activate the new rollback version
	db.ExecContext(ctx,
		`UPDATE automation_control_workflow_versions SET status = 'active' WHERE id = ?`, newVerID)

	// Update workflow
	db.ExecContext(ctx,
		`UPDATE automation_control_workflows SET active_version_id = ?, updated_at = ? WHERE id = ?`,
		newVerID, ts, input.WorkflowID)

	var newVer WorkflowVersion
	db.QueryRowContext(ctx,
		`SELECT id, workflow_id, version, definition_json, change_summary, created_by,
		 created_from_run_id, created_from_suggestion_ids, status, created_at
		 FROM automation_control_workflow_versions WHERE id = ?`, newVerID).
		Scan(&newVer.ID, &newVer.WorkflowID, &newVer.Version, &newVer.DefinitionJSON,
			&newVer.ChangeSummary, &newVer.CreatedBy, &newVer.CreatedFromRunID,
			&newVer.CreatedFromSuggestionIDs, &newVer.Status, &newVer.CreatedAt)

	output := &VersionActionOutput{}
	output.Body.Success = true
	output.Body.Version = newVer
	return output, nil
}
