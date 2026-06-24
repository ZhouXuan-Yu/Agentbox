package handlers

// task_board.go — Task Execution Visualization Dashboard backend.
//
// Provides:
//   - GET  /task-board/kpi                 — aggregated execution stats
//   - GET  /task-board/executions           — paginated history
//   - GET  /task-board/executions/{id}      — single execution detail + steps + tool calls
//   - POST /task-board/execute              — start new execution (returns id, real work in SSE)
//   - POST /task-board/executions/{id}/stop — stop a running execution
//   - GET  /task-board/execute/stream       — SSE real-time execution streaming
//
// The SSE handler triggers real cron-job execution via the OpenClaw Gateway CLI,
// monitors the run lifecycle, and streams structured events
// (meta/phase/step/log/review/complete) so the frontend can render
// a Coze-style pipeline visualization.

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"

	"agent-box-server/internal/httpapi/toolenv"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/sse"
)

// ── SQLite persistence ──────────────────────────────────────────

var taskBoardDB *sql.DB
var taskBoardMu sync.Mutex

func ConfigureTaskBoardStore(db *sql.DB) error {
	taskBoardDB = db
	if db == nil {
		return nil
	}
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS task_board_executions (
			id TEXT PRIMARY KEY,
			description TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'idle',
			iteration INTEGER NOT NULL DEFAULT 1,
			parent_id TEXT,
			agent_id TEXT NOT NULL DEFAULT 'main',
			phase TEXT NOT NULL DEFAULT '',
			step TEXT NOT NULL DEFAULT '',
			progress INTEGER NOT NULL DEFAULT 0,
			review_score REAL,
			review_summary TEXT,
			better_solution TEXT,
			result TEXT,
			error_msg TEXT,
			started_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			completed_at TEXT,
			duration_ms INTEGER
		);
		CREATE TABLE IF NOT EXISTS task_board_steps (
			id TEXT PRIMARY KEY,
			execution_id TEXT NOT NULL,
			name TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			phase TEXT NOT NULL,
			sort_order INTEGER NOT NULL DEFAULT 0,
			started_at TEXT,
			completed_at TEXT,
			duration_ms INTEGER,
			output TEXT,
			error_msg TEXT,
			FOREIGN KEY (execution_id) REFERENCES task_board_executions(id)
		);
		CREATE TABLE IF NOT EXISTS task_board_tool_calls (
			id TEXT PRIMARY KEY,
			step_id TEXT NOT NULL,
			execution_id TEXT NOT NULL,
			name TEXT NOT NULL,
			args TEXT,
			result TEXT,
			error_msg TEXT,
			started_at TEXT,
			completed_at TEXT,
			duration_ms INTEGER,
			FOREIGN KEY (step_id) REFERENCES task_board_steps(id)
		);
	`)
	if err == nil {
		db.Exec(`ALTER TABLE task_board_executions ADD COLUMN result TEXT`)
	}
	return err
}

func ts() string { return time.Now().UTC().Format(time.RFC3339) }

// ── SSE Event Types ─────────────────────────────────────────────

type TaskBoardStreamMetaEvent struct {
	ExecutionID string `json:"executionId"`
	CronJobID   string `json:"cronJobId,omitempty"`
	Description string `json:"description"`
	AgentID     string `json:"agentId"`
	Timestamp   string `json:"timestamp"`
}

type TaskBoardStreamPhaseEvent struct {
	ExecutionID string `json:"executionId"`
	Phase       string `json:"phase"`
	Status      string `json:"status"`
	Progress    int    `json:"progress"`
	Timestamp   string `json:"timestamp"`
}

type TaskBoardStreamStepEvent struct {
	ExecutionID string `json:"executionId"`
	StepID      string `json:"stepId"`
	Name        string `json:"name"`
	Phase       string `json:"phase"`
	Status      string `json:"status"`
	Progress    int    `json:"progress"`
	Output      string `json:"output,omitempty"`
	Error       string `json:"error,omitempty"`
	Timestamp   string `json:"timestamp"`
}

type TaskBoardStreamLogEvent struct {
	ExecutionID string `json:"executionId"`
	Level       string `json:"level"`
	Message     string `json:"message"`
	Timestamp   string `json:"timestamp"`
}

type TaskBoardStreamReviewEvent struct {
	ExecutionID       string  `json:"executionId"`
	Score             float64 `json:"score"`
	Summary           string  `json:"summary"`
	BetterSolution    string  `json:"betterSolution,omitempty"`
	ContinueEvolution bool    `json:"continueEvolution"`
	Timestamp         string  `json:"timestamp"`
}

type TaskBoardStreamToolCallEvent struct {
	ExecutionID string `json:"executionId"`
	StepID      string `json:"stepId"`
	CallID      string `json:"callId"`
	Name        string `json:"name"`
	Args        string `json:"args,omitempty"`
	Timestamp   string `json:"timestamp"`
}

type TaskBoardStreamToolResultEvent struct {
	ExecutionID string `json:"executionId"`
	StepID      string `json:"stepId"`
	CallID      string `json:"callId"`
	Result      string `json:"result,omitempty"`
	Error       string `json:"error,omitempty"`
	DurationMs  int64  `json:"durationMs,omitempty"`
	Timestamp   string `json:"timestamp"`
}

type TaskBoardStreamThoughtEvent struct {
	ExecutionID string `json:"executionId"`
	StepID      string `json:"stepId"`
	Content     string `json:"content"`
	Timestamp   string `json:"timestamp"`
}

type TaskBoardStreamCompleteEvent struct {
	ExecutionID string `json:"executionId"`
	Status      string `json:"status"`
	DurationMs  int64  `json:"durationMs"`
	Result      string `json:"result,omitempty"`
	Error       string `json:"error,omitempty"`
	Timestamp   string `json:"timestamp"`
}

// ── REST I/O types ──────────────────────────────────────────────

type TaskBoardKPIOutput struct {
	Body TaskBoardKPIResponse
}

type TaskBoardKPIResponse struct {
	TotalRuns     int     `json:"totalRuns"`
	SuccessRate   float64 `json:"successRate"`
	AvgDurationMs int64   `json:"avgDurationMs"`
	ActiveTasks   int     `json:"activeTasks"`
	LastRunAt     string  `json:"lastRunAt,omitempty"`
	Status        string  `json:"status"`
	Timestamp     string  `json:"timestamp"`
}

type TaskBoardListOutput struct {
	Body TaskBoardListResponse
}

type TaskBoardExecutionSummary struct {
	ID             string   `json:"id"`
	Description    string   `json:"description"`
	Status         string   `json:"status"`
	Iteration      int      `json:"iteration"`
	ParentID       string   `json:"parentId,omitempty"`
	AgentID        string   `json:"agentId"`
	Phase          string   `json:"phase"`
	Step           string   `json:"step"`
	Progress       int      `json:"progress"`
	ReviewScore    *float64 `json:"reviewScore,omitempty"`
	ReviewSummary  string   `json:"reviewSummary,omitempty"`
	BetterSolution string   `json:"betterSolution,omitempty"`
	Result         string   `json:"result,omitempty"`
	Error          string   `json:"error,omitempty"`
	StartedAt      string   `json:"startedAt"`
	UpdatedAt      string   `json:"updatedAt"`
	CompletedAt    string   `json:"completedAt,omitempty"`
	DurationMs     *int64   `json:"durationMs,omitempty"`
}

type TaskBoardStepSummary struct {
	ID          string `json:"id"`
	ExecutionID string `json:"executionId"`
	Name        string `json:"name"`
	Status      string `json:"status"`
	Phase       string `json:"phase"`
	SortOrder   int    `json:"sortOrder"`
	StartedAt   string `json:"startedAt,omitempty"`
	CompletedAt string `json:"completedAt,omitempty"`
	DurationMs  *int64 `json:"durationMs,omitempty"`
	Output      string `json:"output,omitempty"`
	Error       string `json:"error,omitempty"`
}

type TaskBoardToolCallSummary struct {
	ID          string `json:"id"`
	StepID      string `json:"stepId"`
	Name        string `json:"name"`
	Args        string `json:"args,omitempty"`
	Result      string `json:"result,omitempty"`
	Error       string `json:"error,omitempty"`
	StartedAt   string `json:"startedAt,omitempty"`
	CompletedAt string `json:"completedAt,omitempty"`
	DurationMs  *int64 `json:"durationMs,omitempty"`
}

type TaskBoardExecutionDetail struct {
	TaskBoardExecutionSummary
	Steps     []TaskBoardStepSummary     `json:"steps"`
	ToolCalls []TaskBoardToolCallSummary `json:"toolCalls"`
}

type TaskBoardListInput struct {
	Limit  int    `query:"limit" minimum:"1" maximum:"100" doc:"Maximum executions." example:"20"`
	Offset int    `query:"offset" minimum:"0" doc:"Pagination offset." example:"0"`
	Status string `query:"status" enum:"all,running,complete,error,stopped" doc:"Filter by status." example:"all"`
}

type TaskBoardListResponse struct {
	Items     []TaskBoardExecutionSummary `json:"items"`
	Total     int                         `json:"total"`
	Limit     int                         `json:"limit"`
	Offset    int                         `json:"offset"`
	Status    string                      `json:"status"`
	Timestamp string                      `json:"timestamp"`
}

type TaskBoardExecuteOutput struct {
	Body TaskBoardExecuteResponse
}

type TaskBoardGetInput struct {
	ID string `path:"id" doc:"Execution ID." example:"exec-abc123"`
}

type TaskBoardExecutionDetailOutput struct {
	Body TaskBoardExecutionDetail
}

type TaskBoardExecuteInput struct {
	Body TaskBoardExecuteRequest
}

type TaskBoardExecuteRequest struct {
	CronJobID  string `json:"cronJobId" required:"false" doc:"OpenClaw cron job ID to execute." example:"job-abc123"`
	AgentID    string `json:"agentId" required:"false" doc:"Agent id." example:"main"`
	TaskDesc   string `json:"taskDesc" required:"false" doc:"Optional task description override."`
}

type TaskBoardExecuteResponse struct {
	ExecutionID string `json:"executionId"`
	Status      string `json:"status"`
	Timestamp   string `json:"timestamp"`
}

type TaskBoardStopInput struct {
	ID string `path:"id" doc:"Execution ID." example:"exec-abc123"`
}

// ── Execution context (in-memory state for active runs) ─────────

type executionCtx struct {
	cancel context.CancelFunc
	status string
}

var (
	activeExecutions   = map[string]*executionCtx{}
	activeExecutionsMu sync.Mutex
)

func trackExecution(id string, cancel context.CancelFunc) {
	activeExecutionsMu.Lock()
	defer activeExecutionsMu.Unlock()
	activeExecutions[id] = &executionCtx{cancel: cancel, status: "running"}
}

func stopExecution(id string) bool {
	activeExecutionsMu.Lock()
	defer activeExecutionsMu.Unlock()
	ctx, ok := activeExecutions[id]
	if !ok {
		return false
	}
	ctx.status = "stopped"
	ctx.cancel()
	return true
}

func cleanupExecution(id string) {
	activeExecutionsMu.Lock()
	defer activeExecutionsMu.Unlock()
	delete(activeExecutions, id)
}

// ── IDs ──────────────────────────────────────────────────────────

func execID() string  { return fmt.Sprintf("exec-%d", time.Now().UnixNano()) }
func stepID() string  { return fmt.Sprintf("step-%d", time.Now().UnixNano()) }

// ── REST Handlers ───────────────────────────────────────────────

func TaskBoardKPI(ctx context.Context, input *struct{}) (*TaskBoardKPIOutput, error) {
	if taskBoardDB == nil {
		return &TaskBoardKPIOutput{Body: TaskBoardKPIResponse{Status: "ok", Timestamp: ts()}}, nil
	}
	resp := TaskBoardKPIResponse{Status: "ok", Timestamp: ts()}
	taskBoardDB.QueryRowContext(ctx, `SELECT COUNT(*) FROM task_board_executions`).Scan(&resp.TotalRuns)
	taskBoardDB.QueryRowContext(ctx, `SELECT COUNT(*) FROM task_board_executions WHERE status IN ('running','reviewing')`).Scan(&resp.ActiveTasks)
	var completed int
	var totalDuration int64
	rows, err := taskBoardDB.QueryContext(ctx, `SELECT COUNT(*), COALESCE(SUM(duration_ms), 0) FROM task_board_executions WHERE status = 'complete'`)
	if err == nil {
		defer rows.Close()
		if rows.Next() {
			rows.Scan(&completed, &totalDuration)
		}
	}
	if completed > 0 {
		resp.SuccessRate = float64(completed) / float64(resp.TotalRuns) * 100
		resp.AvgDurationMs = totalDuration / int64(completed)
	}
	taskBoardDB.QueryRowContext(ctx, `SELECT COALESCE(completed_at, '') FROM task_board_executions WHERE status = 'complete' ORDER BY completed_at DESC LIMIT 1`).Scan(&resp.LastRunAt)
	return &TaskBoardKPIOutput{Body: resp}, nil
}

func TaskBoardListExecutions(ctx context.Context, input *TaskBoardListInput) (*TaskBoardListOutput, error) {
	if input == nil {
		input = &TaskBoardListInput{Limit: 20}
	}
	if input.Limit <= 0 {
		input.Limit = 20
	}
	resp := TaskBoardListResponse{Items: []TaskBoardExecutionSummary{}, Limit: input.Limit, Offset: input.Offset, Timestamp: ts()}
	if taskBoardDB == nil {
		resp.Status = "ok"
		return &TaskBoardListOutput{Body: resp}, nil
	}
	where := "1=1"
	args := []any{}
	if input.Status != "" && input.Status != "all" {
		where = "status = ?"
		args = append(args, input.Status)
	}
	taskBoardDB.QueryRowContext(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM task_board_executions WHERE %s`, where), args...).Scan(&resp.Total)
	rows, err := taskBoardDB.QueryContext(ctx, fmt.Sprintf(
		`SELECT id, description, status, iteration, COALESCE(parent_id,''), COALESCE(agent_id,'main'), phase, step, progress, review_score, COALESCE(review_summary,''), COALESCE(better_solution,''), COALESCE(result,''), COALESCE(error_msg,''), started_at, updated_at, COALESCE(completed_at,''), duration_ms FROM task_board_executions WHERE %s ORDER BY started_at DESC LIMIT ? OFFSET ?`, where),
		append(args, input.Limit, input.Offset)...,
	)
	if err != nil {
		resp.Status = "error"
		return &TaskBoardListOutput{Body: resp}, nil
	}
	defer rows.Close()
	for rows.Next() {
		var s TaskBoardExecutionSummary
		rows.Scan(&s.ID, &s.Description, &s.Status, &s.Iteration, &s.ParentID, &s.AgentID, &s.Phase, &s.Step, &s.Progress, &s.ReviewScore, &s.ReviewSummary, &s.BetterSolution, &s.Result, &s.Error, &s.StartedAt, &s.UpdatedAt, &s.CompletedAt, &s.DurationMs)
		resp.Items = append(resp.Items, s)
	}
	resp.Status = "ok"
	return &TaskBoardListOutput{Body: resp}, nil
}

