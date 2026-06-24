package automationcontrol

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

// ── Trigger Run Input ─────────────────────────────────────────

type TriggerRunInput struct {
	ID string `path:"id" doc:"Workflow ID" example:"wf-abc123"`
}

type TriggerRunOutput struct {
	Body WorkflowRun
}

// ── Trigger Workflow Run ──────────────────────────────────────

func TriggerWorkflowRun(ctx context.Context, input *TriggerRunInput) (*TriggerRunOutput, error) {
	if db == nil {
		return nil, huma.Error500InternalServerError("database not available")
	}

	mu.Lock()
	defer mu.Unlock()

	// Load workflow
	var wfName, wfDesc string
	if err := db.QueryRowContext(ctx,
		`SELECT name, description FROM automation_control_workflows WHERE id = ?`, input.ID).
		Scan(&wfName, &wfDesc); err != nil {
		return nil, huma.Error404NotFound("workflow not found")
	}

	// Load active or latest draft version
	var verID, defJSON string
	var verNum int
	err := db.QueryRowContext(ctx,
		`SELECT id, version, definition_json FROM automation_control_workflow_versions
		 WHERE workflow_id = ? AND status = 'active'
		 UNION ALL
		 SELECT id, version, definition_json FROM automation_control_workflow_versions
		 WHERE workflow_id = ? AND status = 'draft'
		 ORDER BY version DESC LIMIT 1`, input.ID, input.ID).Scan(&verID, &verNum, &defJSON)
	if err != nil {
		return nil, huma.Error404NotFound("no workflow version found")
	}

	var def WorkflowDefinition
	if err := json.Unmarshal([]byte(defJSON), &def); err != nil {
		return nil, fmt.Errorf("parse definition: %w", err)
	}

	// Create run record
	runID := genID("run-")
	ts := now()
	_, err = db.ExecContext(ctx,
		`INSERT INTO automation_control_workflow_runs (id, workflow_id, workflow_version_id, status, trigger_type, trigger_payload_json, started_at, ended_at, duration_ms, failed_node_run_id, error_message, last_sequence, created_at)
		 VALUES (?, ?, ?, 'running', 'manual', '', ?, '', 0, '', '', 0, ?)`,
		runID, input.ID, verID, ts, ts)
	if err != nil {
		return nil, fmt.Errorf("create run: %w", err)
	}

	// Create node runs
	nodeRunMap := make(map[string]string) // nodeId → nodeRunId
	for _, node := range def.Nodes {
		nrID := genID("nr-")
		nodeRunMap[node.ID] = nrID
		cfgJSON, _ := json.Marshal(node.Config)
		_, err = db.ExecContext(ctx,
			`INSERT INTO automation_control_workflow_node_runs (id, run_id, node_id, title, type, status, input_json, output_json, error_json, started_at, ended_at, duration_ms, retry_count, skipped_reason)
			 VALUES (?, ?, ?, ?, ?, 'pending', ?, 'null', 'null', '', '', 0, 0, '')`,
			nrID, runID, node.ID, node.Title, node.Type, string(cfgJSON))
		if err != nil {
			return nil, fmt.Errorf("create node run: %w", err)
		}
	}

	// ── Simulate execution ──────────────────────────────────────
	// MVP: simulate each node with realistic timings and random outcomes

	type nodeInfo struct {
		NodeID   string
		NodeRunID string
		Title    string
		Type     string
		Config   string
	}

	// Simple topological sort by traversing edges
	completed := make(map[string]bool)
	var failedNodeRunID string
	runStatus := "success"
	seq := 0

	// For MVP, simulate nodes in definition order (topological sort would need proper DAG analysis)
	for _, node := range def.Nodes {
		nrID := nodeRunMap[node.ID]
		startedTs := time.Now().UTC().Format(time.RFC3339)

		// Simulate execution time (300-2000ms)
		sleepMs := 300 + rand.Intn(1700)
		time.Sleep(time.Duration(sleepMs) * time.Millisecond)

		// Simulate success/failure (85% success rate)
		success := rand.Float64() < 0.85

		endedTs := time.Now().UTC().Format(time.RFC3339)
		dur := int64(sleepMs)
		seq++

		if success {
			output := map[string]interface{}{
				"result":  "simulated success",
				"nodeId":  node.ID,
				"title":   node.Title,
				"type":    node.Type,
			}
			outputJSON, _ := json.Marshal(output)

			db.ExecContext(ctx,
				`UPDATE automation_control_workflow_node_runs
				 SET status = 'success', output_json = ?, started_at = ?, ended_at = ?, duration_ms = ?
				 WHERE id = ?`,
				string(outputJSON), startedTs, endedTs, dur, nrID)

			// Create success trace span
			spanID := genID("span-")
			spanType := resolveSpanType(node.Type)
			spanInput, _ := json.Marshal(map[string]interface{}{"nodeId": node.ID, "config": node.Config})
			spanOutput, _ := json.Marshal(output)
			spanMeta, _ := json.Marshal(map[string]interface{}{"simulated": true, "durationMs": dur})

			db.ExecContext(ctx,
				`INSERT INTO automation_control_trace_spans (id, run_id, node_run_id, parent_span_id, title, type, status, input_json, output_json, error_json, metadata_json, artifact_ids_json, started_at, ended_at, duration_ms)
				 VALUES (?, ?, ?, '', ?, ?, 'success', ?, ?, 'null', ?, '[]', ?, ?, ?)`,
				spanID, runID, nrID, node.Title, spanType, string(spanInput), string(spanOutput), string(spanMeta), startedTs, endedTs, dur)

			completed[node.ID] = true
		} else {
			// Node failed
			errMsg := fmt.Sprintf("Simulated failure in node: %s", node.Title)
			nodeError := SerializedError{
				Name:    "SimulatedError",
				Message: errMsg,
			}
			errorJSON, _ := json.Marshal(nodeError)
			outputJSON, _ := json.Marshal(map[string]interface{}{"error": errMsg})

			db.ExecContext(ctx,
				`UPDATE automation_control_workflow_node_runs
				 SET status = 'failed', output_json = ?, error_json = ?, started_at = ?, ended_at = ?, duration_ms = ?
				 WHERE id = ?`,
				string(outputJSON), string(errorJSON), startedTs, endedTs, dur, nrID)

			failedNodeRunID = nrID
			runStatus = "failed"
			seq++

			// Create failed trace span
			spanID := genID("span-")
			spanType := resolveSpanType(node.Type)
			spanInput, _ := json.Marshal(map[string]interface{}{"nodeId": node.ID})
			spanErrorJSON, _ := json.Marshal(nodeError)
			spanMeta, _ := json.Marshal(map[string]interface{}{"simulated": true, "durationMs": dur})

			db.ExecContext(ctx,
				`INSERT INTO automation_control_trace_spans (id, run_id, node_run_id, parent_span_id, title, type, status, input_json, output_json, error_json, metadata_json, artifact_ids_json, started_at, ended_at, duration_ms)
				 VALUES (?, ?, ?, '', ?, ?, 'failed', ?, 'null', ?, ?, '[]', ?, ?, ?)`,
				spanID, runID, nrID, node.Title, spanType, string(spanInput), string(spanErrorJSON), string(spanMeta), startedTs, endedTs, dur)

			// For browser failures, create screenshot artifact
			if node.Type == "browser" {
				artID := genID("art-")
				db.ExecContext(ctx,
					`INSERT INTO automation_control_run_artifacts (id, run_id, node_run_id, span_id, type, name, url, storage_key, content_preview, metadata_json, created_at)
					 VALUES (?, ?, ?, ?, 'screenshot', '失败截图', '', '', 'HTML snippet: product-price element found instead of .price', '{}', ?)`,
					artID, runID, nrID, spanID, endedTs)
			}

			break // Stop execution on first failure (default behavior)
		}
	}

	// Update run final status
	runEndedTs := time.Now().UTC().Format(time.RFC3339)
	db.ExecContext(ctx,
		`UPDATE automation_control_workflow_runs
		 SET status = ?, failed_node_run_id = ?, ended_at = ?, duration_ms = ?, last_sequence = ?
		 WHERE id = ?`,
		runStatus, failedNodeRunID, runEndedTs, int64(0), seq, runID)

	// Generate auto-review
	if runStatus == "failed" {
		generateAutoReview(ctx, runID, input.ID, failedNodeRunID)
	}

	// Load complete run for response
	var r WorkflowRun
	db.QueryRowContext(ctx,
		`SELECT id, workflow_id, workflow_version_id, status, trigger_type, trigger_payload_json,
		 started_at, ended_at, duration_ms, failed_node_run_id, error_message, last_sequence, created_at
		 FROM automation_control_workflow_runs WHERE id = ?`, runID).
		Scan(&r.ID, &r.WorkflowID, &r.WorkflowVersionID, &r.Status, &r.TriggerType,
			&r.TriggerPayload, &r.StartedAt, &r.EndedAt, &r.DurationMs, &r.FailedNodeRunID,
			&r.ErrorMessage, &r.LastSequence, &r.CreatedAt)

	// Load node runs
	nodeRows, err := db.QueryContext(ctx,
		`SELECT id, run_id, node_id, title, type, status, input_json, output_json, error_json,
		 started_at, ended_at, duration_ms, retry_count, skipped_reason
		 FROM automation_control_workflow_node_runs WHERE run_id = ? ORDER BY started_at ASC`, runID)
	if err == nil {
		defer nodeRows.Close()
		for nodeRows.Next() {
			var nr WorkflowNodeRun
			var inJSON, outJSON, errJSON string
			if err := nodeRows.Scan(&nr.ID, &nr.RunID, &nr.NodeID, &nr.Title, &nr.Type, &nr.Status,
				&inJSON, &outJSON, &errJSON, &nr.StartedAt, &nr.EndedAt, &nr.DurationMs,
				&nr.RetryCount, &nr.SkippedReason); err != nil {
				continue
			}
			if inJSON != "" && inJSON != "null" {
				nr.Input = json.RawMessage(inJSON)
			}
			if outJSON != "" && outJSON != "null" {
				nr.Output = json.RawMessage(outJSON)
			}
			if errJSON != "" && errJSON != "null" {
				var se SerializedError
				if json.Unmarshal([]byte(errJSON), &se) == nil {
					nr.Error = &se
				}
			}
			r.NodeRuns = append(r.NodeRuns, nr)
		}
	}
	if r.NodeRuns == nil {
		r.NodeRuns = []WorkflowNodeRun{}
	}

	output := &TriggerRunOutput{Body: r}
	return output, nil
}

