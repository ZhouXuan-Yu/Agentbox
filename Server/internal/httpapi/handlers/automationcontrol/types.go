package automationcontrol

import "encoding/json"

// ── Core Data Models ──────────────────────────────────────────

type WorkflowDefinition struct {
	ID              string          `json:"id"`
	Name            string          `json:"name"`
	Description     string          `json:"description,omitempty"`
	Trigger         WorkflowTrigger `json:"trigger"`
	Nodes           []WorkflowNode  `json:"nodes"`
	Edges           []WorkflowEdge  `json:"edges"`
	ActiveVersionID string          `json:"activeVersionId"`
	CreatedAt       string          `json:"createdAt"`
	UpdatedAt       string          `json:"updatedAt"`
}

type WorkflowTrigger struct {
	Type          string `json:"type"` // manual, schedule, webhook, agent
	Cron          string `json:"cron,omitempty"`
	Timezone      string `json:"timezone,omitempty"`
	PayloadSchema string `json:"payloadSchema,omitempty"`
}

type WorkflowNode struct {
	ID          string `json:"id"`
	Type        string `json:"type"` // trigger, agent, tool, api, browser, code, condition, delay, notification
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Config      string `json:"config,omitempty"` // JSON
	PositionX   int    `json:"positionX,omitempty"`
	PositionY   int    `json:"positionY,omitempty"`
}

type WorkflowEdge struct {
	ID        string `json:"id"`
	Source    string `json:"source"`
	Target    string `json:"target"`
	Condition string `json:"condition,omitempty"`
	Label     string `json:"label,omitempty"`
}

// ── Run Models ────────────────────────────────────────────────

type WorkflowRun struct {
	ID                string           `json:"id"`
	WorkflowID        string           `json:"workflowId"`
	WorkflowVersionID string           `json:"workflowVersionId"`
	Status            string           `json:"status"` // pending, running, success, failed, cancelled
	TriggerType       string           `json:"triggerType"`
	TriggerPayload    string           `json:"triggerPayload,omitempty"`
	StartedAt         string           `json:"startedAt,omitempty"`
	EndedAt           string           `json:"endedAt,omitempty"`
	DurationMs        int64            `json:"durationMs,omitempty"`
	FailedNodeRunID   string           `json:"failedNodeRunId,omitempty"`
	ErrorMessage      string           `json:"errorMessage,omitempty"`
	LastSequence      int              `json:"lastSequence"`
	NodeRuns          []WorkflowNodeRun `json:"nodeRuns,omitempty"`
	CreatedAt         string           `json:"createdAt"`
}

type WorkflowNodeRun struct {
	ID            string          `json:"id"`
	RunID         string          `json:"runId"`
	NodeID        string          `json:"nodeId"`
	Title         string          `json:"title"`
	Type          string          `json:"type"`
	Status        string          `json:"status"` // pending, runnable, running, success, failed, skipped
	Input         json.RawMessage `json:"input,omitempty"`
	Output        json.RawMessage `json:"output,omitempty"`
	Error         *SerializedError `json:"error,omitempty"`
	StartedAt     string          `json:"startedAt,omitempty"`
	EndedAt       string          `json:"endedAt,omitempty"`
	DurationMs    int64           `json:"durationMs,omitempty"`
	RetryCount    int             `json:"retryCount"`
	SkippedReason string          `json:"skippedReason,omitempty"`
}

// ── Trace Models ──────────────────────────────────────────────

type TraceSpan struct {
	ID           string          `json:"id"`
	RunID        string          `json:"runId"`
	NodeRunID    string          `json:"nodeRunId"`
	ParentSpanID string          `json:"parentSpanId,omitempty"`
	Title        string          `json:"title"`
	Type         string          `json:"type"` // agent_thought, tool_call, api_call, browser_action, llm_call, condition_check, code_execution, log, artifact, memory_lookup, review
	Status       string          `json:"status"` // pending, running, success, failed, skipped
	Input        json.RawMessage `json:"input,omitempty"`
	Output       json.RawMessage `json:"output,omitempty"`
	Error        *SerializedError `json:"error,omitempty"`
	Metadata     string          `json:"metadata,omitempty"` // JSON
	ArtifactIDs  string          `json:"artifactIds,omitempty"` // JSON array
	StartedAt    string          `json:"startedAt"`
	EndedAt      string          `json:"endedAt,omitempty"`
	DurationMs   int64           `json:"durationMs,omitempty"`
}