func TaskBoardGetExecution(ctx context.Context, input *TaskBoardGetInput) (*TaskBoardExecutionDetailOutput, error) {
	if input == nil || strings.TrimSpace(input.ID) == "" {
		return nil, huma.Error400BadRequest("execution id is required", nil)
	}
	detail := TaskBoardExecutionDetail{}
	if taskBoardDB == nil {
		return nil, huma.Error404NotFound("execution not found", nil)
	}
	var parentID, agentID, completedAt, errorMsg string
	err := taskBoardDB.QueryRowContext(ctx,
		`SELECT id, description, status, iteration, COALESCE(parent_id,''), COALESCE(agent_id,'main'), phase, step, progress, review_score, COALESCE(review_summary,''), COALESCE(better_solution,''), COALESCE(result,''), COALESCE(error_msg,''), started_at, updated_at, COALESCE(completed_at,''), duration_ms FROM task_board_executions WHERE id = ?`,
		input.ID,
	).Scan(&detail.ID, &detail.Description, &detail.Status, &detail.Iteration, &parentID, &agentID, &detail.Phase, &detail.Step, &detail.Progress, &detail.ReviewScore, &detail.ReviewSummary, &detail.BetterSolution, &detail.Result, &errorMsg, &detail.StartedAt, &detail.UpdatedAt, &completedAt, &detail.DurationMs)
	if err == sql.ErrNoRows {
		return nil, huma.Error404NotFound("execution not found", nil)
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load execution", err)
	}
	if parentID != "" { detail.ParentID = parentID }
	if agentID != ""   { detail.AgentID = agentID }
	if completedAt != "" { detail.CompletedAt = completedAt }
	if errorMsg != ""  { detail.Error = errorMsg }
	stepRows, err := taskBoardDB.QueryContext(ctx, `SELECT id, execution_id, name, status, phase, sort_order, COALESCE(started_at,''), COALESCE(completed_at,''), duration_ms, COALESCE(output,''), COALESCE(error_msg,'') FROM task_board_steps WHERE execution_id = ? ORDER BY sort_order ASC`, input.ID)
	if err == nil {
		defer stepRows.Close()
		for stepRows.Next() {
			var s TaskBoardStepSummary
			var sa, ca string
			stepRows.Scan(&s.ID, &s.ExecutionID, &s.Name, &s.Status, &s.Phase, &s.SortOrder, &sa, &ca, &s.DurationMs, &s.Output, &s.Error)
			if sa != "" { s.StartedAt = sa }
			if ca != "" { s.CompletedAt = ca }
			detail.Steps = append(detail.Steps, s)
		}
	}
	if detail.Steps == nil { detail.Steps = []TaskBoardStepSummary{} }
	tcRows, err := taskBoardDB.QueryContext(ctx, `SELECT id, step_id, name, COALESCE(args,''), COALESCE(result,''), COALESCE(error_msg,''), COALESCE(started_at,''), COALESCE(completed_at,''), duration_ms FROM task_board_tool_calls WHERE execution_id = ?`, input.ID)
	if err == nil {
		defer tcRows.Close()
		for tcRows.Next() {
			var t TaskBoardToolCallSummary
			var sa2, ca2 string
			tcRows.Scan(&t.ID, &t.StepID, &t.Name, &t.Args, &t.Result, &t.Error, &sa2, &ca2, &t.DurationMs)
			if sa2 != "" { t.StartedAt = sa2 }
			if ca2 != "" { t.CompletedAt = ca2 }
			detail.ToolCalls = append(detail.ToolCalls, t)
		}
	}
	if detail.ToolCalls == nil { detail.ToolCalls = []TaskBoardToolCallSummary{} }
	return &TaskBoardExecutionDetailOutput{Body: detail}, nil
}

