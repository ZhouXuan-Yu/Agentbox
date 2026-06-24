// task-board.ts — Task Execution Visualization Dashboard state

import { create } from 'zustand'
import type {
  TaskBoardKPIResponse,
  TaskBoardExecutionSummary,
  TaskBoardStepSummary,
  TaskBoardToolCallSummary,
  TaskBoardExecutionDetail,
  TaskBoardSSEMeta,
  TaskBoardSSEPhase,
  TaskBoardSSEStep,
  TaskBoardSSELog,
  TaskBoardSSEToolCall,
  TaskBoardSSEToolResult,
  TaskBoardSSEThought,
  TaskBoardSSEReview,
  TaskBoardSSEComplete,
} from '@/api/task-board'
import {
  fetchTaskBoardKPI,
  listTaskBoardExecutions,
  getTaskBoardExecution,
  stopTaskBoardExecution,
  buildTaskBoardStreamURL,
} from '@/api/task-board'

// ── Live log entry ─────────────────────────────────────────────

export type TaskBoardLiveLogEntry = {
  level: 'info' | 'warn' | 'error'
  message: string
  timestamp: string
}

export type TaskBoardLiveThought = {
  content: string
  stepId: string
  timestamp: string
}

export type TaskBoardLiveToolCall = {
  callId: string
  stepId: string
  name: string
  args?: string
  result?: string
  error?: string
  startedAt: string
  completedAt?: string
}

// ── Store state ─────────────────────────────────────────────────

interface TaskBoardStore {
  // KPI
  kpi: TaskBoardKPIResponse | null
  kpiLoading: boolean

  // Live execution state
  activeExecutionId: string | null
  activeExecution: TaskBoardExecutionSummary | null
  activeSteps: TaskBoardStepSummary[]
  liveLogs: TaskBoardLiveLogEntry[]
  liveThoughts: TaskBoardLiveThought[]
  liveToolCalls: Map<string, TaskBoardLiveToolCall>
  evolutionIterations: TaskBoardExecutionSummary[]  // all iterations in current evolution chain
  currentPhase: string
  currentProgress: number
  isConnected: boolean
  isReconnecting: boolean
  connectionError: string | null
  completedNormally: boolean  // true after clean 'complete' event — suppress error after close

  // SSE connection
  eventSource: EventSource | null

  // History
  history: TaskBoardExecutionSummary[]
  historyTotal: number
  historyLoading: boolean
  selectedExecution: TaskBoardExecutionDetail | null
  selectedExecutionLoading: boolean

  // Actions
  loadKPI: () => Promise<void>
  loadHistory: (limit?: number, offset?: number, status?: string) => Promise<void>
  loadExecution: (id: string) => Promise<void>
  selectExecution: (id: string) => Promise<void>

  startExecution: (cronJobId?: string, taskDesc?: string, agentId?: string) => void
  stopExecution: () => Promise<void>
  closeStream: () => void
  clearActiveState: () => void
}