type SerializedError struct {
	Name    string `json:"name"`
	Message string `json:"message"`
	Stack   string `json:"stack,omitempty"`
}

// ── Artifact Model ────────────────────────────────────────────

type RunArtifact struct {
	ID             string `json:"id"`
	RunID          string `json:"runId"`
	NodeRunID      string `json:"nodeRunId,omitempty"`
	SpanID         string `json:"spanId,omitempty"`
	Type           string `json:"type"` // screenshot, html_snapshot, network_log, console_log, file, json, text, diff
	Name           string `json:"name"`
	URL            string `json:"url,omitempty"`
	StorageKey     string `json:"storageKey,omitempty"`
	ContentPreview string `json:"contentPreview,omitempty"`
	Metadata       string `json:"metadata,omitempty"` // JSON
	CreatedAt      string `json:"createdAt"`
}

// ── Review Models ─────────────────────────────────────────────

type WorkflowRunReview struct {
	ID              string             `json:"id"`
	RunID           string             `json:"runId"`
	WorkflowID      string             `json:"workflowId"`
	Status          string             `json:"status"` // success, failed, partial_success
	Summary         string             `json:"summary"`
	Bottlenecks     []ReviewBottleneck `json:"bottlenecks,omitempty"`
	LearnedFacts    []LearnedFact      `json:"learnedFacts,omitempty"`
	SuggestionIDs   []string           `json:"suggestionIds,omitempty"`
	RiskAssessment  string             `json:"riskAssessment,omitempty"`
	CreatedAt       string             `json:"createdAt"`
}

type ReviewBottleneck struct {
	NodeID    string `json:"nodeId"`
	NodeRunID string `json:"nodeRunId,omitempty"`
	Issue     string `json:"issue"`
	Evidence  string `json:"evidence"`
	Impact    string `json:"impact"` // low, medium, high
}

type LearnedFact struct {
	Key             string   `json:"key"`
	Value           string   `json:"value"`
	Scope           string   `json:"scope"` // workflow, node, tool, domain, user
	Confidence      float64  `json:"confidence"`
	EvidenceRunIDs  []string `json:"evidenceRunIds"`
}

// ── Evolution Models ──────────────────────────────────────────

type EvolutionSuggestion struct {
	ID              string          `json:"id"`
	RunID           string          `json:"runId"`
	WorkflowID      string          `json:"workflowId"`
	TargetNodeID    string          `json:"targetNodeId,omitempty"`
	Type            string          `json:"type"` // retry, timeout, selector, prompt, api_param, condition, fallback, notification, memory
	Title           string          `json:"title"`
	Reason          string          `json:"reason"`
	Evidence        []string        `json:"evidence"`
	ProposedChange  json.RawMessage `json:"proposedChange"`
	Risk            string          `json:"risk"` // low, medium, high
	Confidence      float64         `json:"confidence"`
	Status          string          `json:"status"` // pending, accepted, rejected, ignored
	CreatedAt       string          `json:"createdAt"`
}

// ── Version Models ────────────────────────────────────────────

type WorkflowVersion struct {
	ID                       string `json:"id"`
	WorkflowID               string `json:"workflowId"`
	Version                  int    `json:"version"`
	DefinitionJSON           string `json:"definitionJson"`
	ChangeSummary            string `json:"changeSummary"`
	CreatedBy                string `json:"createdBy"` // user, agent
	CreatedFromRunID         string `json:"createdFromRunId,omitempty"`
	CreatedFromSuggestionIDs string `json:"createdFromSuggestionIds,omitempty"` // JSON array
	Status                   string `json:"status"` // draft, active, archived
	CreatedAt                string `json:"createdAt"`
}