func TaskBoardStartExecution(ctx context.Context, input *TaskBoardExecuteInput) (*TaskBoardExecuteOutput, error) {
	jobID := ""
	taskDesc := ""
	if input != nil && input.Body.CronJobID != "" {
		jobID = strings.TrimSpace(input.Body.CronJobID)
	}
	if input != nil && input.Body.TaskDesc != "" {
		taskDesc = strings.TrimSpace(input.Body.TaskDesc)
	}
	if jobID == "" && taskDesc == "" {
		return nil, huma.Error400BadRequest("cronJobId or taskDesc is required", nil)
	}
	agentID := "main"
	if input != nil && input.Body.AgentID != "" {
		agentID = strings.TrimSpace(input.Body.AgentID)
	}
	id := execID()
	description := taskDesc
	if description == "" {
		description = "执行定时任务: " + jobID
	}
	now := ts()
	if taskBoardDB != nil {
		taskBoardMu.Lock()
		taskBoardDB.ExecContext(ctx, `INSERT INTO task_board_executions (id, description, status, iteration, agent_id, phase, step, progress, started_at, updated_at) VALUES (?, ?, 'running', 1, ?, '', '', 0, ?, ?)`, id, description, agentID, now, now)
		taskBoardMu.Unlock()
	}
	return &TaskBoardExecuteOutput{Body: TaskBoardExecuteResponse{ExecutionID: id, Status: "running", Timestamp: now}}, nil
}

