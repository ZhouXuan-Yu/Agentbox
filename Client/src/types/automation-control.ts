// ── Core Data Models (PRD §10) ────────────────────────────────

export interface WorkflowDefinition {
  id: string
  name: string
  description?: string
  trigger: WorkflowTrigger
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  activeVersionId: string
  createdAt: string
  updatedAt: string
}

export interface WorkflowTrigger {
  type: 'manual' | 'schedule' | 'webhook' | 'agent'
  cron?: string
  timezone?: string
  payloadSchema?: Record<string, unknown>
}

export interface WorkflowNode {
  id: string
  type:
    | 'trigger'
    | 'agent'
    | 'tool'
    | 'api'
    | 'browser'
    | 'code'
    | 'condition'
    | 'delay'
    | 'notification'
  title: string
  description?: string
  config: Record<string, unknown>
  position?: { x: number; y: number }
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  condition?: string
  label?: string
}

// ── Run Models ────────────────────────────────────────────────

export interface WorkflowRun {
  id: string
  workflowId: string
  workflowVersionId: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
  triggerType: string
  triggerPayload?: unknown
  startedAt?: string
  endedAt?: string
  durationMs?: number
  failedNodeRunId?: string
  errorMessage?: string
  lastSequence: number
  nodeRuns?: WorkflowNodeRun[]
  createdAt: string
}

export interface WorkflowNodeRun {
  id: string
  runId: string
  nodeId: string
  title: string
  type: WorkflowNode['type']
  status: 'pending' | 'runnable' | 'running' | 'success' | 'failed' | 'skipped'
  input?: unknown
  output?: unknown
  error?: SerializedError
  startedAt?: string
  endedAt?: string
  durationMs?: number
  retryCount: number
  skippedReason?: string
}

// ── Trace Models ──────────────────────────────────────────────

export interface TraceSpan {
  id: string
  runId: string
  nodeRunId: string
  parentSpanId?: string
  title: string
  type:
    | 'agent_thought'
    | 'tool_call'
    | 'api_call'
    | 'browser_action'
    | 'llm_call'
    | 'condition_check'
    | 'code_execution'
    | 'log'
    | 'artifact'
    | 'memory_lookup'
    | 'review'
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  input?: unknown
  output?: unknown
  error?: SerializedError
  metadata?: Record<string, unknown>
  artifactIds?: string[]
  startedAt: string
  endedAt?: string
  durationMs?: number
}

export interface SerializedError {
  name: string
  message: string
  stack?: string
}

// ── Artifact Model ────────────────────────────────────────────

export interface RunArtifact {
  id: string
  runId: string
  nodeRunId?: string
  spanId?: string
  type:
    | 'screenshot'
    | 'html_snapshot'
    | 'network_log'
    | 'console_log'
    | 'file'
    | 'json'
    | 'text'
    | 'diff'
  name: string
  url?: string
  storageKey?: string
  contentPreview?: string
  metadata?: Record<string, unknown>
  createdAt: string
}

// ── Review Models ─────────────────────────────────────────────

export interface WorkflowRunReview {
  id: string
  runId: string
  workflowId: string
  status: 'success' | 'failed' | 'partial_success'
  summary: string
  bottlenecks?: ReviewBottleneck[]
  learnedFacts?: LearnedFact[]
  suggestionIds?: string[]
  riskAssessment?: string
  createdAt: string
}

export interface ReviewBottleneck {
  nodeId: string
  nodeRunId?: string
  issue: string
  evidence: string
  impact: 'low' | 'medium' | 'high'
}

export interface LearnedFact {
  key: string
  value: string
  scope: 'workflow' | 'node' | 'tool' | 'domain' | 'user'
  confidence: number
  evidenceRunIds: string[]
}

// ── Evolution Models ──────────────────────────────────────────

export interface EvolutionSuggestion {
  id: string
  runId: string
  workflowId: string
  targetNodeId?: string
  type:
    | 'retry'
    | 'timeout'
    | 'selector'
    | 'prompt'
    | 'api_param'
    | 'condition'
    | 'fallback'
    | 'notification'
    | 'memory'
  title: string
  reason: string
  evidence: string[]
  proposedChange: ProposedChange
  risk: 'low' | 'medium' | 'high'
  confidence: number
  status: 'pending' | 'accepted' | 'rejected' | 'ignored'
  createdAt: string
}

// ── ProposedChange (PRD §15.3.1) ──────────────────────────────

export type ProposedChange =
  | UpdateNodeConfigChange
  | AddNodeChange
  | RemoveNodeChange
  | AddEdgeChange
  | RemoveEdgeChange
  | UpdateTriggerChange
  | AddMemoryChange
  | AddFailurePolicyChange

