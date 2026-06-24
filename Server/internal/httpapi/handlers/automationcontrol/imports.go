package automationcontrol

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/danielgtaylor/huma/v2"
)

// ── Import Types ──────────────────────────────────────────────

type AgentExecutionTraceImport struct {
	SourceType  string               `json:"sourceType"`
	Name        string               `json:"name"`
	Description string               `json:"description,omitempty"`
	Trigger     *WorkflowTrigger     `json:"trigger,omitempty"`
	Steps       []AgentExecutionStep `json:"steps"`
}

type AgentExecutionStep struct {
	ID        string          `json:"id"`
	ParentID  string          `json:"parentId,omitempty"`
	Title     string          `json:"title"`
	Type      string          `json:"type"`
	Input     json.RawMessage `json:"input,omitempty"`
	Output    json.RawMessage `json:"output,omitempty"`
	Error     *SerializedError `json:"error,omitempty"`
	StartedAt string          `json:"startedAt,omitempty"`
	EndedAt   string          `json:"endedAt,omitempty"`
	Metadata  json.RawMessage `json:"metadata,omitempty"`
}

type AgentPlanImport struct {
	SourceType  string          `json:"sourceType"`
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Trigger     WorkflowTrigger `json:"trigger"`
	Nodes       []PlanNode      `json:"nodes"`
	Edges       []PlanEdge      `json:"edges"`
}

type PlanNode struct {
	ID     string          `json:"id"`
	Title  string          `json:"title"`
	Type   string          `json:"type"`
	Config json.RawMessage `json:"config"`
}

type PlanEdge struct {
	Source    string `json:"source"`
	Target    string `json:"target"`
	Condition string `json:"condition,omitempty"`
	Label     string `json:"label,omitempty"`
}

// ── Huma I/O Types ────────────────────────────────────────────

type ImportTraceInput struct {
	Body AgentExecutionTraceImport
}

type ImportPlanInput struct {
	Body AgentPlanImport
}

type ImportOutput struct {
	Body WorkflowDefinition
}

// ── Import Agent Execution Trace ──────────────────────────────