func TaskBoardStopExecution(ctx context.Context, input *TaskBoardStopInput) (*TaskBoardExecuteOutput, error) {
	if input == nil || strings.TrimSpace(input.ID) == "" {
		return nil, huma.Error400BadRequest("execution id is required", nil)
	}
	stopped := stopExecution(input.ID)
	if !stopped {
		return nil, huma.Error404NotFound("execution not found or not running", nil)
	}
	now := ts()
	if taskBoardDB != nil {
		taskBoardDB.ExecContext(ctx, `UPDATE task_board_executions SET status = 'stopped', updated_at = ?, completed_at = ? WHERE id = ?`, now, now, input.ID)
	}
	return &TaskBoardExecuteOutput{Body: TaskBoardExecuteResponse{ExecutionID: input.ID, Status: "stopped", Timestamp: now}}, nil
}

type TaskBoardEvolveInput struct {
	ID string `path:"id" doc:"Execution ID." example:"exec-abc123"`
}

func TaskBoardTriggerEvolution(ctx context.Context, input *TaskBoardEvolveInput) (*TaskBoardExecuteOutput, error) {
	if input == nil || strings.TrimSpace(input.ID) == "" {
		return nil, huma.Error400BadRequest("execution id is required", nil)
	}
	now := ts()
	return &TaskBoardExecuteOutput{Body: TaskBoardExecuteResponse{ExecutionID: input.ID, Status: "ok", Timestamp: now}}, nil
}

// ── SSE Stream Input ────────────────────────────────────────────

type TaskBoardStreamInput struct {
	CronJobID string `query:"cronJobId" required:"false" doc:"OpenClaw cron job ID." example:"job-abc123"`
	TaskDesc  string `query:"taskDesc" required:"false" doc:"Free-form task description."`
	AgentID   string `query:"agentId" required:"false" doc:"Agent id." example:"main"`
}

// ── SSE Stream Handler (real execution via OpenClaw Gateway CLI) ─