type WorkflowVersionDiff struct {
	FromVersionID string              `json:"fromVersionId"`
	ToVersionID   string              `json:"toVersionId"`
	Changes       []VersionDiffChange `json:"changes"`
}

type VersionDiffChange struct {
	Op                    string      `json:"op"`
	Target                string      `json:"target"`
	Before                interface{} `json:"before,omitempty"`
	After                 interface{} `json:"after,omitempty"`
	Summary               string      `json:"summary"`
	EvidenceSuggestionID  string      `json:"evidenceSuggestionId,omitempty"`
}

// ── Huma v2 I/O Types ─────────────────────────────────────────

// Workflow CRUD

type CreateWorkflowInput struct {
	Body struct {
		Name        string          `json:"name" required:"true" doc:"Workflow name" example:"每日竞品价格监控"`
		Description string          `json:"description,omitempty" doc:"Workflow description"`
		Trigger     WorkflowTrigger `json:"trigger,omitempty" doc:"Workflow trigger configuration"`
	}
}

type CreateWorkflowOutput struct {
	Body WorkflowDefinition
}

type ListWorkflowsInput struct {
	Limit  int    `query:"limit" minimum:"1" maximum:"100" doc:"Max items" example:"20"`
	Offset int    `query:"offset" minimum:"0" doc:"Pagination offset" example:"0"`
}

type WorkflowListItem struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Description     string `json:"description,omitempty"`
	ActiveVersionID string `json:"activeVersionId"`
	Status          string `json:"status"` // draft, active
	UpdatedAt       string `json:"updatedAt"`
	CreatedAt       string `json:"createdAt"`
}

type ListWorkflowsOutput struct {
	Body struct {
		Items  []WorkflowListItem `json:"items"`
		Total  int                `json:"total"`
		Limit  int                `json:"limit"`
		Offset int                `json:"offset"`
	}
}

type GetWorkflowInput struct {
	ID string `path:"id" doc:"Workflow ID" example:"wf-abc123"`
}

type GetWorkflowOutput struct {
	Body WorkflowDefinition
}

// Run queries

type ListRunsInput struct {
	WorkflowID string `query:"workflowId" doc:"Filter by workflow ID"`
	Limit      int    `query:"limit" minimum:"1" maximum:"100" doc:"Max items" example:"20"`
	Offset     int    `query:"offset" minimum:"0" doc:"Pagination offset" example:"0"`
	Status     string `query:"status" enum:"all,pending,running,success,failed,cancelled" doc:"Filter by status" example:"all"`
}

type ListRunsOutput struct {
	Body struct {
		Items  []WorkflowRun `json:"items"`
		Total  int           `json:"total"`
		Limit  int           `json:"limit"`
		Offset int           `json:"offset"`
	}
}

type GetRunInput struct {
	ID string `path:"id" doc:"Run ID" example:"run-abc123"`
}

type GetRunOutput struct {
	Body WorkflowRun
}

// Version management

type ListVersionsInput struct {
	WorkflowID string `path:"id" doc:"Workflow ID" example:"wf-abc123"`
}

type ListVersionsOutput struct {
	Body struct {
		Items []WorkflowVersion `json:"items"`
	}
}

type ActivateVersionInput struct {
	WorkflowID string `path:"id" doc:"Workflow ID" example:"wf-abc123"`
	VersionID  string `path:"versionId" doc:"Version ID" example:"ver-abc123"`
}

type RollbackVersionInput struct {
	WorkflowID string `path:"id" doc:"Workflow ID" example:"wf-abc123"`
	VersionID  string `path:"versionId" doc:"Version ID" example:"ver-abc123"`
}

type VersionActionOutput struct {
	Body struct {
		Success bool              `json:"success"`
		Version WorkflowVersion   `json:"version"`
	}
}