func ImportAgentExecutionTrace(ctx context.Context, input *ImportTraceInput) (*ImportOutput, error) {
	if db == nil {
		return nil, huma.Error500InternalServerError("database not available")
	}

	imp := input.Body
	ts := now()
	wfID := genID("wf-")
	verID := genID("ver-")
	runID := genID("run-")

	// Build nodes from steps
	nodes := make([]WorkflowNode, 0, len(imp.Steps))
	for _, step := range imp.Steps {
		nodeType := step.Type
		if nodeType == "" {
			nodeType = "tool"
		}
		cfg := map[string]interface{}{}
		if step.Input != nil {
			var inputMap map[string]interface{}
			if json.Unmarshal(step.Input, &inputMap) == nil {
				cfg = inputMap
			}
		}
		if step.Metadata != nil {
			var metaMap map[string]interface{}
			if json.Unmarshal(step.Metadata, &metaMap) == nil {
				for k, v := range metaMap {
					cfg[k] = v
				}
			}
		}
		cfgJSON, _ := json.Marshal(cfg)
		nodes = append(nodes, WorkflowNode{
			ID:          step.ID,
			Type:        nodeType,
			Title:       step.Title,
			Description: "",
			Config:      string(cfgJSON),
		})
	}

	// Build edges from parentId relationships
	edges := make([]WorkflowEdge, 0)
	for _, step := range imp.Steps {
		if step.ParentID != "" {
			edges = append(edges, WorkflowEdge{
				ID:    genID("edge-"),
				Source: step.ParentID,
				Target: step.ID,
			})
		}
	}

	trigger := WorkflowTrigger{Type: "manual"}
	if imp.Trigger != nil {
		trigger = *imp.Trigger
	}
	triggerJSON, _ := json.Marshal(trigger)

	definition := WorkflowDefinition{
		ID:              wfID,
		Name:            imp.Name,
		Description:     imp.Description,
		Trigger:         trigger,
		Nodes:           nodes,
		Edges:           edges,
		ActiveVersionID: "",
		CreatedAt:       ts,
		UpdatedAt:       ts,
	}
	defJSON, _ := json.Marshal(definition)

	mu.Lock()
	defer mu.Unlock()

	// Insert workflow
	_, err := db.ExecContext(ctx,
		`INSERT INTO automation_control_workflows (id, name, description, active_version_id, created_at, updated_at)
		 VALUES (?, ?, ?, '', ?, ?)`,
		wfID, imp.Name, imp.Description, ts, ts)
	if err != nil {
		return nil, fmt.Errorf("insert workflow: %w", err)
	}

	// Insert version (draft)
	_, err = db.ExecContext(ctx,
		`INSERT INTO automation_control_workflow_versions (id, workflow_id, version, definition_json, change_summary, created_by, status, created_at)
		 VALUES (?, ?, 1, ?, 'Imported from agent execution trace', 'agent', 'draft', ?)`,
		verID, wfID, string(defJSON), ts)
	if err != nil {
		return nil, fmt.Errorf("insert version: %w", err)
	}

	// Create a historical run from the trace
	runStatus := "success"
	runDuration := int64(0)
	var failedNodeRunID string

	// Insert run
	_, err = db.ExecContext(ctx,
		`INSERT INTO automation_control_workflow_runs (id, workflow_id, workflow_version_id, status, trigger_type, trigger_payload_json, started_at, ended_at, duration_ms, failed_node_run_id, error_message, last_sequence, created_at)
		 VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, '', 0, ?)`,
		runID, wfID, verID, "pending", string(triggerJSON), ts, ts, 0, "", ts)
	if err != nil {
		return nil, fmt.Errorf("insert run: %w", err)
	}

	// Insert node runs for each step
	for _, step := range imp.Steps {
		nrID := genID("nr-")
		nodeStatus := "success"
		if step.Error != nil {
			nodeStatus = "failed"
			runStatus = "failed"
			failedNodeRunID = nrID
		}

		inputJSON := "null"
		if step.Input != nil {
			inputJSON = string(step.Input)
		}
		outputJSON := "null"
		if step.Output != nil {
			outputJSON = string(step.Output)
		}
		errorJSON := "null"
		if step.Error != nil {
			errB, _ := json.Marshal(step.Error)
			errorJSON = string(errB)
		}

		dur := int64(0)
		started := step.StartedAt
		ended := step.EndedAt
		if started == "" {
			started = ts
		}
		if ended == "" {
			ended = ts
		}

		_, err = db.ExecContext(ctx,
			`INSERT INTO automation_control_workflow_node_runs (id, run_id, node_id, title, type, status, input_json, output_json, error_json, started_at, ended_at, duration_ms, retry_count, skipped_reason)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '')`,
			nrID, runID, step.ID, step.Title, step.Type, nodeStatus, inputJSON, outputJSON, errorJSON, started, ended, dur)
		if err != nil {
			return nil, fmt.Errorf("insert node run: %w", err)
		}

		// Create trace spans for failed steps
		if step.Error != nil {
			spanID := genID("span-")
			spanInput := map[string]interface{}{}
			if step.Input != nil {
				json.Unmarshal(step.Input, &spanInput)
			}
			spanInputJSON, _ := json.Marshal(spanInput)
			spanErrorJSON, _ := json.Marshal(step.Error)
			spanMeta := map[string]interface{}{}
			if step.Metadata != nil {
				json.Unmarshal(step.Metadata, &spanMeta)
			}
			spanMetaJSON, _ := json.Marshal(spanMeta)

			spanType := "tool_call"
			switch step.Type {
			case "browser":
				spanType = "browser_action"
			case "api":
				spanType = "api_call"
			case "agent":
				spanType = "agent_thought"
			case "condition":
				spanType = "condition_check"
			}

			db.ExecContext(ctx,
				`INSERT INTO automation_control_trace_spans (id, run_id, node_run_id, parent_span_id, title, type, status, input_json, output_json, error_json, metadata_json, artifact_ids_json, started_at, ended_at, duration_ms)
				 VALUES (?, ?, ?, '', ?, ?, 'failed', ?, 'null', ?, ?, '[]', ?, ?, ?)`,
				spanID, runID, nrID, step.Title, spanType, string(spanInputJSON), string(spanErrorJSON), string(spanMetaJSON), started, ended, dur)
		}
	}

	// Update run final status
	db.ExecContext(ctx,
		`UPDATE automation_control_workflow_runs SET status = ?, failed_node_run_id = ?, duration_ms = ?
		 WHERE id = ?`,
		runStatus, failedNodeRunID, runDuration, runID)

	// Load definition for response
	var wfDef WorkflowDefinition
	json.Unmarshal(defJSON, &wfDef)
	wfDef.Trigger = WorkflowTrigger{}
	json.Unmarshal(triggerJSON, &wfDef.Trigger)

	output := &ImportOutput{Body: wfDef}
	return output, nil
}