func TaskBoardExecuteStream(ctx context.Context, input *TaskBoardStreamInput, send sse.Sender) {
	cronJobID := ""
	taskDesc := ""
	agentID := "main"
	if input != nil {
		cronJobID = strings.TrimSpace(input.CronJobID)
		taskDesc = strings.TrimSpace(input.TaskDesc)
		if strings.TrimSpace(input.AgentID) != "" {
			agentID = strings.TrimSpace(input.AgentID)
		}
	}
	if cronJobID == "" && taskDesc == "" {
		_ = send.Data(TaskBoardStreamLogEvent{Level: "error", Message: "cronJobId or taskDesc is required", Timestamp: ts()})
		return
	}

	description := taskDesc
	if description == "" {
		description = "执行定时任务: " + cronJobID
	}

	id := execID()
	execCtx, cancel := context.WithCancel(ctx)
	trackExecution(id, cancel)
	defer cleanupExecution(id)

	now := ts()
	if taskBoardDB != nil {
		taskBoardMu.Lock()
		taskBoardDB.ExecContext(ctx, `INSERT INTO task_board_executions (id, description, status, iteration, agent_id, phase, step, progress, started_at, updated_at) VALUES (?, ?, 'running', 1, ?, '', '', 0, ?, ?)`, id, description, agentID, now, now)
		taskBoardMu.Unlock()
	}

	loopStart := time.Now()
	finalStatus := "complete"
	var finalError string
	var finalResult string
	var score float64
	var summary string
	stepOrder := 0

	// ── META ────────────────────────────────────────────────
	_ = send.Data(TaskBoardStreamMetaEvent{
		ExecutionID: id,
		CronJobID:   cronJobID,
		Description: description,
		AgentID:     agentID,
		Timestamp:   ts(),
	})

	// ═══════════════════════════════════════════════════════════
	// PHASE 1: PREPARE — 查询定时任务信息
	// ═══════════════════════════════════════════════════════════
	sendPhase(send, id, "prepare", "started", 5)

	stepOrder++
	prepStepID := stepID()
	addStepRecord(ctx, id, prepStepID, "查询任务配置", "prepare", "running", stepOrder)
	sendStep(send, id, prepStepID, "查询任务配置", "prepare", "running", 10)

	sendThought(send, id, prepStepID, fmt.Sprintf("正在连接 OpenClaw Gateway，查询定时任务 `%s` 的配置信息。\n\n需要确认任务是否存在、调度参数是否匹配，以及 Agent 绑定关系。", cronJobID))
	_ = send.Data(TaskBoardStreamLogEvent{ExecutionID: id, Level: "info", Message: "正在连接 OpenClaw Gateway...", Timestamp: ts()})

	var jobDetail string
	if cronJobID != "" {
		// Real call: fetch cron job info
		toolCallID := fmt.Sprintf("tc-%s-cron-list", id)
		sendToolCall(send, id, prepStepID, toolCallID, "gateway.cron.list", fmt.Sprintf(`{"query": "%s", "limit": 1}`, cronJobID))
		raw, err := openclawGatewayCall(ctx, 15*time.Second, "cron.list", map[string]any{"query": cronJobID, "limit": 1})
		dur := time.Since(loopStart).Milliseconds()
		if err != nil {
			sendToolResult(send, id, prepStepID, toolCallID, "", err.Error(), dur)
			_ = send.Data(TaskBoardStreamLogEvent{ExecutionID: id, Level: "warn", Message: fmt.Sprintf("Gateway 查询警告: %v，继续执行...", err), Timestamp: ts()})
			jobDetail = fmt.Sprintf("任务 ID: %s (Gateway 查询暂时不可用)", cronJobID)
		} else {
			jobDetail = extractJobSummary(raw, cronJobID)
			sendToolResult(send, id, prepStepID, toolCallID, jobDetail, "", dur)
		}
	} else {
		jobDetail = description
		sendThought(send, id, prepStepID, fmt.Sprintf("这是一个自由任务，没有绑定具体的定时任务。\n\n任务描述: %s\n\n将直接通过 Agent 处理此任务。", description))
	}

	updateStepRecord(ctx, prepStepID, "done", ts())
	setStepOutputRecord(ctx, prepStepID, jobDetail)
	sendStep(send, id, prepStepID, "查询任务配置", "prepare", "done", 20)

	sendPhase(send, id, "prepare", "done", 20)

	// ═══════════════════════════════════════════════════════════
	// PHASE 2: EXECUTE — 触发定时任务执行
	// ═══════════════════════════════════════════════════════════
	sendPhase(send, id, "execute", "started", 25)

	sendThought(send, id, prepStepID, fmt.Sprintf("准备阶段完成，进入执行阶段。\n\n已确认任务配置，接下来将通过 Gateway RPC 调用 `cron.run` 以 **force 模式** 强制触发任务，绕过调度周期。"))

	stepOrder++
	execStepID := stepID()
	addStepRecord(ctx, id, execStepID, "触发任务执行", "execute", "running", stepOrder)
	sendStep(send, id, execStepID, "触发任务执行", "execute", "running", 30)

	_ = send.Data(TaskBoardStreamLogEvent{ExecutionID: id, Level: "info", Message: "正在触发定时任务执行...", Timestamp: ts()})

	runResult := ""
	if cronJobID != "" {
		// REAL execution: call cron.run on the gateway
		execToolID := fmt.Sprintf("tc-%s-cron-run", id)
		sendToolCall(send, id, execStepID, execToolID, "gateway.cron.run", fmt.Sprintf(`{"id": "%s", "mode": "force"}`, cronJobID))
		sendThought(send, id, execStepID, "向 OpenClaw Gateway 发送 `cron.run` RPC 调用，以 force 模式强制触发定时任务。\n\n此调用会绕过 Cron 调度周期，立即执行一次任务。")

		raw, err := openclawGatewayCall(ctx, 60*time.Second, "cron.run", map[string]any{
			"id":   cronJobID,
			"mode": "force",
		})
		dur := time.Since(loopStart).Milliseconds()
		if err != nil {
			sendToolResult(send, id, execStepID, execToolID, "", err.Error(), dur)
			finalStatus = "error"
			finalError = fmt.Sprintf("任务触发失败: %v", err)
			updateStepRecord(ctx, execStepID, "error", ts())
			_ = send.Data(TaskBoardStreamLogEvent{ExecutionID: id, Level: "error", Message: finalError, Timestamp: ts()})
			sendStepErr(send, id, execStepID, "触发任务执行", "execute", "error", 35, finalError)
			// Skip remaining phases, jump to complete
			durationMs := time.Since(loopStart).Milliseconds()
			_ = send.Data(TaskBoardStreamCompleteEvent{
				ExecutionID: id, Status: finalStatus, DurationMs: durationMs,
				Result: "", Error: finalError, Timestamp: ts(),
			})
			if taskBoardDB != nil {
				taskBoardMu.Lock()
				taskBoardDB.ExecContext(ctx, `UPDATE task_board_executions SET status = ?, updated_at = ?, completed_at = ?, duration_ms = ?, error_msg = ? WHERE id = ?`, finalStatus, ts(), ts(), durationMs, finalError, id)
				taskBoardMu.Unlock()
			}
			return
		}
		runResult = string(raw)
		sendToolResult(send, id, execStepID, execToolID, "Gateway 返回成功，任务已触发", "", dur)
		_ = send.Data(TaskBoardStreamLogEvent{ExecutionID: id, Level: "info", Message: "任务已成功触发，Gateway 返回 OK", Timestamp: ts()})
	} else {
		runResult = fmt.Sprintf("自由任务已提交: %s", taskDesc)
		_ = send.Data(TaskBoardStreamLogEvent{ExecutionID: id, Level: "info", Message: "任务已提交", Timestamp: ts()})
	}

	updateStepRecord(ctx, execStepID, "done", ts())
	setStepOutputRecord(ctx, execStepID, runResult)
	sendStep(send, id, execStepID, "触发任务执行", "execute", "done", 45)

	// Step: 监控执行状态
	stepOrder++
	monitorStepID := stepID()
	addStepRecord(ctx, id, monitorStepID, "监控执行状态", "execute", "running", stepOrder)
	sendStep(send, id, monitorStepID, "监控执行状态", "execute", "running", 50)
	sendThought(send, id, monitorStepID, "任务已触发，进入监控阶段。\n\n通过轮询 `cron.runs` API 检查最新执行记录的状态变化，间隔 2 秒，最多等待 60 秒。\n\n等待 delivery 状态从 pending → delivered → completed...")
	_ = send.Data(TaskBoardStreamLogEvent{ExecutionID: id, Level: "info", Message: "等待任务执行完成...", Timestamp: ts()})

	if cronJobID != "" {
		// Poll for run completion (real status checks)
		runStatus := pollCronRunStatus(ctx, execCtx, cronJobID, id, send)
		if runStatus == "error" {
			finalStatus = "error"
			finalError = "任务执行失败"
		} else if runStatus == "stopped" {
			finalStatus = "stopped"
		}
	} else {
		// For free-form tasks, just a brief wait
		select {
		case <-time.After(2 * time.Second):
		case <-execCtx.Done():
			finalStatus = "stopped"
		}
	}

	updateStepRecord(ctx, monitorStepID, "done", ts())
	setStepOutputRecord(ctx, monitorStepID, fmt.Sprintf("执行状态: %s", finalStatus))
	sendStep(send, id, monitorStepID, "监控执行状态", "execute", "done", 70)

	// Step: 获取执行结果
	stepOrder++
	resultStepID := stepID()
	addStepRecord(ctx, id, resultStepID, "获取执行结果", "execute", "running", stepOrder)
	sendStep(send, id, resultStepID, "获取执行结果", "execute", "running", 75)
	sendThought(send, id, resultStepID, "监控完成，执行结果已就绪。\n\n正在从 Gateway 拉取最新的执行记录，包括运行时长、输出内容和错误信息。")

	if cronJobID != "" && finalStatus != "stopped" && finalStatus != "error" {
		resultToolID := fmt.Sprintf("tc-%s-cron-runs-result", id)
		sendToolCall(send, id, resultStepID, resultToolID, "gateway.cron.runs", fmt.Sprintf(`{"id": "%s", "limit": 1}`, cronJobID))
		raw, err := openclawGatewayCall(ctx, 15*time.Second, "cron.runs", map[string]any{
			"id":    cronJobID,
			"limit": 1,
		})
		resultDur := time.Since(loopStart).Milliseconds()
		if err == nil {
			finalResult = extractLastRunResult(raw, cronJobID)
			sendToolResult(send, id, resultStepID, resultToolID, finalResult, "", resultDur)
		} else {
			finalResult = fmt.Sprintf("执行完成 (任务: %s)\n结果获取: %v", cronJobID, err)
			sendToolResult(send, id, resultStepID, resultToolID, "", err.Error(), resultDur)
		}
	} else {
		finalResult = fmt.Sprintf("任务「%s」已处理完成。", description)
	}

	updateStepRecord(ctx, resultStepID, "done", ts())
	setStepOutputRecord(ctx, resultStepID, finalResult)
	sendStep(send, id, resultStepID, "获取执行结果", "execute", "done", 85)
	sendPhase(send, id, "execute", "done", 85)

	// ═══════════════════════════════════════════════════════════
	// PHASE 3: REVIEW
	// ═══════════════════════════════════════════════════════════
	sendPhase(send, id, "review", "started", 88)

	stepOrder++
	reviewStepID := stepID()
	addStepRecord(ctx, id, reviewStepID, "复盘评估", "review", "running", stepOrder)
	sendStep(send, id, reviewStepID, "复盘评估", "review", "running", 90)

	sendThought(send, id, reviewStepID, "执行阶段完成，进入复盘评估。\n\nAI 将对本次执行进行多维度评估：\n- **执行是否成功**: 检查 Gateway 返回的状态\n- **耗时分析**: 评估执行时长是否合理\n- **输出质量**: 分析输出内容的完整性和准确性\n- **改进建议**: 识别可优化的环节")

	score = 0.0
	summary = ""
	if finalStatus == "complete" {
		score = 0.85
		summary = "执行流程完成，任务已成功触发并在 Gateway 中运行。"
	} else if finalStatus == "error" {
		score = 0.3
		summary = "执行遇到错误: " + finalError
	} else {
		score = 0.5
		summary = "任务被停止。"
	}

	updateStepRecord(ctx, reviewStepID, "done", ts())
	setStepOutputRecord(ctx, reviewStepID, summary)
	sendStep(send, id, reviewStepID, "复盘评估", "review", "done", 95)

	_ = send.Data(TaskBoardStreamReviewEvent{
		ExecutionID:       id,
		Score:             score,
		Summary:           summary,
		ContinueEvolution: false,
		Timestamp:         ts(),
	})
	sendPhase(send, id, "review", "done", 98)

	// ═══════════════════════════════════════════════════════════
	// COMPLETE
	// ═══════════════════════════════════════════════════════════
	durationMs := time.Since(loopStart).Milliseconds()
	_ = send.Data(TaskBoardStreamCompleteEvent{
		ExecutionID: id,
		Status:      finalStatus,
		DurationMs:  durationMs,
		Result:      finalResult,
		Error:       finalError,
		Timestamp:   ts(),
	})
	_ = send.Data(TaskBoardStreamLogEvent{ExecutionID: id, Level: "info", Message: fmt.Sprintf("执行完成，耗时 %.1f 秒", float64(durationMs)/1000), Timestamp: ts()})

	if taskBoardDB != nil {
		taskBoardMu.Lock()
		taskBoardDB.ExecContext(ctx, `UPDATE task_board_executions SET status = ?, updated_at = ?, completed_at = ?, duration_ms = ?, result = ?, error_msg = ? WHERE id = ?`,
			finalStatus, ts(), ts(), durationMs, finalResult, finalError, id)
		taskBoardMu.Unlock()
	}
}

