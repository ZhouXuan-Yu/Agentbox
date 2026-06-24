import { create } from 'zustand'
import type { WorkflowRun, WorkflowNodeRun, TraceSpan, RunArtifact, WorkflowRunReview, EvolutionSuggestion } from '@/types/automation-control'
import type { WorkflowListItem } from '@/types/automation-control'
import type { RunEvent } from '@/types/automation-control'
import { listWorkflows, getWorkflow, getRun, listRuns, getNodeRuns, getTraceSpans, getArtifacts, getReview } from '@/api/automation-control'

interface AutomationControlStore {
  // Selection state
  selectedWorkflowId: string | null
  selectedRunId: string | null
  selectedNodeRunId: string | null

  // Data
  activeRun: WorkflowRun | null
  nodeRuns: WorkflowNodeRun[]
  traceSpans: TraceSpan[]
  artifacts: RunArtifact[]
  review: WorkflowRunReview | null
  suggestions: EvolutionSuggestion[]

  // Lists
  workflowList: WorkflowListItem[]
  workflowListLoading: boolean
  runHistory: WorkflowRun[]
  runHistoryTotal: number
  runHistoryLoading: boolean

  // SSE connection state
  isConnected: boolean
  isReconnecting: boolean
  connectionError: string | null
  eventSource: EventSource | null

  // Actions
  loadWorkflows: () => Promise<void>
  selectWorkflow: (id: string) => Promise<void>
  selectRun: (id: string) => Promise<void>
  loadNodeRuns: (runId: string) => Promise<void>
  loadTraceSpans: (runId: string) => Promise<void>
  loadArtifacts: (runId: string) => Promise<void>
  loadReview: (runId: string) => Promise<void>
  loadRunHistory: (workflowId: string, limit?: number, offset?: number) => Promise<void>
  clearSelection: () => void

  // SSE (full implementation in Prompt 6)
  connectToRunEvents: (runId: string) => void
  disconnect: () => void
  applySSEEvent: (event: RunEvent) => void
}

export const useAutomationControlStore = create<AutomationControlStore>((set, get) => ({
  // Initial state
  selectedWorkflowId: null,
  selectedRunId: null,
  selectedNodeRunId: null,

  activeRun: null,
  nodeRuns: [],
  traceSpans: [],
  artifacts: [],
  review: null,
  suggestions: [],

  workflowList: [],
  workflowListLoading: false,
  runHistory: [],
  runHistoryTotal: 0,
  runHistoryLoading: false,

  isConnected: false,
  isReconnecting: false,
  connectionError: null,
  eventSource: null,

  // Actions
  loadWorkflows: async () => {
    set({ workflowListLoading: true })
    try {
      const res = await listWorkflows({ limit: 50, offset: 0 } as Record<string, boolean | number | string | undefined>)
      set({ workflowList: res.items, workflowListLoading: false })
    } catch {
      set({ workflowListLoading: false })
    }
  },

  selectWorkflow: async (id: string) => {
    set({ selectedWorkflowId: id, selectedRunId: null, selectedNodeRunId: null, activeRun: null, nodeRuns: [], traceSpans: [], artifacts: [], review: null, suggestions: [] })
    try {
      await getWorkflow(id) // verify exists
    } catch {
      // workflow not found
    }
    // Load run history
    get().loadRunHistory(id)
  },

  selectRun: async (id: string) => {
    set({ selectedRunId: id, selectedNodeRunId: null, traceSpans: [], artifacts: [], review: null, suggestions: [] })
    set({ runHistoryLoading: true })
    try {
      const run = await getRun(id)
      set({
        activeRun: run,
        nodeRuns: run.nodeRuns ?? [],
        runHistoryLoading: false,
      })
      // Load related data
      if (run.id) {
        get().loadNodeRuns(run.id)
      }
    } catch {
      set({ runHistoryLoading: false })
    }
  },

  loadNodeRuns: async (runId: string) => {
    try {
      const items = await getNodeRuns(runId)
      if (items) {
        set({ nodeRuns: items as WorkflowNodeRun[] })
      }
    } catch {
      // silent
    }
  },

  loadTraceSpans: async (runId: string) => {
    try {
      const res = await getTraceSpans(runId)
      set({ traceSpans: (res.items ?? []) as TraceSpan[] })
    } catch {
      // silent
    }
  },

  loadArtifacts: async (runId: string) => {
    try {
      const res = await getArtifacts(runId)
      set({ artifacts: (res.items ?? []) as RunArtifact[] })
    } catch {
      // silent
    }
  },

  loadReview: async (runId: string) => {
    try {
      const review = await getReview(runId)
      set({ review })
    } catch {
      // silent
    }
  },

  loadRunHistory: async (workflowId: string, limit = 20, offset = 0) => {
    set({ runHistoryLoading: true })
    try {
      const res = await listRuns(workflowId, { limit, offset } as Record<string, boolean | number | string | undefined>)
      set({ runHistory: res.items, runHistoryTotal: res.total, runHistoryLoading: false })
    } catch {
      set({ runHistoryLoading: false })
    }
  },

  clearSelection: () => {
    set({
      selectedWorkflowId: null,
      selectedRunId: null,
      selectedNodeRunId: null,
      activeRun: null,
      nodeRuns: [],
      traceSpans: [],
      artifacts: [],
      review: null,
      suggestions: [],
      runHistory: [],
    })
  },

  // SSE (stub — full implementation in Prompt 6)
  connectToRunEvents: (_runId: string) => {
    get().disconnect()
    // Will be implemented in Prompt 6
  },

  disconnect: () => {
    const { eventSource } = get()
    if (eventSource) {
      eventSource.close()
      set({ eventSource: null, isConnected: false, isReconnecting: false })
    }
  },

  applySSEEvent: (_event: RunEvent) => {
    // Will be implemented in Prompt 6
  },
}))