// ── Import Agent Plan ─────────────────────────────────────────

func ImportAgentPlan(ctx context.Context, input *ImportPlanInput) (*ImportOutput, error) {
	if db == nil {
		return nil, huma.Error500InternalServerError("database not available")
	}

	imp := input.Body
	ts := now()
	wfID := genID("wf-")
	verID := genID("ver-")

	// Build nodes
	nodes := make([]WorkflowNode, 0, len(imp.Nodes))
	for _, pn := range imp.Nodes {
		cfgStr := "{}"
		if pn.Config != nil {
			cfgStr = string(pn.Config)
		}
		nodeType := pn.Type
		if nodeType == "" {
			nodeType = "tool"
		}
		nodes = append(nodes, WorkflowNode{
			ID:     pn.ID,
			Type:   nodeType,
			Title:  pn.Title,
			Config: cfgStr,
		})
	}

	// Build edges
	edges := make([]WorkflowEdge, 0, len(imp.Edges))
	for _, pe := range imp.Edges {
		edges = append(edges, WorkflowEdge{
			ID:        genID("edge-"),
			Source:    pe.Source,
			Target:    pe.Target,
			Condition: pe.Condition,
			Label:     pe.Label,
		})
	}

	trigger := imp.Trigger
	if trigger.Type == "" {
		trigger.Type = "manual"
	}
	triggerJSON, _ := json.Marshal(trigger)

	definition := WorkflowDefinition{
		ID:              wfID,
		Name:            imp.Name,
		Description:     imp.Description,
		Trigger:         trigger,
		Nodes:           nodes,
		Edges:           edges,
		ActiveVersionID: "",
		CreatedAt:       ts,
		UpdatedAt:       ts,
	}
	defJSON, _ := json.Marshal(definition)

	mu.Lock()
	defer mu.Unlock()

	_, err := db.ExecContext(ctx,
		`INSERT INTO automation_control_workflows (id, name, description, active_version_id, created_at, updated_at)
		 VALUES (?, ?, ?, '', ?, ?)`,
		wfID, imp.Name, imp.Description, ts, ts)
	if err != nil {
		return nil, fmt.Errorf("insert workflow: %w", err)
	}

	_, err = db.ExecContext(ctx,
		`INSERT INTO automation_control_workflow_versions (id, workflow_id, version, definition_json, change_summary, created_by, status, created_at)
		 VALUES (?, ?, 1, ?, 'Imported from agent plan', 'agent', 'draft', ?)`,
		verID, wfID, string(defJSON), ts)
	if err != nil {
		return nil, fmt.Errorf("insert version: %w", err)
	}

	var wfDef WorkflowDefinition
	json.Unmarshal(defJSON, &wfDef)
	wfDef.Trigger = WorkflowTrigger{}
	json.Unmarshal(triggerJSON, &wfDef.Trigger)

	output := &ImportOutput{Body: wfDef}
	return output, nil
}