interface BaseProposedChange {
  op: string
  risk: 'low' | 'medium' | 'high'
  summary: string
}

export interface UpdateNodeConfigChange extends BaseProposedChange {
  op: 'update_node_config'
  nodeId: string
  path: string
  before: unknown
  after: unknown
}

export interface AddNodeChange extends BaseProposedChange {
  op: 'add_node'
  node: WorkflowNode
  connectFrom?: string
  connectTo?: string
}

export interface RemoveNodeChange extends BaseProposedChange {
  op: 'remove_node'
  nodeId: string
  reason: string
}

export interface AddEdgeChange extends BaseProposedChange {
  op: 'add_edge'
  edge: WorkflowEdge
}

export interface RemoveEdgeChange extends BaseProposedChange {
  op: 'remove_edge'
  edgeId: string
  reason: string
}

export interface UpdateTriggerChange extends BaseProposedChange {
  op: 'update_trigger'
  before: WorkflowTrigger
  after: WorkflowTrigger
}

export interface AddMemoryChange extends BaseProposedChange {
  op: 'add_memory'
  memory: Omit<WorkflowMemory, 'id' | 'createdAt' | 'updatedAt'>
}

export interface AddFailurePolicyChange extends BaseProposedChange {
  op: 'add_failure_policy'
  nodeId: string
  before?: FailurePolicy
  after: FailurePolicy
}

export interface FailurePolicy {
  mode: 'stop_workflow' | 'continue' | 'skip_downstream' | 'retry_then_stop'
  maxRetries?: number
  retryDelayMs?: number
  backoff?: 'fixed' | 'exponential'
}

// ── Version Models ────────────────────────────────────────────

export interface WorkflowVersion {
  id: string
  workflowId: string
  version: number
  definition: WorkflowDefinition
  changeSummary: string
  createdBy: 'user' | 'agent'
  createdFromRunId?: string
  createdFromSuggestionIds?: string[]
  status: 'draft' | 'active' | 'archived'
  createdAt: string
}

export interface WorkflowVersionDiff {
  fromVersionId: string
  toVersionId: string
  changes: VersionDiffChange[]
}

export interface VersionDiffChange {
  op: ProposedChange['op']
  target: string
  before?: unknown
  after?: unknown
  summary: string
  evidenceSuggestionId?: string
}

// ── Memory Model ──────────────────────────────────────────────

export interface WorkflowMemory {
  id: string
  scope: 'workflow' | 'node' | 'tool' | 'domain' | 'user'
  workflowId?: string
  nodeId?: string
  toolName?: string
  key: string
  value: unknown
  confidence: number
  evidenceRunIds: string[]
  createdAt: string
  updatedAt: string
}

// ── Import Models (PRD §11.2) ─────────────────────────────────

export interface AgentExecutionTraceImport {
  sourceType: 'agent_execution_trace'
  name: string
  description?: string
  trigger?: WorkflowTrigger
  steps: AgentExecutionStep[]
}

export interface AgentExecutionStep {
  id: string
  parentId?: string
  title: string
  type:
    | 'agent'
    | 'tool'
    | 'api'
    | 'browser'
    | 'code'
    | 'condition'
    | 'notification'
  input?: unknown
  output?: unknown
  error?: SerializedError
  startedAt?: string
  endedAt?: string
  metadata?: Record<string, unknown>
}

export interface AgentPlanImport {
  sourceType: 'agent_plan'
  name: string
  description?: string
  trigger: WorkflowTrigger
  nodes: Array<{
    id: string
    title: string
    type: WorkflowNode['type']
    config: Record<string, unknown>
  }>
  edges: Array<{
    source: string
    target: string
    condition?: string
    label?: string
  }>
}

export interface ExistingScheduledTaskImport {
  sourceType: 'existing_scheduled_task'
  name: string
  cron: string
  timezone: string
  commandOrEntrypoint: string
  wrapperConfig?: Record<string, unknown>
}

// ── SSE Event Types (PRD §12.1) ───────────────────────────────

export type RunEventType =
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'node.started'
  | 'node.completed'
  | 'node.failed'
  | 'node.skipped'
  | 'span.started'
  | 'span.completed'
  | 'span.failed'
  | 'artifact.created'
  | 'review.created'
  | 'suggestion.created'

export interface RunEvent {
  id: string
  runId: string
  sequence: number
  type: RunEventType
  entityId: string
  payload: Record<string, unknown>
  createdAt: string
}

// ── API Response Types ────────────────────────────────────────

export interface WorkflowListItem {
  id: string
  name: string
  description?: string
  activeVersionId: string
  status: 'draft' | 'active'
  updatedAt: string
  createdAt: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}
