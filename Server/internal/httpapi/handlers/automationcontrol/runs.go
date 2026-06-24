package automationcontrol

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/danielgtaylor/huma/v2"
)

// ── List Runs ─────────────────────────────────────────────────

func ListRuns(ctx context.Context, input *ListRunsInput) (*ListRunsOutput, error) {
	if db == nil {
		return nil, huma.Error500InternalServerError("database not available")
	}
	if input.Limit == 0 {
		input.Limit = 20
	}

	mu.Lock()
	defer mu.Unlock()

	var total int
	query := `SELECT COUNT(*) FROM automation_control_workflow_runs`
	args := []interface{}{}
	if input.WorkflowID != "" {
		query += ` WHERE workflow_id = ?`
		args = append(args, input.WorkflowID)
	}
	if input.Status != "" && input.Status != "all" {
		if input.WorkflowID != "" {
			query += ` AND status = ?`
		} else {
			query += ` WHERE status = ?`
		}
		args = append(args, input.Status)
	}
	if err := db.QueryRowContext(ctx, query, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count runs: %w", err)
	}

	dataQuery := `SELECT id, workflow_id, workflow_version_id, status, trigger_type, trigger_payload_json,
		started_at, ended_at, duration_ms, failed_node_run_id, error_message, last_sequence, created_at
		FROM automation_control_workflow_runs`
	dataArgs := make([]interface{}, 0, len(args)+2)

	if input.WorkflowID != "" {
		dataQuery += ` WHERE workflow_id = ?`
		dataArgs = append(dataArgs, input.WorkflowID)
	}
	if input.Status != "" && input.Status != "all" {
		if input.WorkflowID != "" {
			dataQuery += ` AND status = ?`
		} else {
			dataQuery += ` WHERE status = ?`
		}
		dataArgs = append(dataArgs, input.Status)
	}
	dataQuery += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`
	dataArgs = append(dataArgs, input.Limit, input.Offset)

	rows, err := db.QueryContext(ctx, dataQuery, dataArgs...)
	if err != nil {
		return nil, fmt.Errorf("query runs: %w", err)
	}
	defer rows.Close()

	items := make([]WorkflowRun, 0)
	for rows.Next() {
		var r WorkflowRun
		if err := rows.Scan(&r.ID, &r.WorkflowID, &r.WorkflowVersionID, &r.Status, &r.TriggerType,
			&r.TriggerPayload, &r.StartedAt, &r.EndedAt, &r.DurationMs, &r.FailedNodeRunID,
			&r.ErrorMessage, &r.LastSequence, &r.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan run: %w", err)
		}
		items = append(items, r)
	}

	output := &ListRunsOutput{}
	output.Body.Items = items
	output.Body.Total = total
	output.Body.Limit = input.Limit
	output.Body.Offset = input.Offset
	return output, nil
}

// ── Get Run ───────────────────────────────────────────────────

func GetRun(ctx context.Context, input *GetRunInput) (*GetRunOutput, error) {
	if db == nil {
		return nil, huma.Error500InternalServerError("database not available")
	}

	mu.Lock()
	defer mu.Unlock()

	var r WorkflowRun
	if err := db.QueryRowContext(ctx,
		`SELECT id, workflow_id, workflow_version_id, status, trigger_type, trigger_payload_json,
		 started_at, ended_at, duration_ms, failed_node_run_id, error_message, last_sequence, created_at
		 FROM automation_control_workflow_runs WHERE id = ?`, input.ID).
		Scan(&r.ID, &r.WorkflowID, &r.WorkflowVersionID, &r.Status, &r.TriggerType,
			&r.TriggerPayload, &r.StartedAt, &r.EndedAt, &r.DurationMs, &r.FailedNodeRunID,
			&r.ErrorMessage, &r.LastSequence, &r.CreatedAt); err != nil {
		return nil, huma.Error404NotFound("run not found")
	}

	// Load node runs
	nodeRows, err := db.QueryContext(ctx,
		`SELECT id, run_id, node_id, title, type, status, input_json, output_json, error_json,
		 started_at, ended_at, duration_ms, retry_count, skipped_reason
		 FROM automation_control_workflow_node_runs WHERE run_id = ? ORDER BY started_at ASC`, input.ID)
	if err == nil {
		defer nodeRows.Close()
		for nodeRows.Next() {
			var nr WorkflowNodeRun
			var inputJSON, outputJSON, errorJSON string
			if err := nodeRows.Scan(&nr.ID, &nr.RunID, &nr.NodeID, &nr.Title, &nr.Type, &nr.Status,
				&inputJSON, &outputJSON, &errorJSON, &nr.StartedAt, &nr.EndedAt, &nr.DurationMs,
				&nr.RetryCount, &nr.SkippedReason); err != nil {
				continue
			}
			if inputJSON != "" {
				nr.Input = json.RawMessage(inputJSON)
			}
			if outputJSON != "" {
				nr.Output = json.RawMessage(outputJSON)
			}
			if errorJSON != "" {
				var se SerializedError
				if json.Unmarshal([]byte(errorJSON), &se) == nil {
					nr.Error = &se
				}
			}
			r.NodeRuns = append(r.NodeRuns, nr)
		}
	}
	if r.NodeRuns == nil {
		r.NodeRuns = []WorkflowNodeRun{}
	}

	output := &GetRunOutput{Body: r}
	return output, nil
}