export const useTaskBoardStore = create<TaskBoardStore>((set, get) => ({
  kpi: null,
  kpiLoading: false,

  activeExecutionId: null,
  activeExecution: null,
  activeSteps: [],
  liveLogs: [],
  liveThoughts: [],
  liveToolCalls: new Map(),
  evolutionIterations: [],
  currentPhase: '',
  currentProgress: 0,
  isConnected: false,
  isReconnecting: false,
  connectionError: null,
  completedNormally: false,

  eventSource: null,

  history: [],
  historyTotal: 0,
  historyLoading: false,
  selectedExecution: null,
  selectedExecutionLoading: false,

  // ── KPI ──────────────────────────────────────────────────

  loadKPI: async () => {
    set({ kpiLoading: true })
    try {
      const kpi = await fetchTaskBoardKPI()
      set({ kpi, kpiLoading: false })
    } catch {
      set({ kpiLoading: false })
    }
  },

  // ── History ───────────────────────────────────────────────

  loadHistory: async (limit = 20, offset = 0, status) => {
    set({ historyLoading: true })
    try {
      const result = await listTaskBoardExecutions({ limit, offset, status })
      set({
        history: result.items,
        historyTotal: result.total,
        historyLoading: false,
      })
    } catch {
      set({ historyLoading: false })
    }
  },

  loadExecution: async (id: string) => {
    set({ selectedExecutionLoading: true, selectedExecution: null })
    try {
      const detail = await getTaskBoardExecution(id)
      set({ selectedExecution: detail, selectedExecutionLoading: false })
    } catch {
      set({ selectedExecutionLoading: false })
    }
  },

  selectExecution: async (id: string) => {
    await get().loadExecution(id)
  },

  // ── Live execution ────────────────────────────────────────

  startExecution: (cronJobId?: string, taskDesc?: string, agentId?: string) => {
    // Close any existing stream
    get().closeStream()

    const url = buildTaskBoardStreamURL({ cronJobId, taskDesc, agentId })
    const es = new EventSource(url)

    set({
      eventSource: es,
      isConnected: false,    // false until 'open' fires
      isReconnecting: false,
      connectionError: null,
      completedNormally: false,
      activeSteps: [],
      liveLogs: [],
      liveThoughts: [],
      liveToolCalls: new Map(),
      evolutionIterations: [],
      currentPhase: '',
      currentProgress: 0,
      activeExecution: null,
      activeExecutionId: null,
    })

    // ── SSE Connection State ─────────────────────────────────

    es.onopen = () => {
      set({ isConnected: true, isReconnecting: false, connectionError: null })
    }

    es.onerror = () => {
      const state = get()
      // Only set reconnecting on first error after connected
      if (!state.isReconnecting && state.isConnected) {
        set({ isConnected: false, isReconnecting: true })
      }
      // If ES never opened, mark as connection error
      if (!state.isConnected && !state.activeExecutionId) {
        set({
          isConnected: false,
          connectionError: '无法连接到执行服务，请确认后端服务正在运行',
        })
      }
    }

    // ── SSE Event Handlers ──────────────────────────────────

    es.addEventListener('meta', (event: MessageEvent) => {
      const data: TaskBoardSSEMeta = JSON.parse(event.data)
      set({
        activeExecutionId: data.executionId,
        activeExecution: {
          id: data.executionId,
          description: data.description,
          status: 'running',
          iteration: 1,
          agentId: data.agentId,
          phase: '',
          step: '',
          progress: 0,
          startedAt: data.timestamp,
          updatedAt: data.timestamp,
        },
        activeSteps: [],
        liveLogs: [],
        liveThoughts: [],
        liveToolCalls: new Map(),
        evolutionIterations: [{
          id: data.executionId,
          description: data.description,
          status: 'running',
          iteration: 1,
          agentId: data.agentId,
          phase: '',
          step: '',
          progress: 0,
          startedAt: data.timestamp,
          updatedAt: data.timestamp,
        }],
        isReconnecting: false,
      })
    })

    es.addEventListener('phase', (event: MessageEvent) => {
      const data: TaskBoardSSEPhase = JSON.parse(event.data)
      set((state) => ({
        currentPhase: data.status === 'started' ? data.phase : '',
        currentProgress: data.progress,
        activeExecution: state.activeExecution
          ? { ...state.activeExecution, phase: data.phase, progress: data.progress, updatedAt: data.timestamp }
          : null,
      }))
    })

    es.addEventListener('step', (event: MessageEvent) => {
      const data: TaskBoardSSEStep = JSON.parse(event.data)
      set((state) => {
        const existing = state.activeSteps.find((s) => s.id === data.stepId)
        if (existing) {
          return {
            activeSteps: state.activeSteps.map((s) =>
              s.id === data.stepId
                ? { ...s, status: data.status, completedAt: data.status === 'done' || data.status === 'error' ? data.timestamp : s.completedAt, error: data.error }
                : s,
            ),
            currentProgress: data.progress,
          }
        }
        return {
          activeSteps: [...state.activeSteps, {
            id: data.stepId,
            executionId: data.executionId,
            name: data.name,
            status: data.status,
            phase: data.phase,
            sortOrder: state.activeSteps.length,
            startedAt: data.status === 'running' ? data.timestamp : undefined,
          }],
          currentProgress: data.progress,
        }
      })
    })

    es.addEventListener('log', (event: MessageEvent) => {
      const data: TaskBoardSSELog = JSON.parse(event.data)
      set((state) => ({
        liveLogs: [...state.liveLogs, { level: data.level, message: data.message, timestamp: data.timestamp }],
      }))
    })

    es.addEventListener('tool_call', (event: MessageEvent) => {
      const data: TaskBoardSSEToolCall = JSON.parse(event.data)
      set((state) => {
        const next = new Map(state.liveToolCalls)
        next.set(data.callId, {
          callId: data.callId,
          stepId: data.stepId,
          name: data.name,
          args: data.args,
          startedAt: data.timestamp,
        })
        return { liveToolCalls: next }
      })
    })

    es.addEventListener('tool_result', (event: MessageEvent) => {
      const data: TaskBoardSSEToolResult = JSON.parse(event.data)
      set((state) => {
        const next = new Map(state.liveToolCalls)
        const existing = next.get(data.callId)
        if (existing) {
          next.set(data.callId, {
            ...existing,
            result: data.result,
            error: data.error,
            completedAt: data.timestamp,
          })
        }
        return { liveToolCalls: next }
      })
    })

    es.addEventListener('thought', (event: MessageEvent) => {
      const data: TaskBoardSSEThought = JSON.parse(event.data)
      set((state) => ({
        liveThoughts: [...state.liveThoughts, { content: data.content, stepId: data.stepId, timestamp: data.timestamp }],
      }))
    })

    es.addEventListener('review', (event: MessageEvent) => {
      const data: TaskBoardSSEReview = JSON.parse(event.data)
      set((state) => ({
        activeExecution: state.activeExecution
          ? {
              ...state.activeExecution,
              reviewScore: data.score,
              reviewSummary: data.summary,
              betterSolution: data.betterSolution,
            }
          : null,
      }))
    })

    es.addEventListener('complete', (event: MessageEvent) => {
      const data: TaskBoardSSEComplete = JSON.parse(event.data)
      set((state) => ({
        activeExecution: state.activeExecution
          ? { ...state.activeExecution, status: data.status, durationMs: data.durationMs, result: data.result, updatedAt: data.timestamp, completedAt: data.timestamp }
          : null,
        currentPhase: data.status,
        currentProgress: 100,
        isConnected: false,
      }))
      // Auto-refresh KPI and history
      get().loadKPI()
      get().loadHistory()
      // Close SSE to prevent EventSource auto-reconnection
      // from triggering a brand-new execution loop
      get().closeStream()
    })

    // NOTE: es.onerror is set above (lines 194-207) — do NOT overwrite it here.
    // If we reach an error after receiving meta (execution in progress), close the
    // stream to prevent EventSource auto-reconnect from spawning a duplicate execution.
    es.addEventListener('error', () => {
      const state = get()
      if (state.activeExecutionId) {
        // Execution was already in progress — a reconnect would start a new one.
        // Close the stream and let the user restart manually if needed.
        get().closeStream()
        set({ connectionError: '执行流中断，请手动重新触发' })
      }
    })
  },

  stopExecution: async () => {
    const id = get().activeExecutionId
    if (!id) return
    try {
      await stopTaskBoardExecution(id)
    } catch {
      // Ignore errors on stop
    }
    get().closeStream()
  },

  closeStream: () => {
    const es = get().eventSource
    if (es) {
      es.close()
    }
    set({
      eventSource: null,
      isConnected: false,
      isReconnecting: false,
      connectionError: null,
    })
  },

  clearActiveState: () => {
    get().closeStream()
    set({
      activeExecutionId: null,
      activeExecution: null,
      activeSteps: [],
      liveLogs: [],
      liveThoughts: [],
      liveToolCalls: new Map(),
      evolutionIterations: [],
      currentPhase: '',
      currentProgress: 0,
      isConnected: false,
      isReconnecting: false,
      connectionError: null,
    })
  },
}))