func resolveSpanType(nodeType string) string {
	switch nodeType {
	case "browser":
		return "browser_action"
	case "api":
		return "api_call"
	case "agent":
		return "agent_thought"
	case "condition":
		return "condition_check"
	case "code":
		return "code_execution"
	default:
		return "tool_call"
	}
}

func generateAutoReview(ctx context.Context, runID, workflowID, failedNodeRunID string) {
	reviewID := genID("review-")
	ts := now()

	// Find failed node info
	var nodeTitle, nodeType, errorJSON string
	db.QueryRowContext(ctx,
		`SELECT title, type, error_json FROM automation_control_workflow_node_runs WHERE id = ?`,
		failedNodeRunID).Scan(&nodeTitle, &nodeType, &errorJSON)

	bottlenecks, _ := json.Marshal([]ReviewBottleneck{
		{NodeID: failedNodeRunID, NodeRunID: failedNodeRunID, Issue: fmt.Sprintf("节点 %s (%s) 执行失败", nodeTitle, nodeType), Evidence: errorJSON, Impact: "high"},
	})

	db.ExecContext(ctx,
		`INSERT INTO automation_control_workflow_run_reviews (id, run_id, workflow_id, status, summary, bottlenecks_json, learned_facts_json, suggestion_ids_json, risk_assessment, created_at)
		 VALUES (?, ?, ?, 'failed', ?, ?, '[]', '[]', 'high', ?)`,
		reviewID, runID, workflowID,
		fmt.Sprintf("自动化运行失败：节点 '%s' (%s) 执行出错。建议检查节点配置和输入参数。", nodeTitle, nodeType),
		string(bottlenecks), ts)
}