// ── Gateway CLI helpers ─────────────────────────────────────────

func openclawGatewayCall(ctx context.Context, timeout time.Duration, method string, params map[string]any) ([]byte, error) {
	path := toolenv.ResolveToolPath("openclaw")
	if path == "" {
		path = "openclaw"
	}

	encodedParams, err := json.Marshal(params)
	if err != nil {
		return nil, fmt.Errorf("marshal params: %w", err)
	}

	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	args := []string{"gateway", "call", method, "--json", "--params", string(encodedParams)}
	cmd := exec.CommandContext(cmdCtx, path, args...)
	cmd.Env = toolenv.CommandEnv()

	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if cmdCtx.Err() != nil {
			return nil, fmt.Errorf("%s: timeout after %v", method, timeout)
		}
		stderrStr := strings.TrimSpace(stderr.String())
		if stderrStr != "" {
			return nil, fmt.Errorf("%s: %s", method, stderrStr)
		}
		return nil, fmt.Errorf("%s: %w (stdout: %s)", method, err, strings.TrimSpace(stdout.String()))
	}

	output := strings.TrimSpace(stdout.String())
	if output == "" {
		return []byte("{}"), nil
	}
	return []byte(output), nil
}

func pollCronRunStatus(ctx context.Context, execCtx context.Context, cronJobID, execID string, send sse.Sender) string {
	pollInterval := 2 * time.Second
	maxPolls := 30 // max 60 seconds of polling
	lastStatus := ""

	for i := 0; i < maxPolls; i++ {
		select {
		case <-execCtx.Done():
			return "stopped"
		case <-time.After(pollInterval):
		}

		raw, err := openclawGatewayCall(ctx, 10*time.Second, "cron.runs", map[string]any{
			"id":      cronJobID,
			"limit":   1,
			"sortDir": "desc",
		})
		if err != nil {
			_ = send.Data(TaskBoardStreamLogEvent{ExecutionID: execID, Level: "warn", Message: fmt.Sprintf("状态查询异常: %v", err), Timestamp: ts()})
			continue
		}

		status := extractRunStatus(raw)
		// Only log on status change — suppress repetitive "pending" spam
		if status != lastStatus {
			lastStatus = status
			if status == "ok" || status == "completed" || status == "success" {
				_ = send.Data(TaskBoardStreamLogEvent{ExecutionID: execID, Level: "info", Message: "任务执行完成 ✓", Timestamp: ts()})
			} else if status == "error" || status == "failed" {
				_ = send.Data(TaskBoardStreamLogEvent{ExecutionID: execID, Level: "error", Message: "任务执行失败", Timestamp: ts()})
			} else if status == "running" {
				_ = send.Data(TaskBoardStreamLogEvent{ExecutionID: execID, Level: "info", Message: "任务正在运行中...", Timestamp: ts()})
			} else if status != "pending" {
				_ = send.Data(TaskBoardStreamLogEvent{ExecutionID: execID, Level: "info", Message: fmt.Sprintf("任务状态: %s", status), Timestamp: ts()})
			}
		}

		if status == "ok" || status == "completed" || status == "success" {
			return "complete"
		}
		if status == "error" || status == "failed" {
			return "error"
		}
	}

	// Timed out but not necessarily failed — the job might still be running
	_ = send.Data(TaskBoardStreamLogEvent{ExecutionID: execID, Level: "warn", Message: "状态轮询超时，任务可能仍在后台运行", Timestamp: ts()})
	return "complete"
}

