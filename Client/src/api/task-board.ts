// task-board.ts — Task Execution Visualization Dashboard API client

import { apiRequest, buildAPIURL, type ApiQuery } from './client'

// ── REST types ─────────────────────────────────────────────────

export type TaskBoardKPIResponse = {
  totalRuns: number
  successRate: number
  avgDurationMs: number
  activeTasks: number
  lastRunAt?: string
  status: string
  timestamp: string
}

export type TaskBoardExecutionSummary = {
  id: string
  description: string
  status: 'idle' | 'running' | 'reviewing' | 'complete' | 'error' | 'stopped'
  iteration: number
  parentId?: string
  agentId: string
  phase: string
  step: string
  progress: number
  reviewScore?: number
  reviewSummary?: string
  betterSolution?: string
  result?: string
  error?: string
  startedAt: string
  updatedAt: string
  completedAt?: string
  durationMs?: number
}

export type TaskBoardStepSummary = {
  id: string
  executionId: string
  name: string
  status: 'pending' | 'running' | 'done' | 'error'
  phase: string
  sortOrder: number
  startedAt?: string
  completedAt?: string
  durationMs?: number
  output?: string
  error?: string
}

export type TaskBoardToolCallSummary = {
  id: string
  stepId: string
  name: string
  args?: string
  result?: string
  error?: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
}

export type TaskBoardExecutionDetail = TaskBoardExecutionSummary & {
  steps: TaskBoardStepSummary[]
  toolCalls: TaskBoardToolCallSummary[]
}

export type TaskBoardListResponse = {
  items: TaskBoardExecutionSummary[]
  total: number
  limit: number
  offset: number
  status: string
  timestamp: string
}

export type TaskBoardExecuteResponse = {
  executionId: string
  status: string
  timestamp: string
}

export type TaskBoardExecuteRequest = {
  description: string
  agentId?: string
  maxIterations?: number
}

// ── SSE event types ────────────────────────────────────────────

export type TaskBoardSSEMeta = {
  executionId: string
  iteration: number
  description: string
  agentId: string
  timestamp: string
}

export type TaskBoardSSEPhase = {
  executionId: string
  phase: 'prepare' | 'execute' | 'review'
  status: 'started' | 'done'
  progress: number
  timestamp: string
}

export type TaskBoardSSEStep = {
  executionId: string
  stepId: string
  name: string
  phase: string
  status: 'pending' | 'running' | 'done' | 'error'
  progress: number
  error?: string
  timestamp: string
}

export type TaskBoardSSELog = {
  executionId: string
  level: 'info' | 'warn' | 'error'
  message: string
  timestamp: string
}

export type TaskBoardSSEToolCall = {
  executionId: string
  stepId: string
  callId: string
  name: string
  args?: string
  timestamp: string
}

export type TaskBoardSSEToolResult = {
  executionId: string
  stepId: string
  callId: string
  result?: string
  error?: string
  durationMs?: number
  timestamp: string
}

export type TaskBoardSSEThought = {
  executionId: string
  stepId: string
  content: string
  timestamp: string
}

export type TaskBoardSSEReview = {
  executionId: string
  score: number
  summary: string
  betterSolution?: string
  continueEvolution: boolean
  timestamp: string
}

export type TaskBoardSSEComplete = {
  executionId: string
  status: 'complete' | 'error' | 'stopped'
  iteration: number
  durationMs: number
  result?: string
  error?: string
  timestamp: string
}

// ── SSE event name constants ────────────────────────────────────

export const TASK_BOARD_SSE_EVENTS = [
  'meta',
  'phase',
  'step',
  'log',
  'tool_call',
  'tool_result',
  'thought',
  'review',
  'complete',
] as const

// ── API functions ──────────────────────────────────────────────

export function fetchTaskBoardKPI() {
  return apiRequest<TaskBoardKPIResponse>('/task-board/kpi')
}

export function listTaskBoardExecutions(options?: {
  limit?: number
  offset?: number
  status?: string
}) {
  return apiRequest<TaskBoardListResponse>('/task-board/executions', {
    query: options as ApiQuery,
  })
}

export function getTaskBoardExecution(id: string) {
  return apiRequest<TaskBoardExecutionDetail>(`/task-board/executions/${encodeURIComponent(id)}`)
}

export function startTaskBoardExecution(body: TaskBoardExecuteRequest) {
  return apiRequest<TaskBoardExecuteResponse>('/task-board/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function stopTaskBoardExecution(id: string) {
  return apiRequest<TaskBoardExecuteResponse>(`/task-board/executions/${encodeURIComponent(id)}/stop`, {
    method: 'POST',
  })
}

export function triggerTaskBoardEvolution(id: string) {
  return apiRequest<TaskBoardExecuteResponse>(`/task-board/executions/${encodeURIComponent(id)}/evolve`, {
    method: 'POST',
  })
}

export function buildTaskBoardStreamURL(params: {
  cronJobId?: string
  taskDesc?: string
  agentId?: string
}) {
  return buildAPIURL('/task-board/execute/stream', params as ApiQuery)
}
