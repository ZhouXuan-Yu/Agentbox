package automationcontrol

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

func genID(prefix string) string {
	b := make([]byte, 8)
	rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// ── List Workflows ────────────────────────────────────────────

func ListWorkflows(ctx context.Context, input *ListWorkflowsInput) (*ListWorkflowsOutput, error) {
	if db == nil {
		return nil, huma.Error500InternalServerError("database not available")
	}
	if input.Limit == 0 {
		input.Limit = 20
	}

	mu.Lock()
	defer mu.Unlock()

	var total int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM automation_control_workflows`).Scan(&total); err != nil {
		return nil, fmt.Errorf("count workflows: %w", err)
	}

	rows, err := db.QueryContext(ctx,
		`SELECT id, name, description, active_version_id, updated_at, created_at
		 FROM automation_control_workflows
		 ORDER BY created_at DESC LIMIT ? OFFSET ?`,
		input.Limit, input.Offset)
	if err != nil {
		return nil, fmt.Errorf("query workflows: %w", err)
	}
	defer rows.Close()

	items := make([]WorkflowListItem, 0)
	for rows.Next() {
		var item WorkflowListItem
		if err := rows.Scan(&item.ID, &item.Name, &item.Description, &item.ActiveVersionID, &item.UpdatedAt, &item.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan workflow: %w", err)
		}
		item.Status = "draft"
		if item.ActiveVersionID != "" {
			item.Status = "active"
		}
		items = append(items, item)
	}

	output := &ListWorkflowsOutput{}
	output.Body.Items = items
	output.Body.Total = total
	output.Body.Limit = input.Limit
	output.Body.Offset = input.Offset
	return output, nil
}

// ── Create Workflow ───────────────────────────────────────────

func CreateWorkflow(ctx context.Context, input *CreateWorkflowInput) (*CreateWorkflowOutput, error) {
	if db == nil {
		return nil, huma.Error500InternalServerError("database not available")
	}

	wfID := genID("wf-")
	verID := genID("ver-")
	ts := now()

	trigger := input.Body.Trigger
	if trigger.Type == "" {
		trigger.Type = "manual"
	}
	triggerJSON, _ := json.Marshal(trigger)

	definition := WorkflowDefinition{
		ID:              wfID,
		Name:            input.Body.Name,
		Description:     input.Body.Description,
		Trigger:         trigger,
		Nodes:           []WorkflowNode{},
		Edges:           []WorkflowEdge{},
		ActiveVersionID: "",
		CreatedAt:       ts,
		UpdatedAt:       ts,
	}
	defJSON, _ := json.Marshal(definition)

	mu.Lock()
	defer mu.Unlock()

	_, err := db.ExecContext(ctx,
		`INSERT INTO automation_control_workflows (id, name, description, active_version_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		wfID, input.Body.Name, input.Body.Description, "", ts, ts)
	if err != nil {
		return nil, fmt.Errorf("insert workflow: %w", err)
	}

	// Create initial draft version
	_, err = db.ExecContext(ctx,
		`INSERT INTO automation_control_workflow_versions (id, workflow_id, version, definition_json, change_summary, created_by, status, created_at)
		 VALUES (?, ?, 1, ?, 'Initial version', 'user', 'draft', ?)`,
		verID, wfID, string(defJSON), ts)
	if err != nil {
		return nil, fmt.Errorf("insert version: %w", err)
	}

	// Parse definition back for response
	var wfDef WorkflowDefinition
	json.Unmarshal(defJSON, &wfDef)
	wfDef.Trigger = WorkflowTrigger{}
	json.Unmarshal(triggerJSON, &wfDef.Trigger)

	output := &CreateWorkflowOutput{Body: wfDef}
	return output, nil
}

// ── Get Workflow ──────────────────────────────────────────────

func GetWorkflow(ctx context.Context, input *GetWorkflowInput) (*GetWorkflowOutput, error) {
	if db == nil {
		return nil, huma.Error500InternalServerError("database not available")
	}

	mu.Lock()
	defer mu.Unlock()

	var wf WorkflowDefinition
	var triggerJSON string
	if err := db.QueryRowContext(ctx,
		`SELECT id, name, description, active_version_id, created_at, updated_at
		 FROM automation_control_workflows WHERE id = ?`, input.ID).
		Scan(&wf.ID, &wf.Name, &wf.Description, &wf.ActiveVersionID, &wf.CreatedAt, &wf.UpdatedAt); err != nil {
		return nil, huma.Error404NotFound("workflow not found")
	}

	// Load definition from active or latest draft version
	var defJSON string
	err := db.QueryRowContext(ctx,
		`SELECT definition_json FROM automation_control_workflow_versions
		 WHERE workflow_id = ? AND status = 'active'
		 UNION ALL
		 SELECT definition_json FROM automation_control_workflow_versions
		 WHERE workflow_id = ? AND status = 'draft'
		 ORDER BY version DESC LIMIT 1`, input.ID, input.ID).Scan(&defJSON)
	if err != nil {
		// No version found, return empty definition
		wf.Nodes = []WorkflowNode{}
		wf.Edges = []WorkflowEdge{}
	} else {
		json.Unmarshal([]byte(defJSON), &wf)
		json.Unmarshal([]byte(triggerJSON), &wf.Trigger)
	}

	output := &GetWorkflowOutput{Body: wf}
	return output, nil
}