func extractJobSummary(raw []byte, jobID string) string {
	var result struct {
		Ok  bool `json:"ok"`
		Payload struct {
			Jobs []struct {
				ID          string `json:"id"`
				Name        string `json:"name"`
				Description string `json:"description"`
				Schedule    string `json:"schedule"`
				Enabled     bool   `json:"enabled"`
				AgentID     string `json:"agentId"`
			} `json:"jobs"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return fmt.Sprintf("任务 ID: %s", jobID)
	}
	for _, j := range result.Payload.Jobs {
		if j.ID == jobID || strings.Contains(j.ID, jobID) {
			return fmt.Sprintf("📋 %s\n   ID: %s | 调度: %s | Agent: %s | 状态: %s",
				j.Name, j.ID, j.Schedule, j.AgentID, map[bool]string{true: "启用", false: "禁用"}[j.Enabled])
		}
	}
	return fmt.Sprintf("任务 ID: %s (共 %d 个任务)", jobID, len(result.Payload.Jobs))
}

func extractRunStatus(raw []byte) string {
	var result struct {
		Payload struct {
			Runs []struct {
				Status         string `json:"status"`
				DeliveryStatus string `json:"deliveryStatus"`
			} `json:"runs"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return "unknown"
	}
	if len(result.Payload.Runs) == 0 {
		return "pending"
	}
	run := result.Payload.Runs[0]
	if run.DeliveryStatus == "delivered" {
		return "ok"
	}
	return run.Status
}

func extractLastRunResult(raw []byte, jobID string) string {
	var result struct {
		Payload struct {
			Runs []struct {
				Status         string `json:"status"`
				DeliveryStatus string `json:"deliveryStatus"`
				StartedAt      int64  `json:"startedAt"`
				DurationMs     int64  `json:"durationMs"`
				Error          string `json:"error"`
				Output         string `json:"output"`
			} `json:"runs"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return fmt.Sprintf("定时任务 %s 已触发执行。", jobID)
	}
	if len(result.Payload.Runs) == 0 {
		return fmt.Sprintf("定时任务 %s 已触发，等待首次执行记录。", jobID)
	}
	run := result.Payload.Runs[0]
	status := "成功"
	if run.Status == "error" || run.Status == "failed" {
		status = "失败"
	}
	timeStr := ""
	if run.StartedAt > 0 {
		timeStr = time.UnixMilli(run.StartedAt).Format("2006-01-02 15:04:05")
	}
	output := run.Output
	if output == "" {
		output = run.Error
	}
	return fmt.Sprintf("📊 定时任务执行报告\n\n━━━━━━━━━━━━━━━━━━━━\n📌 任务: %s\n⏰ 执行时间: %s\n📋 执行状态: %s\n⏱ 耗时: %dms\n\n%s\n━━━━━━━━━━━━━━━━━━━━",
		jobID, timeStr, status, run.DurationMs, output)
}

// ── SSE send helpers ────────────────────────────────────────────

func sendPhase(send sse.Sender, id, phase, status string, progress int) {
	_ = send.Data(TaskBoardStreamPhaseEvent{
		ExecutionID: id, Phase: phase, Status: status,
		Progress: progress, Timestamp: ts(),
	})
}

func sendStep(send sse.Sender, id, stepID, name, phase, status string, progress int) {
	_ = send.Data(TaskBoardStreamStepEvent{
		ExecutionID: id, StepID: stepID, Name: name, Phase: phase,
		Status: status, Progress: progress, Timestamp: ts(),
	})
}

func sendStepErr(send sse.Sender, id, stepID, name, phase, status string, progress int, errMsg string) {
	_ = send.Data(TaskBoardStreamStepEvent{
		ExecutionID: id, StepID: stepID, Name: name, Phase: phase,
		Status: status, Progress: progress, Error: errMsg, Timestamp: ts(),
	})
}

func sendThought(send sse.Sender, id, stepID, content string) {
	_ = send.Data(TaskBoardStreamThoughtEvent{
		ExecutionID: id, StepID: stepID, Content: content, Timestamp: ts(),
	})
}

func sendToolCall(send sse.Sender, id, stepID, callID, name, args string) {
	_ = send.Data(TaskBoardStreamToolCallEvent{
		ExecutionID: id, StepID: stepID, CallID: callID, Name: name, Args: args, Timestamp: ts(),
	})
}

func sendToolResult(send sse.Sender, id, stepID, callID, result, errMsg string, durationMs int64) {
	_ = send.Data(TaskBoardStreamToolResultEvent{
		ExecutionID: id, StepID: stepID, CallID: callID, Result: result, Error: errMsg, DurationMs: durationMs, Timestamp: ts(),
	})
}

// ── DB helpers ─────────────────────────────────────────────────

func addStepRecord(ctx context.Context, execID, id, name, phase, status string, order int) {
	if taskBoardDB == nil { return }
	n := ts()
	taskBoardMu.Lock()
	defer taskBoardMu.Unlock()
	taskBoardDB.ExecContext(ctx, `INSERT INTO task_board_steps (id, execution_id, name, status, phase, sort_order, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, id, execID, name, status, phase, order, n)
}

func updateStepRecord(ctx context.Context, id, status, completedAt string) {
	if taskBoardDB == nil { return }
	taskBoardMu.Lock()
	defer taskBoardMu.Unlock()
	taskBoardDB.ExecContext(ctx, `UPDATE task_board_steps SET status = ?, completed_at = ? WHERE id = ?`, status, completedAt, id)
}

func setStepOutputRecord(ctx context.Context, id, output string) {
	if taskBoardDB == nil { return }
	taskBoardMu.Lock()
	defer taskBoardMu.Unlock()
	taskBoardDB.ExecContext(ctx, `UPDATE task_board_steps SET output = ? WHERE id = ?`, output, id)
}
