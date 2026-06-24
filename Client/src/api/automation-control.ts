import { apiRequest, buildAPIURL, type ApiQuery } from './client'
import type {
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRunReview,
  WorkflowVersion,
  AgentExecutionTraceImport,
  AgentPlanImport,
  WorkflowListItem,
  PaginatedResponse,
} from '@/types/automation-control'

// ── Workflows ─────────────────────────────────────────────────

export function listWorkflows(query?: ApiQuery) {
  return apiRequest<PaginatedResponse<WorkflowListItem>>('/automation-control/workflows', { query })
}

export function getWorkflow(id: string) {
  return apiRequest<WorkflowDefinition>(`/automation-control/workflows/${encodeURIComponent(id)}`)
}

export function createWorkflow(body: { name: string; description?: string; trigger?: WorkflowDefinition['trigger'] }) {
  return apiRequest<WorkflowDefinition>('/automation-control/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ── Runs ──────────────────────────────────────────────────────

export function listRuns(workflowId?: string, query?: ApiQuery) {
  return apiRequest<PaginatedResponse<WorkflowRun>>('/automation-control/runs', {
    query: { ...query, workflowId },
  })
}

export function getRun(id: string) {
  return apiRequest<WorkflowRun>(`/automation-control/runs/${encodeURIComponent(id)}`)
}

export function getNodeRuns(runId: string) {
  return apiRequest<WorkflowRun['nodeRuns']>(`/automation-control/runs/${encodeURIComponent(runId)}/node-runs`)
}

export function getTraceSpans(runId: string) {
  return apiRequest<{ items: unknown[] }>(`/automation-control/runs/${encodeURIComponent(runId)}/trace-spans`)
}

export function getArtifacts(runId: string) {
  return apiRequest<{ items: unknown[] }>(`/automation-control/runs/${encodeURIComponent(runId)}/artifacts`)
}

export function getReview(runId: string) {
  return apiRequest<WorkflowRunReview>(`/automation-control/runs/${encodeURIComponent(runId)}/review`)
}

// ── Versions ──────────────────────────────────────────────────

export function listVersions(workflowId: string) {
  return apiRequest<{ items: WorkflowVersion[] }>(`/automation-control/workflows/${encodeURIComponent(workflowId)}/versions`)
}

export function activateVersion(workflowId: string, versionId: string) {
  return apiRequest<{ success: boolean; version: WorkflowVersion }>(
    `/automation-control/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(versionId)}/activate`,
    { method: 'POST' },
  )
}

export function rollbackVersion(workflowId: string, versionId: string) {
  return apiRequest<{ success: boolean; version: WorkflowVersion }>(
    `/automation-control/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(versionId)}/rollback`,
    { method: 'POST' },
  )
}

// ── Evolution Suggestions ─────────────────────────────────────

export function acceptSuggestion(id: string) {
  return apiRequest<{ success: boolean }>(`/automation-control/suggestions/${encodeURIComponent(id)}/accept`, {
    method: 'POST',
  })
}

export function rejectSuggestion(id: string) {
  return apiRequest<{ success: boolean }>(`/automation-control/suggestions/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
  })
}

export function ignoreSuggestion(id: string) {
  return apiRequest<{ success: boolean }>(`/automation-control/suggestions/${encodeURIComponent(id)}/ignore`, {
    method: 'POST',
  })
}

// ── Imports ───────────────────────────────────────────────────

export function importAgentExecutionTrace(body: AgentExecutionTraceImport) {
  return apiRequest<WorkflowDefinition>('/automation-control/imports/agent-execution-trace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function importAgentPlan(body: AgentPlanImport) {
  return apiRequest<WorkflowDefinition>('/automation-control/imports/agent-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ── SSE URL Builder ───────────────────────────────────────────

export function buildRunEventsURL(runId: string, afterSequence?: number): string {
  const params: Record<string, string | number | undefined> = {}
  if (afterSequence != null) {
    params.after = afterSequence
  }
  return buildAPIURL(`/automation-control/runs/${encodeURIComponent(runId)}/events`, params as ApiQuery)
}
