// task-board/index.tsx — Task Execution Visualization Dashboard
//
// A real-time dashboard showing AI agent task execution flow:
// - Phase stepper + step timeline for progress tracking
// - Live execution log stream
// - Self-evolution review loop visualization
// - KPI metrics and execution history

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Icon } from '@iconify/react'
import {
  KPI,
  KPIGroup,
  Widget,
  Segment,
  ChatLoader,
  EmptyState,
  ChatConversation,
  ChatMessage,
  ChatTool,
  ChainOfThought,
  Markdown,
  StreamMarkdown,
} from '@heroui-pro/react'
import {
  Button,
  Card,
  Chip,
  toast,
} from '@heroui/react'
import DashboardLayout from '@/layouts/Dashboard'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTaskBoardStore } from '@/stores/task-board'
import type { TaskBoardStepSummary, TaskBoardLiveLogEntry, TaskBoardLiveToolCall } from '@/stores/task-board'
import type { TaskBoardExecutionSummary, TaskBoardThoughtSummary, TaskBoardToolCallSummary } from '@/api/task-board'
import { listOpenClawCronJobs, type OpenClawCronJob } from '@/api/openclaw'
import TaskTopologyView from './TaskTopologyView'

// ── Page component ──────────────────────────────────────────────

function TaskBoardPage() {
  usePageTitle('任务执行看板')
  const [viewMode, setViewMode] = useState<'flow' | 'topology'>('flow')
  const [selectedJobId, setSelectedJobId] = useState('')
  const [taskDesc, setTaskDesc] = useState('')
  const [cronJobs, setCronJobs] = useState<OpenClawCronJob[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [agentId] = useState('main')

  const store = useTaskBoardStore()

  // Auto-load KPI on mount
  useEffect(() => {
    store.loadKPI()
  }, [])

  // Fetch real cron jobs from OpenClaw Gateway
  useEffect(() => {
    let cancelled = false
    async function loadJobs() {
      setJobsLoading(true)
      try {
        const result = await listOpenClawCronJobs({ limit: 50, enabled: 'enabled' })
        if (!cancelled) {
          setCronJobs(result.jobs ?? [])
        }
      } catch {
        if (!cancelled) setCronJobs([])
      } finally {
        if (!cancelled) setJobsLoading(false)
      }
    }
    loadJobs()
    return () => { cancelled = true }
  }, [])

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">任务执行看板</h1>
          <Segment selectedKey={viewMode} onSelectionChange={(key) => setViewMode(key as 'flow' | 'topology')}>
            <Segment.Item key="flow" id="flow">
              <Icon icon="lucide:workflow" className="size-4 mr-1.5" />
              流程画板
            </Segment.Item>
            <Segment.Item key="topology" id="topology">
              <Icon icon="lucide:network" className="size-4 mr-1.5" />
              拓扑视图
            </Segment.Item>
          </Segment>
        </div>

        <LiveDashboard
          viewMode={viewMode}
          selectedJobId={selectedJobId}
          setSelectedJobId={setSelectedJobId}
          taskDesc={taskDesc}
          setTaskDesc={setTaskDesc}
          cronJobs={cronJobs}
          jobsLoading={jobsLoading}
          agentId={agentId}
        />
      </div>
    </DashboardLayout>
  )
}

// ── Live Dashboard ──────────────────────────────────────────────

function LiveDashboard({
  viewMode,
  selectedJobId,
  setSelectedJobId,
  taskDesc,
  setTaskDesc,
  cronJobs,
  jobsLoading,
  agentId,
}: {
  viewMode: 'flow' | 'topology'
  selectedJobId: string
  setSelectedJobId: (v: string) => void
  taskDesc: string
  setTaskDesc: (v: string) => void
  cronJobs: OpenClawCronJob[]
  jobsLoading: boolean
  agentId: string
}) {
  const store = useTaskBoardStore()
  const logEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [store.liveLogs.length])

  const handleStart = () => {
    if (selectedJobId) {
      store.startExecution(selectedJobId, undefined, agentId)
      toast.success('定时任务已触发执行')
    } else if (taskDesc.trim()) {
      store.startExecution(undefined, taskDesc.trim(), agentId)
      toast.success('任务已开始执行')
    } else {
      toast.warning('请选择定时任务或输入任务描述')
    }
  }

  const handleStop = async () => {
    await store.stopExecution()
    toast.success('任务已停止')
  }

  const hasActivity = !!(store.activeExecution || store.isConnected || store.isReconnecting || store.connectionError)
  const isActive = store.isConnected || store.isReconnecting || store.activeExecution?.status === 'running' || store.activeExecution?.status === 'reviewing'
  const isConnecting = !store.isConnected && !store.activeExecutionId && (store.isReconnecting || !store.connectionError)
  const isViewingHistory = store.isViewingHistory && store.selectedExecution

  return (
    <>
      {/* KPI Bar */}
      <KPIBar />

      {/* Task Input */}
      <Card>
        <Card.Content className="gap-3">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1.5">选择定时任务</label>
              <select
                className="w-full rounded-xl border border-default-200 bg-default-50 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-50"
                disabled={isActive || jobsLoading}
                value={selectedJobId}
                onChange={(e) => setSelectedJobId(e.target.value)}
              >
                <option value="">
                  {jobsLoading ? '加载定时任务列表...' : cronJobs.length === 0 ? '暂无可用的定时任务' : '— 选择一个定时任务 —'}
                </option>
                {cronJobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.name || job.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              {isActive ? (
                <Button color="danger" variant="flat" onPress={handleStop}>
                  <Icon icon="lucide:square" className="size-4" />
                  停止
                </Button>
              ) : (
                <Button color="primary" onPress={handleStart}>
                  <Icon icon="lucide:play" className="size-4" />
                  执行任务
                </Button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-default-500">
            <span>Agent: <Chip size="sm" variant="flat">{agentId || 'main'}</Chip></span>
            {cronJobs.length > 0 && <span>可用任务: <Chip size="sm" variant="flat">{cronJobs.length} 个</Chip></span>}
            {store.isConnected && !store.activeExecutionId && (
              <span className="flex items-center gap-1 text-primary">
                <Icon icon="lucide:loader-circle" className="size-3 animate-spin" />
                等待执行开始...
              </span>
            )}
            {store.isReconnecting && (
              <span className="flex items-center gap-1 text-warning">
                <Icon icon="lucide:loader-circle" className="size-3 animate-spin" />
                正在重连...
              </span>
            )}
          </div>
          {/* Also allow free-text input for ad-hoc tasks */}
          <div className="pt-2 border-t border-default-100">
            <label className="block text-sm font-medium mb-1.5 text-default-400">或输入自定义任务描述</label>
            <textarea
              className="w-full min-h-[40px] rounded-xl border border-default-200 bg-default-50 px-3 py-2 text-sm placeholder:text-default-400 focus:border-primary focus:outline-none disabled:opacity-50 resize-none"
              placeholder="输入自定义任务描述（不使用定时任务时）"
              value={taskDesc}
              onChange={(e) => setTaskDesc(e.target.value)}
              rows={1}
              disabled={isActive}
            />
          </div>
        </Card.Content>
      </Card>

      {/* Connection error */}
      {store.connectionError && !store.activeExecutionId && (
        <Card className="border-danger/30 bg-danger/5">
          <Card.Content className="flex items-center gap-4 py-4">
            <div className="flex items-center justify-center size-10 rounded-full bg-danger/20 shrink-0">
              <Icon icon="lucide:plug-zap" className="size-5 text-danger" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-danger">连接失败</h3>
              <p className="text-sm text-default-500">{store.connectionError}</p>
            </div>
            <Button variant="light" size="sm" onPress={() => store.clearActiveState()}>关闭</Button>
          </Card.Content>
        </Card>
      )}

      {/* Connecting state */}
      {isConnecting && hasActivity && !store.activeExecutionId && !store.connectionError && (
        <Card className="border-primary/20 bg-primary/5">
          <Card.Content className="flex flex-col items-center gap-3 py-10">
            <div className="flex items-center justify-center size-14 rounded-full bg-primary/10">
              <Icon icon="lucide:loader-circle" className="size-7 animate-spin text-primary" />
            </div>
            <div className="text-center">
              <h3 className="font-semibold">正在连接执行引擎...</h3>
              <p className="text-sm text-default-500 mt-1">
                通过 OpenClaw Gateway 触发任务执行，等待服务响应
              </p>
            </div>
          </Card.Content>
        </Card>
      )}

      {/* Main two-column layout: History Sidebar | Content */}
      <div className="grid grid-cols-[280px_1fr] gap-3">
        {/* Left: History Panel */}
        <HistoryPanel />

        {/* Right: Main content */}
        <div className="flex flex-col gap-3 min-w-0">
          {/* Empty state when no active execution and not viewing history */}
          {!hasActivity && !isViewingHistory && (
            <EmptyState className="flex-1 flex flex-col items-center justify-center py-16">
              <Icon icon="lucide:play-square" className="size-16 text-default-300" />
              <p className="mt-4 text-lg font-medium">暂无活跃任务</p>
              <p className="mt-1 text-sm text-default-500 max-w-md text-center">
                选择一个定时任务并点击"执行任务"，系统将通过 OpenClaw Gateway 真正触发任务执行。
                你可以实时看到准备、执行、复盘三个阶段中的每一步操作和结果。
              </p>
            </EmptyState>
          )}

          {/* History detail view */}
          {isViewingHistory && !hasActivity && <HistoryDetailView viewMode={viewMode} selectedJobId={selectedJobId} taskDesc={taskDesc} cronJobs={cronJobs} />}

          {/* Visualization canvas — flow board or topology */}
          {hasActivity && viewMode === 'flow' && <FlowBoard />}
          {viewMode === 'topology' && (
            <TaskTopologyView
              selectedJobId={selectedJobId}
              taskDesc={taskDesc}
              cronJobs={cronJobs}
            />
          )}

          {/* Active execution view */}
          {hasActivity && (
            <div className="flex flex-col gap-4">
              {/* Main content: three-section monitor + detail */}
              <div className="grid grid-cols-[1fr_1fr] gap-3">
                {/* Left: Three sections — Thinking / Tool Calls / Streaming Output */}
                <div className="flex flex-col gap-2 min-w-0">
                  <ThoughtPanel />
                  <ToolCallPanel />
                  <StreamOutputPanel logEndRef={logEndRef} />
                </div>

                {/* Right: Step Detail Panel */}
                <StepDetailPanel />
              </div>

              {/* Completion / Error / Stopped summary */}
              {store.activeExecution?.status === 'complete' && (
                <Card className="border-success/30 bg-success/5">
                  <Card.Content className="flex flex-col gap-3 py-4">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center justify-center size-12 rounded-full bg-success/20 shrink-0">
                        <Icon icon="lucide:check-circle" className="size-6 text-success" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-success">执行完成</h3>
                        <p className="text-sm text-default-500">
                          {store.activeExecution.durationMs != null && `耗时 ${(store.activeExecution.durationMs / 1000).toFixed(1)}s`}
                          {store.activeExecution.reviewScore != null && ` · 评分 ${Math.round(store.activeExecution.reviewScore * 100)}%`}
                        </p>
                      </div>
                      <Button variant="light" size="sm" onPress={() => store.clearActiveState()}>关闭</Button>
                    </div>
                    {store.activeExecution?.result && (
                      <div className="p-3 rounded-lg bg-white/50 border border-success/20 max-h-[400px] overflow-y-auto">
                        <p className="text-xs font-medium text-default-500 mb-1">执行结果</p>
                        <div className="text-sm">
                          <Markdown>{store.activeExecution.result}</Markdown>
                        </div>
                      </div>
                    )}
                  </Card.Content>
                </Card>
              )}
              {store.activeExecution?.status === 'stopped' && (
                <Card className="border-warning/30 bg-warning/5">
                  <Card.Content className="flex items-center gap-4 py-4">
                    <div className="flex items-center justify-center size-12 rounded-full bg-warning/20 shrink-0">
                      <Icon icon="lucide:stop-circle" className="size-6 text-warning" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-warning">已停止</h3>
                      <p className="text-sm text-default-500">{store.activeExecution.durationMs != null && `耗时 ${(store.activeExecution.durationMs / 1000).toFixed(1)}s`}</p>
                    </div>
                    <Button variant="light" size="sm" onPress={() => store.clearActiveState()}>关闭</Button>
                  </Card.Content>
                </Card>
              )}
              {store.activeExecution?.status === 'error' && (
                <Card className="border-danger/30 bg-danger/5">
                  <Card.Content className="flex items-center gap-4 py-4">
                    <div className="flex items-center justify-center size-12 rounded-full bg-danger/20 shrink-0">
                      <Icon icon="lucide:x-circle" className="size-6 text-danger" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-danger">执行失败</h3>
                      <p className="text-sm text-default-500">{store.activeExecution.error || '未知错误'}</p>
                    </div>
                    <Button variant="light" size="sm" onPress={() => store.clearActiveState()}>关闭</Button>
                  </Card.Content>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── History Panel (left sidebar) ─────────────────────────────────

function HistoryPanel() {
  const store = useTaskBoardStore()
  const [page, setPage] = useState(0)
  const pageSize = 10

  useEffect(() => {
    store.loadHistory(pageSize, page * pageSize)
  }, [page])

  const totalPages = Math.max(1, Math.ceil(store.historyTotal / pageSize))
  const isSelected = (id: string) => store.selectedExecution?.id === id && store.isViewingHistory

  return (
    <Card className="h-fit sticky top-0">
      <Card.Header className="pb-1 pt-2 px-3">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-1.5">
            <Icon icon="lucide:history" className="size-4 text-default-600" />
            <h3 className="text-sm font-semibold">历史记录</h3>
            {store.historyTotal > 0 && (
              <Chip size="sm" variant="flat">{store.historyTotal}</Chip>
            )}
          </div>
          <Button
            variant="light"
            size="sm"
            isIconOnly
            onPress={() => { setPage(0); store.loadHistory(pageSize, 0) }}
          >
            <Icon icon="lucide:refresh-cw" className="size-3.5" />
          </Button>
        </div>
      </Card.Header>
      <Card.Content className="pt-0 px-2 pb-2">
        {store.historyLoading && store.history.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-default-400 py-4 justify-center">
            <ChatLoader.Dots />
            <span>加载历史...</span>
          </div>
        ) : store.history.length === 0 ? (
          <div className="text-xs text-default-400 py-6 text-center">
            <Icon icon="lucide:inbox" className="size-6 mx-auto mb-1.5 opacity-40" />
            <p>暂无执行记录</p>
            <p className="text-[10px] mt-0.5">执行任务后会自动记录</p>
          </div>
        ) : (
          <div className="max-h-[calc(100vh-380px)] overflow-y-auto space-y-1">
            {store.history.map((item) => (
              <button
                key={item.id}
                onClick={() => store.selectExecution(item.id)}
                className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors text-xs group ${
                  isSelected(item.id)
                    ? 'bg-primary/10 border border-primary/30'
                    : 'hover:bg-default-100 border border-transparent'
                }`}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="font-medium truncate flex-1">{item.description}</span>
                  <StatusBadge status={item.status} />
                </div>
                <div className="flex items-center justify-between mt-1 text-[10px] text-default-400">
                  <span>{new Date(item.startedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="flex items-center gap-1.5">
                    {item.durationMs != null && (
                      <span>{(item.durationMs / 1000).toFixed(1)}s</span>
                    )}
                    {item.reviewScore != null && (
                      <span className={item.reviewScore >= 0.8 ? 'text-success' : item.reviewScore >= 0.6 ? 'text-warning' : 'text-danger'}>
                        {Math.round(item.reviewScore * 100)}%
                      </span>
                    )}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 border-t border-default-100 mt-2">
            <Button
              variant="light"
              size="sm"
              isDisabled={page === 0}
              onPress={() => setPage(p => Math.max(0, p - 1))}
            >
              <Icon icon="lucide:chevron-left" className="size-3.5" />
            </Button>
            <span className="text-[10px] text-default-400">{page + 1} / {totalPages}</span>
            <Button
              variant="light"
              size="sm"
              isDisabled={page >= totalPages - 1}
              onPress={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            >
              <Icon icon="lucide:chevron-right" className="size-3.5" />
            </Button>
          </div>
        )}
      </Card.Content>
    </Card>
  )
}

function StatusBadge({ status }: { status: string }) {
  const color = status === 'complete' ? 'success' :
    status === 'error' ? 'danger' :
    status === 'stopped' ? 'warning' :
    status === 'running' ? 'primary' : 'default'
  const label = status === 'complete' ? '完成' :
    status === 'error' ? '失败' :
    status === 'stopped' ? '停止' :
    status === 'running' ? '运行' : status
  return <Chip size="sm" variant="flat" color={color} className="text-[10px] shrink-0">{label}</Chip>
}

// ── History Detail View ──────────────────────────────────────────

function HistoryDetailView({ viewMode, selectedJobId, taskDesc, cronJobs }: {
  viewMode: 'flow' | 'topology'
  selectedJobId: string
  taskDesc: string
  cronJobs: OpenClawCronJob[]
}) {
  const store = useTaskBoardStore()
  const detail = store.selectedExecution
  const logEndRef = useRef<HTMLDivElement>(null)

  if (!detail) return null

  return (
    <div className="flex flex-col gap-3">
      {/* Back button + title */}
      <div className="flex items-center gap-2">
        <Button variant="light" size="sm" onPress={() => store.clearHistoryView()}>
          <Icon icon="lucide:arrow-left" className="size-4" />
        </Button>
        <h3 className="text-sm font-semibold flex-1 truncate">{detail.description}</h3>
        <StatusBadge status={detail.status} />
        {detail.reviewScore != null && (
          <Chip
            size="sm"
            color={detail.reviewScore >= 0.8 ? 'success' : detail.reviewScore >= 0.6 ? 'warning' : 'danger'}
            variant="flat"
          >
            <Icon icon="lucide:sparkles" className="size-3 mr-0.5" />
            {Math.round(detail.reviewScore * 100)}%
          </Chip>
        )}
      </div>

      {/* Flow Board or Topology View */}
      {viewMode === 'topology' ? (
        <TaskTopologyView selectedJobId={selectedJobId} taskDesc={taskDesc} cronJobs={cronJobs} />
      ) : (
        <HistoryFlowBoard detail={detail} />
      )}

      {/* Review section — prominently displayed */}
      {detail.reviewScore != null && (
        <Card className="border-amber-200 bg-amber-50/50">
          <Card.Header className="pb-0 pt-2 px-3">
            <div className="flex items-center gap-2">
              <Icon icon="lucide:sparkles" className="size-4 text-amber-600" />
              <h3 className="text-sm font-semibold text-amber-800">复盘评估</h3>
              <Chip
                size="sm"
                color={detail.reviewScore >= 0.8 ? 'success' : detail.reviewScore >= 0.6 ? 'warning' : 'danger'}
                variant="flat"
              >
                综合评分: {Math.round(detail.reviewScore * 100)}%
              </Chip>
            </div>
          </Card.Header>
          <Card.Content className="pt-1.5 pb-3 px-3">
            <div className="space-y-2">
              {detail.reviewSummary && (
                <div>
                  <p className="text-[11px] font-medium text-amber-700 mb-0.5">复盘总结</p>
                  <div className="text-xs p-2.5 bg-white/70 rounded-lg border border-amber-200 max-h-52 overflow-y-auto">
                    <Markdown>{detail.reviewSummary}</Markdown>
                  </div>
                </div>
              )}
              {detail.betterSolution && (
                <div>
                  <p className="text-[11px] font-medium text-amber-700 mb-0.5">改进方向</p>
                  <div className="text-xs p-2.5 bg-primary/5 rounded-lg border border-primary/20 max-h-44 overflow-y-auto">
                    <Markdown>{detail.betterSolution}</Markdown>
                  </div>
                </div>
              )}
            </div>
          </Card.Content>
        </Card>
      )}

      {/* Main content: three-section monitor + detail */}
      <div className="grid grid-cols-[1fr_1fr] gap-3">
        <div className="flex flex-col gap-2 min-w-0">
          <HistoryThoughtPanel thoughts={detail.thoughts ?? []} />
          <HistoryToolCallPanel toolCalls={detail.toolCalls ?? []} />
          <HistoryStreamOutputPanel logEndRef={logEndRef} steps={detail.steps ?? []} />
        </div>
        <HistoryStepDetailPanel detail={detail} />
      </div>
    </div>
  )
}

// ── History Flow Board ───────────────────────────────────────────

function HistoryFlowBoard({ detail }: { detail: import('@/api/task-board').TaskBoardExecutionDetail }) {
  const isComplete = detail.status === 'complete'
  const isError = detail.status === 'error'

  const getPhaseStatus = (key: string): 'pending' | 'active' | 'done' | 'error' => {
    const stepsInPhase = detail.steps.filter(s => s.phase === key)
    if (stepsInPhase.length === 0) return 'pending'
    const hasError = stepsInPhase.some(s => s.status === 'error')
    if (hasError) return 'error'
    const allDone = stepsInPhase.every(s => s.status === 'done')
    if (allDone) return 'done'
    return 'active'
  }

  const stepsByPhase = useMemo(() => {
    const map: Record<string, typeof detail.steps> = { prepare: [], execute: [], review: [] }
    for (const s of detail.steps) {
      if (map[s.phase]) map[s.phase].push(s)
    }
    return map
  }, [detail.steps])

  return (
    <Card className="border-primary/10 bg-gradient-to-br from-default-50 to-primary/[0.03] overflow-visible">
      <Card.Header className="pb-0 pt-2 px-3">
        <div className="flex items-center gap-1.5">
          <Icon icon="lucide:workflow" className="size-3.5 text-primary" />
          <h3 className="text-xs font-semibold">执行流程</h3>
          {isComplete && <Chip size="sm" variant="flat" color="success" className="text-[10px]">完成</Chip>}
          {isError && <Chip size="sm" color="danger" variant="flat" className="text-[10px]">出错</Chip>}
        </div>
      </Card.Header>
      <Card.Content className="pt-1.5 pb-2 px-3">
        <div className="flex items-start justify-center gap-0 flex-wrap">
          {FLOW_PHASES.flatMap((phase, idx) => [
            <div key={`hcol-${phase.key}`} className="flex flex-col items-center">
              <PhaseNode phase={phase} status={getPhaseStatus(phase.key)} />
              {stepsByPhase[phase.key].length > 0 && (
                <div className="mt-1 flex flex-col items-center gap-0">
                  {stepsByPhase[phase.key].map((step, sIdx) => (
                    <React.Fragment key={step.id}>
                      {sIdx === 0 && <StepConnector active />}
                      {sIdx > 0 && <StepConnector active />}
                      <StepNode step={step} />
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>,
            <ConnectorWrapper key={`hconn-${idx}`}>
              <ConnectorLine active={
                getPhaseStatus(phase.key) === 'done' || getPhaseStatus(FLOW_PHASES[idx + 1]?.key ?? '') !== 'pending'
              } />
            </ConnectorWrapper>,
          ])}
          <div className="flex flex-col items-center">
            <CompleteNode
              done={isComplete}
              error={isError}
              pending={!isComplete && !isError}
            />
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

// ── History Panel Components ─────────────────────────────────────

function HistoryThoughtPanel({ thoughts }: { thoughts: TaskBoardThoughtSummary[] }) {
  if (thoughts.length === 0) {
    return (
      <Widget>
        <Widget.Header>
          <div className="flex items-center gap-2">
            <Icon icon="lucide:brain" className="size-4 text-purple-500" />
            <Widget.Title>思考过程</Widget.Title>
          </div>
        </Widget.Header>
        <Widget.Content>
          <span className="text-xs text-default-400">暂无思考记录</span>
        </Widget.Content>
      </Widget>
    )
  }

  return (
    <Widget>
      <Widget.Header>
        <div className="flex items-center gap-2">
          <Icon icon="lucide:brain" className="size-4 text-purple-500" />
          <Widget.Title>思考过程</Widget.Title>
          <Chip size="sm" variant="flat" color="secondary">{thoughts.length}</Chip>
        </div>
      </Widget.Header>
      <Widget.Content>
        <div className="max-h-[360px] overflow-y-auto space-y-2">
          {[...thoughts].reverse().map((thought, idx) => (
            <ChainOfThought.Root key={thought.id} isStreaming={false} defaultOpen={idx === 0}>
              <ChainOfThought.Trigger>
                <span className="text-xs flex items-center gap-1.5">
                  <Icon icon="lucide:brain" className="size-3 text-purple-500" />
                  AI 思考
                  <span className="text-[10px] text-default-400 font-normal">
                    {new Date(thought.createdAt).toLocaleTimeString()}
                  </span>
                </span>
              </ChainOfThought.Trigger>
              <ChainOfThought.Content>
                <ChainOfThought.Steps>
                  <ChainOfThought.Step>
                    <div className="max-h-56 overflow-auto text-xs leading-relaxed">
                      <Markdown>{thought.content}</Markdown>
                    </div>
                  </ChainOfThought.Step>
                </ChainOfThought.Steps>
              </ChainOfThought.Content>
            </ChainOfThought.Root>
          ))}
        </div>
      </Widget.Content>
    </Widget>
  )
}

function HistoryToolCallPanel({ toolCalls }: { toolCalls: TaskBoardToolCallSummary[] }) {
  if (toolCalls.length === 0) {
    return (
      <Widget>
        <Widget.Header>
          <div className="flex items-center gap-2">
            <Icon icon="lucide:wrench" className="size-4 text-amber-500" />
            <Widget.Title>工具调用</Widget.Title>
          </div>
        </Widget.Header>
        <Widget.Content>
          <span className="text-xs text-default-400">暂无工具调用</span>
        </Widget.Content>
      </Widget>
    )
  }

  const activeCalls = toolCalls.filter(tc => !tc.completedAt && !tc.error)
  const completedCalls = toolCalls.filter(tc => tc.completedAt || tc.error)

  return (
    <Widget>
      <Widget.Header>
        <div className="flex items-center gap-2">
          <Icon icon="lucide:wrench" className="size-4 text-amber-500" />
          <Widget.Title>工具调用</Widget.Title>
          <Chip size="sm" variant="flat">{toolCalls.length}</Chip>
        </div>
      </Widget.Header>
      <Widget.Content>
        <div className="max-h-[340px] overflow-y-auto space-y-2">
          {activeCalls.map((tc) => (
            <ChatTool.Root key={tc.id} state="input-available" toolName={tc.name} isExpandable triggerPrefix="调用">
              {tc.args && <ChatTool.Args input={tryParseJSON(tc.args) ?? tc.args} />}
              <ChatTool.Meta toolCallId={tc.id} />
            </ChatTool.Root>
          ))}
          {[...completedCalls].reverse().map((tc) => {
            const state: 'output-available' | 'output-error' =
              tc.error ? 'output-error' : 'output-available'
            return (
              <ChatTool.Root key={tc.id} state={state} toolName={tc.name} isExpandable triggerPrefix="调用">
                {tc.args && <ChatTool.Args input={tryParseJSON(tc.args) ?? tc.args} />}
                {tc.result && (
                  <ChatTool.Result value={
                    tc.result.length > 600 ? tc.result.slice(0, 600) + '\n\n*(结果已截断)*' : tc.result
                  } />
                )}
                {tc.error && <ChatTool.Error errorText={tc.error} />}
                <ChatTool.Meta toolCallId={tc.id} />
              </ChatTool.Root>
            )
          })}
        </div>
      </Widget.Content>
    </Widget>
  )
}

function HistoryStreamOutputPanel({ logEndRef, steps }: { logEndRef: React.RefObject<HTMLDivElement | null>; steps: TaskBoardStepSummary[] }) {
  return (
    <Widget>
      <Widget.Header>
        <div className="flex items-center gap-2">
          <Icon icon="lucide:file-text" className="size-4 text-blue-500" />
          <Widget.Title>步骤输出</Widget.Title>
          <Chip size="sm" variant="flat">{steps.length} 步</Chip>
        </div>
      </Widget.Header>
      <Widget.Content>
        <ChatConversation.Root className="min-h-[100px] max-h-[340px] border rounded-lg border-default-200 bg-default-50/50">
          <ChatConversation.Content>
            {steps.length === 0 ? (
              <div className="text-xs text-default-400 p-3">暂无步骤记录</div>
            ) : (
              steps.map((step) => (
                <ChatMessage.Assistant key={step.id}>
                  <ChatMessage.Avatar
                    show
                    fallback={step.status === 'done' ? '✓' : step.status === 'error' ? '✗' : '·'}
                    alt={step.status}
                  />
                  <ChatMessage.Bubble variant={
                    step.status === 'error' ? 'flat' :
                    step.status === 'done' ? 'soft' : 'soft'
                  }>
                    <ChatMessage.Content>
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs font-medium ${
                            step.status === 'error' ? 'text-danger' : 'text-default-700'
                          }`}>{step.name}</span>
                          <Chip size="sm" variant="flat" color={
                            step.status === 'done' ? 'success' :
                            step.status === 'error' ? 'danger' : 'default'
                          } className="text-[10px]">
                            {step.status === 'done' ? '完成' : step.status === 'error' ? '失败' : step.status}
                          </Chip>
                        </div>
                        {step.output && (
                          <div className="text-[11px] text-default-500 max-h-32 overflow-y-auto mt-0.5">
                            <Markdown>{step.output}</Markdown>
                          </div>
                        )}
                        {step.error && (
                          <div className="text-[11px] text-danger">{step.error}</div>
                        )}
                      </div>
                    </ChatMessage.Content>
                  </ChatMessage.Bubble>
                </ChatMessage.Assistant>
              ))
            )}
            <ChatConversation.ScrollAnchor />
            <div ref={logEndRef} />
          </ChatConversation.Content>
        </ChatConversation.Root>
      </Widget.Content>
    </Widget>
  )
}

function HistoryStepDetailPanel({ detail }: { detail: import('@/api/task-board').TaskBoardExecutionDetail }) {
  const [activeTab, setActiveTab] = useState<'steps' | 'review'>('steps')

  return (
    <div className="flex flex-col gap-3 overflow-y-auto max-h-[500px]">
      {/* Execution Info */}
      <Widget>
        <Widget.Header>
          <Widget.Title>执行详情</Widget.Title>
        </Widget.Header>
        <Widget.Content>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-default-500">状态</span>
              <StatusBadge status={detail.status} />
            </div>
            <div className="flex justify-between">
              <span className="text-default-500">Agent</span>
              <span>{detail.agentId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-default-500">开始时间</span>
              <span>{new Date(detail.startedAt).toLocaleString('zh-CN')}</span>
            </div>
            {detail.completedAt && (
              <div className="flex justify-between">
                <span className="text-default-500">完成时间</span>
                <span>{new Date(detail.completedAt).toLocaleString('zh-CN')}</span>
              </div>
            )}
            {detail.durationMs != null && (
              <div className="flex justify-between">
                <span className="text-default-500">总耗时</span>
                <span className="font-medium">{(detail.durationMs / 1000).toFixed(1)}s</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-default-500">步骤数</span>
              <span>{detail.steps.length} 步</span>
            </div>
            <div className="flex justify-between">
              <span className="text-default-500">工具调用</span>
              <span>{detail.toolCalls.length} 次</span>
            </div>
          </div>
        </Widget.Content>
      </Widget>

      {/* Steps list */}
      <Widget>
        <Widget.Header>
          <div className="flex items-center gap-2">
            <Icon icon="lucide:list-checks" className="size-3.5" />
            <Widget.Title>执行步骤</Widget.Title>
          </div>
        </Widget.Header>
        <Widget.Content>
          {detail.steps.length === 0 ? (
            <p className="text-xs text-default-400">暂无步骤</p>
          ) : (
            <div className="space-y-1.5 max-h-52 overflow-y-auto">
              {detail.steps.map((step, idx) => (
                <div key={step.id} className="flex items-start gap-2 p-2 rounded-lg bg-default-50 text-xs">
                  <span className="text-default-400 tabular-nums w-4 shrink-0">{idx + 1}.</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{step.name}</p>
                    {step.output && (
                      <p className="text-default-500 mt-0.5 truncate">{step.output.slice(0, 100)}</p>
                    )}
                  </div>
                  <Chip size="sm" variant="flat" color={
                    step.status === 'done' ? 'success' :
                    step.status === 'error' ? 'danger' :
                    step.status === 'running' ? 'primary' : 'default'
                  } className="text-[10px] shrink-0">
                    {step.status === 'done' ? '完成' : step.status === 'error' ? '失败' : step.status}
                  </Chip>
                </div>
              ))}
            </div>
          )}
        </Widget.Content>
      </Widget>

      {/* Result */}
      {detail.result && (
        <Widget>
          <Widget.Header>
            <Widget.Title>执行结果</Widget.Title>
          </Widget.Header>
          <Widget.Content>
            <div className="max-h-60 overflow-y-auto text-xs">
              <Markdown>{detail.result}</Markdown>
            </div>
          </Widget.Content>
        </Widget>
      )}
    </div>
  )
}

// ── KPI Bar ─────────────────────────────────────────────────────

function KPIBar() {
  const store = useTaskBoardStore()
  const kpi = store.kpi

  if (store.kpiLoading && !kpi) {
    return (
      <div className="flex items-center gap-2 text-sm text-default-500 py-2">
        <ChatLoader.Dots />
        <span>加载统计数据...</span>
      </div>
    )
  }

  return (
    <KPIGroup>
      <KPI size="sm">
        <KPI.Header>
          <KPI.Icon><Icon icon="lucide:play-circle" className="size-4" /></KPI.Icon>
          <KPI.Title>总执行次数</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <span className="text-lg font-bold tabular-nums">{kpi?.totalRuns ?? 0}</span>
        </KPI.Content>
      </KPI>

      <KPI size="sm">
        <KPI.Header>
          <KPI.Icon><Icon icon="lucide:check-circle" className="size-4" /></KPI.Icon>
          <KPI.Title>成功率</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <span className="text-lg font-bold tabular-nums">{(kpi?.successRate ?? 0).toFixed(1)}%</span>
        </KPI.Content>
      </KPI>

      <KPI size="sm">
        <KPI.Header>
          <KPI.Icon><Icon icon="lucide:clock" className="size-4" /></KPI.Icon>
          <KPI.Title>平均耗时</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <span className="text-lg font-bold tabular-nums">{kpi?.avgDurationMs ? (kpi.avgDurationMs / 1000).toFixed(1) + 's' : '-'}</span>
        </KPI.Content>
      </KPI>

      <KPI size="sm">
        <KPI.Header>
          <KPI.Icon><Icon icon="lucide:zap" className="size-4" /></KPI.Icon>
          <KPI.Title>活跃任务</KPI.Title>
        </KPI.Header>
        <KPI.Content>
          <span className="text-lg font-bold tabular-nums">{kpi?.activeTasks ?? 0}</span>
        </KPI.Content>
      </KPI>
    </KPIGroup>
  )
}


// ── Thinking Panel — 思考过程 ──────────────────────────────────

function ThoughtPanel() {
  const store = useTaskBoardStore()
  const thoughts = store.liveThoughts
  const isActive = store.isConnected || store.activeExecution?.status === 'running'

  if (thoughts.length === 0) {
    return (
      <Widget>
        <Widget.Header>
          <div className="flex items-center gap-2">
            <Icon icon="lucide:brain" className="size-4 text-purple-500" />
            <Widget.Title>思考过程</Widget.Title>
          </div>
        </Widget.Header>
        <Widget.Content>
          {isActive ? (
            <div className="flex items-center gap-2 text-xs text-default-400 py-2">
              <ChatLoader.Dots />
              <span>等待 AI 思考...</span>
            </div>
          ) : (
            <span className="text-xs text-default-400">暂无思考记录</span>
          )}
        </Widget.Content>
      </Widget>
    )
  }

  return (
    <Widget>
      <Widget.Header>
        <div className="flex items-center gap-2">
          <Icon icon="lucide:brain" className="size-4 text-purple-500" />
          <Widget.Title>思考过程</Widget.Title>
          <Chip size="sm" variant="flat" color="secondary">{thoughts.length}</Chip>
        </div>
      </Widget.Header>
      <Widget.Content>
        <div className="max-h-[360px] overflow-y-auto space-y-2">
          {[...thoughts].reverse().map((thought, idx) => (
            <ChainOfThought.Root key={idx} isStreaming={false} defaultOpen={idx === 0}>
              <ChainOfThought.Trigger>
                <span className="text-xs flex items-center gap-1.5">
                  <Icon icon="lucide:brain" className="size-3 text-purple-500" />
                  AI 思考
                  <span className="text-[10px] text-default-400 font-normal">
                    {new Date(thought.timestamp).toLocaleTimeString()}
                  </span>
                </span>
              </ChainOfThought.Trigger>
              <ChainOfThought.Content>
                <ChainOfThought.Steps>
                  <ChainOfThought.Step>
                    <div className="max-h-56 overflow-auto text-xs leading-relaxed">
                      {idx === 0 && isActive ? (
                        <StreamMarkdown isStreaming>{thought.content}</StreamMarkdown>
                      ) : (
                        <Markdown>{thought.content}</Markdown>
                      )}
                    </div>
                  </ChainOfThought.Step>
                </ChainOfThought.Steps>
              </ChainOfThought.Content>
            </ChainOfThought.Root>
          ))}
        </div>
      </Widget.Content>
    </Widget>
  )
}

// ── Tool Call Panel — 工具调用 ─────────────────────────────────

function ToolCallPanel() {
  const store = useTaskBoardStore()
  const toolCalls = Array.from(store.liveToolCalls.values())
  const isActive = store.isConnected || store.activeExecution?.status === 'running'

  if (toolCalls.length === 0) {
    return (
      <Widget>
        <Widget.Header>
          <div className="flex items-center gap-2">
            <Icon icon="lucide:wrench" className="size-4 text-amber-500" />
            <Widget.Title>工具调用</Widget.Title>
          </div>
        </Widget.Header>
        <Widget.Content>
          {isActive ? (
            <div className="flex items-center gap-2 text-xs text-default-400 py-2">
              <ChatLoader.Dots />
              <span>等待工具调用...</span>
            </div>
          ) : (
            <span className="text-xs text-default-400">暂无工具调用</span>
          )}
        </Widget.Content>
      </Widget>
    )
  }

  // Group completed/active separately
  const activeCalls = toolCalls.filter(tc => !tc.completedAt && !tc.error)
  const completedCalls = toolCalls.filter(tc => tc.completedAt || tc.error)

  return (
    <Widget>
      <Widget.Header>
        <div className="flex items-center gap-2">
          <Icon icon="lucide:wrench" className="size-4 text-amber-500" />
          <Widget.Title>工具调用</Widget.Title>
          <Chip size="sm" variant="flat">{toolCalls.length}</Chip>
          {activeCalls.length > 0 && (
            <Chip size="sm" color="warning" variant="flat" startContent={
              <Icon icon="lucide:loader-circle" className="size-3 animate-spin" />
            }>{activeCalls.length} 进行中</Chip>
          )}
        </div>
      </Widget.Header>
      <Widget.Content>
        <div className="max-h-[340px] overflow-y-auto space-y-2">
          {/* Active calls first */}
          {activeCalls.map((tc) => (
            <ChatTool.Root key={tc.callId} state="input-available" toolName={tc.name} isExpandable triggerPrefix="调用">
              {tc.args && <ChatTool.Args input={tryParseJSON(tc.args) ?? tc.args} />}
              <ChatTool.Meta toolCallId={tc.callId} />
            </ChatTool.Root>
          ))}
          {/* Completed calls */}
          {[...completedCalls].reverse().map((tc) => {
            const state: 'output-available' | 'output-error' =
              tc.error ? 'output-error' : 'output-available'
            return (
              <ChatTool.Root key={tc.callId} state={state} toolName={tc.name} isExpandable triggerPrefix="调用">
                {tc.args && <ChatTool.Args input={tryParseJSON(tc.args) ?? tc.args} />}
                {tc.result && (
                  <ChatTool.Result value={
                    tc.result.length > 600 ? tc.result.slice(0, 600) + '\n\n*(结果已截断)*' : tc.result
                  } />
                )}
                {tc.error && <ChatTool.Error errorText={tc.error} />}
                <ChatTool.Meta toolCallId={tc.callId} />
              </ChatTool.Root>
            )
          })}
        </div>
      </Widget.Content>
    </Widget>
  )
}

// ── Helper: try to parse JSON for nicer ChatTool display ──────

function tryParseJSON(input: string): unknown {
  try {
    return JSON.parse(input)
  } catch {
    return null
  }
}

// ── Step Detail Panel (Pro Widget + ChatTool + ChainOfThought) ──

function StepDetailPanel() {
  const store = useTaskBoardStore()
  const currentStep = useMemo(
    () => [...store.activeSteps].reverse().find((s) => s.status === 'running') ?? store.activeSteps[store.activeSteps.length - 1],
    [store.activeSteps],
  )

  const stepThoughts = useMemo(
    () => currentStep ? store.liveThoughts.filter((t) => t.stepId === currentStep.id) : [],
    [currentStep, store.liveThoughts],
  )

  const stepToolCalls: TaskBoardLiveToolCall[] = useMemo(
    () => currentStep
      ? Array.from(store.liveToolCalls.values()).filter((tc) => tc.stepId === currentStep.id)
      : [],
    [currentStep, store.liveToolCalls],
  )

  const isStepRunning = currentStep?.status === 'running'

  return (
    <div className="flex flex-col gap-3 overflow-y-auto max-h-[500px]">
      {/* Current Step Info */}
      <Widget>
        <Widget.Header>
          <Widget.Title>当前步骤</Widget.Title>
        </Widget.Header>
        <Widget.Content>
          {currentStep ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Chip
                  size="sm"
                  color={currentStep.status === 'running' ? 'primary' : currentStep.status === 'done' ? 'success' : 'default'}
                  variant="flat"
                >
                  {currentStep.status === 'running' ? '执行中' : currentStep.status === 'done' ? '已完成' : '等待中'}
                </Chip>
                <span className="text-xs text-default-500">{currentStep.phase}</span>
              </div>
              <p className="text-sm font-medium">{currentStep.name}</p>
              {currentStep.output && (
                <div className="max-h-40 overflow-auto rounded-lg border border-default-200">
                  <Markdown>{currentStep.output}</Markdown>
                </div>
              )}
              {isStepRunning && !currentStep.output && (
                <div className="flex items-center gap-2 text-xs text-default-400">
                  <Icon icon="lucide:ellipsis" className="size-3 animate-pulse" />
                  步骤执行中...
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-default-500">等待任务开始...</p>
          )}
        </Widget.Content>
      </Widget>

      {/* AI Reasoning — ChainOfThought with Markdown */}
      {stepThoughts.length > 0 && (
        <Widget>
          <Widget.Header>
            <div className="flex items-center gap-2">
              <Icon icon="lucide:brain" className="size-3.5 text-purple-500" />
              <Widget.Title>AI 推理过程</Widget.Title>
              <Chip size="sm" variant="flat">{stepThoughts.length}</Chip>
            </div>
          </Widget.Header>
          <Widget.Content>
            <ChainOfThought.Root isStreaming={isStepRunning} defaultOpen>
              <ChainOfThought.Trigger>
                <span className="text-xs">
                  {isStepRunning ? '正在推理...' : `共 ${stepThoughts.length} 条推理`}
                </span>
              </ChainOfThought.Trigger>
              <ChainOfThought.Content>
                <ChainOfThought.Steps>
                  {stepThoughts.map((thought, idx) => (
                    <ChainOfThought.Step key={idx} label={
                      <span className="text-[10px] text-default-400">
                        {new Date(thought.timestamp).toLocaleTimeString()}
                      </span>
                    }>
                      <div className="max-h-56 overflow-auto">
                        {isStepRunning && idx === stepThoughts.length - 1 ? (
                          <StreamMarkdown isStreaming>{thought.content}</StreamMarkdown>
                        ) : (
                          <Markdown>{thought.content}</Markdown>
                        )}
                      </div>
                    </ChainOfThought.Step>
                  ))}
                </ChainOfThought.Steps>
              </ChainOfThought.Content>
            </ChainOfThought.Root>
          </Widget.Content>
        </Widget>
      )}

      {/* Tool Calls — ChatTool with Markdown for results */}
      {stepToolCalls.length > 0 && (
        <Widget>
          <Widget.Header>
            <div className="flex items-center gap-2">
              <Icon icon="lucide:wrench" className="size-3.5 text-amber-500" />
              <Widget.Title>工具调用</Widget.Title>
              <Chip size="sm" variant="flat">{stepToolCalls.length}</Chip>
            </div>
          </Widget.Header>
          <Widget.Content>
            <div className="space-y-2">
              {stepToolCalls.map((tc) => {
                const state: 'input-available' | 'input-streaming' | 'output-available' | 'output-error' =
                  tc.error ? 'output-error' :
                  tc.result ? 'output-available' :
                  tc.completedAt ? 'output-available' :
                  'input-available'
                return (
                  <ChatTool.Root key={tc.callId} state={state} toolName={tc.name} isExpandable triggerPrefix="调用">
                    {tc.args && (
                      <ChatTool.Args input={tryParseJSON(tc.args) ?? tc.args} />
                    )}
                    {tc.result && (
                      <ChatTool.Result value={
                        tc.result.length > 800
                          ? tc.result.slice(0, 800) + '\n\n*(结果已截断)*'
                          : tc.result
                      } />
                    )}
                    {tc.error && <ChatTool.Error errorText={tc.error} />}
                    <ChatTool.Meta toolCallId={tc.callId} />
                  </ChatTool.Root>
                )
              })}
            </div>
          </Widget.Content>
        </Widget>
      )}

      {/* Review info */}
      {store.activeExecution?.reviewScore != null && (
        <Widget>
          <Widget.Header>
            <div className="flex items-center gap-2">
              <Icon icon="lucide:sparkles" className="size-3.5 text-amber-500" />
              <Widget.Title>复盘评估</Widget.Title>
            </div>
          </Widget.Header>
          <Widget.Content>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm">综合评分</span>
                <Chip
                  size="sm"
                  color={store.activeExecution.reviewScore >= 0.8 ? 'success' : store.activeExecution.reviewScore >= 0.6 ? 'warning' : 'danger'}
                  variant="flat"
                >
                  {Math.round((store.activeExecution.reviewScore ?? 0) * 100)}%
                </Chip>
              </div>
              {store.activeExecution.reviewSummary && (
                <div className="max-h-32 overflow-auto">
                  <Markdown>{store.activeExecution.reviewSummary}</Markdown>
                </div>
              )}
              {store.activeExecution.betterSolution && (
                <div className="text-xs p-2.5 bg-primary/10 rounded-lg border border-primary/20">
                  <span className="font-medium text-primary">改进方向:</span>
                  <div className="mt-0.5">
                    <Markdown>{store.activeExecution.betterSolution}</Markdown>
                  </div>
                </div>
              )}
            </div>
          </Widget.Content>
        </Widget>
      )}
    </div>
  )
}

// ── Flow Board (Coze-style visual pipeline canvas) ────────────────

const FLOW_PHASES = [
  { key: 'prepare', label: '准备', icon: 'lucide:rocket', desc: '查询任务信息' },
  { key: 'execute', label: '执行', icon: 'lucide:play', desc: '触发运行并等待结果' },
  { key: 'review', label: '复盘', icon: 'lucide:refresh-cw', desc: 'AI 评估执行质量' },
] as const

function FlowBoard() {
  const store = useTaskBoardStore()
  const { activeExecution, activeSteps, currentPhase, currentProgress } = store

  const getPhaseStatus = (key: string): 'pending' | 'active' | 'done' | 'error' => {
    if (!activeExecution && !store.isConnected) return 'pending'
    const status = activeExecution?.status
    if (status === 'error') {
      if (currentPhase === key) return 'error'
      const errIdx = FLOW_PHASES.findIndex(p => p.key === currentPhase)
      const thisIdx = FLOW_PHASES.findIndex(p => p.key === key)
      if (errIdx >= 0 && thisIdx < errIdx) return 'done'
      return 'pending'
    }
    if (status === 'complete' || currentPhase === 'complete') return 'done'
    if (currentPhase === key) return 'active'
    const curIdx = FLOW_PHASES.findIndex(p => p.key === currentPhase)
    const thisIdx = FLOW_PHASES.findIndex(p => p.key === key)
    if (curIdx >= 0 && thisIdx < curIdx) return 'done'
    return 'pending'
  }

  const stepsByPhase = useMemo(() => {
    const map: Record<string, TaskBoardStepSummary[]> = { prepare: [], execute: [], review: [] }
    for (const s of activeSteps) {
      if (map[s.phase]) map[s.phase].push(s)
    }
    return map
  }, [activeSteps])

  const isComplete = activeExecution?.status === 'complete'
  const isError = activeExecution?.status === 'error'
  const hasAnySteps = activeSteps.length > 0

  return (
    <Card className="border-primary/10 bg-gradient-to-br from-default-50 to-primary/[0.03] overflow-visible">
      <Card.Header className="pb-0 pt-2 px-3">
        <div className="flex items-center gap-1.5">
          <Icon icon="lucide:workflow" className="size-3.5 text-primary" />
          <h3 className="text-xs font-semibold">执行流程</h3>
          {isComplete && <Chip size="sm" variant="flat" color="success" className="text-[10px]">完成</Chip>}
          {!isComplete && !isError && (activeExecution || store.isConnected) && (
            <Chip size="sm" color="primary" variant="flat" startContent={
              <Icon icon="lucide:loader-circle" className="size-2.5 animate-spin" />
            } className="text-[10px]">运行中</Chip>
          )}
          {isError && <Chip size="sm" color="danger" variant="flat" className="text-[10px]">出错</Chip>}
          {/* Thin progress bar inline */}
          {currentProgress > 0 && (
            <div className="flex-1 min-w-[60px] h-1 bg-default-200 rounded-full overflow-hidden ml-2">
              <div className={`h-full rounded-full transition-all duration-700 ease-out ${isComplete ? 'bg-success' : isError ? 'bg-danger' : 'bg-primary'}`}
                style={{ width: `${isComplete ? 100 : Math.round(currentProgress)}%` }} />
            </div>
          )}
          {currentProgress > 0 && (
            <span className="text-[10px] text-default-400 tabular-nums">{isComplete ? 100 : Math.round(currentProgress)}%</span>
          )}
        </div>
      </Card.Header>
      <Card.Content className="pt-1.5 pb-2 px-3">
        {/* Main flow row: phase nodes + connectors + complete node */}
        <div className="flex items-start justify-center gap-0 flex-wrap">
          {FLOW_PHASES.flatMap((phase, idx) => [
            <div key={`col-${phase.key}`} className="flex flex-col items-center">
              <PhaseNode phase={phase} status={getPhaseStatus(phase.key)} />
              {hasAnySteps && stepsByPhase[phase.key].length > 0 && (
                <div className="mt-1 flex flex-col items-center gap-0">
                  {stepsByPhase[phase.key].map((step, sIdx) => (
                    <React.Fragment key={step.id}>
                      {sIdx === 0 && <StepConnector active={step.status !== 'pending'} />}
                      {sIdx > 0 && <StepConnector active={step.status !== 'pending'} />}
                      <StepNode step={step} />
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>,
            <ConnectorWrapper key={`conn-${idx}`}>
              <ConnectorLine active={
                getPhaseStatus(phase.key) === 'done' || getPhaseStatus(FLOW_PHASES[idx + 1]?.key ?? '') === 'active'
              } />
            </ConnectorWrapper>,
          ])}
          {/* Final complete node */}
          <div className="flex flex-col items-center">
            <CompleteNode
              done={isComplete}
              error={isError}
              pending={!isComplete && !isError}
            />
          </div>
        </div>
      </Card.Content>
    </Card>
  )
}

// ── Flow Board sub-components ─────────────────────────────────────

function PhaseNode({ phase, status }: {
  phase: { key: string; label: string; icon: string; desc: string }
  status: 'pending' | 'active' | 'done' | 'error'
}) {
  const borderColor = {
    pending: 'border-default-200',
    active: 'border-primary/50',
    done: 'border-success/40',
    error: 'border-danger/40',
  }[status]
  const bgColor = {
    pending: 'bg-default-50',
    active: 'bg-primary/10',
    done: 'bg-success/5',
    error: 'bg-danger/5',
  }[status]
  const textColor = {
    pending: 'text-default-400',
    active: 'text-primary',
    done: 'text-success',
    error: 'text-danger',
  }[status]
  const iconBg = {
    pending: 'bg-default-100',
    active: 'bg-primary/20',
    done: 'bg-success/20',
    error: 'bg-danger/20',
  }[status]
  const glow = status === 'active' ? 'shadow-[0_0_16px_rgba(59,130,246,0.25)]' : ''

  return (
    <div className={`flex flex-col items-center p-2 rounded-lg border-2 min-w-[90px] transition-all duration-500 ${borderColor} ${bgColor} ${textColor} ${glow} ${status === 'active' ? 'scale-105' : ''}`}>
      <div className={`flex items-center justify-center size-8 rounded-full mb-1 transition-colors duration-500 ${iconBg}`}>
        {status === 'active' ? (
          <Icon icon="lucide:loader-circle" className="size-4 animate-spin" />
        ) : status === 'done' ? (
          <Icon icon="lucide:check" className="size-4" />
        ) : status === 'error' ? (
          <Icon icon="lucide:x" className="size-4" />
        ) : (
          <Icon icon={phase.icon} className="size-4" />
        )}
      </div>
      <span className="text-xs font-semibold">{phase.label}</span>
      <span className="text-[10px] mt-0.5 opacity-70">{phase.desc}</span>
    </div>
  )
}

function CompleteNode({ done, error, pending }: { done: boolean; error: boolean; pending: boolean }) {
  const borderColor = done ? 'border-success/50' : error ? 'border-danger/40' : 'border-default-200'
  const bgColor = done ? 'bg-success/10' : error ? 'bg-danger/5' : 'bg-default-50'
  const textColor = done ? 'text-success' : error ? 'text-danger' : 'text-default-400'
  const iconBg = done ? 'bg-success/20' : error ? 'bg-danger/20' : 'bg-default-100'
  const glow = done ? 'shadow-[0_0_16px_rgba(34,197,94,0.2)]' : ''

  return (
    <div className={`flex flex-col items-center p-2 rounded-lg border-2 min-w-[90px] transition-all duration-500 ${borderColor} ${bgColor} ${textColor} ${glow}`}>
      <div className={`flex items-center justify-center size-8 rounded-full mb-1 ${iconBg}`}>
        {done ? (
          <Icon icon="lucide:check-circle" className="size-4" />
        ) : error ? (
          <Icon icon="lucide:x-circle" className="size-4" />
        ) : (
          <Icon icon="lucide:flag" className="size-4" />
        )}
      </div>
      <span className="text-xs font-semibold">完成</span>
      <span className="text-[10px] mt-0.5 opacity-70">
        {done ? '执行成功' : error ? '执行失败' : pending ? '等待完成' : '未开始'}
      </span>
    </div>
  )
}

function ConnectorWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center pt-[36px] px-0.5 shrink-0">
      {children}
    </div>
  )
}

function ConnectorLine({ active }: { active: boolean }) {
  return (
    <svg width="44" height="10" className="shrink-0">
      <defs>
        <marker id="arrow-done" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <polygon points="0,0 6,3 0,6" fill="currentColor" className="text-success" />
        </marker>
        <marker id="arrow-pending" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <polygon points="0,0 6,3 0,6" fill="currentColor" className="text-default-300" />
        </marker>
      </defs>
      <line
        x1="0" y1="5" x2="38" y2="5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        className={active ? 'text-success' : 'text-default-300'}
      />
      <polygon
        points="37,2 43,5 37,8"
        fill="currentColor"
        className={active ? 'text-success' : 'text-default-300'}
      />
    </svg>
  )
}

function StepConnector({ active }: { active: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <div className={`w-0.5 h-4 rounded transition-colors duration-300 ${active ? 'bg-primary/60' : 'bg-default-200'}`} />
      <div className={`size-1.5 rounded-full -my-px transition-colors duration-300 ${active ? 'bg-primary' : 'bg-default-200'}`} />
    </div>
  )
}

function StepNode({ step }: { step: TaskBoardStepSummary }) {
  const borderColor = {
    pending: 'border-default-200',
    running: 'border-primary/40',
    done: 'border-success/30',
    error: 'border-danger/30',
  }[step.status] ?? 'border-default-200'
  const bgColor = {
    pending: 'bg-default-50',
    running: 'bg-primary/10',
    done: 'bg-success/5',
    error: 'bg-danger/5',
  }[step.status] ?? 'bg-default-50'
  const textColor = {
    pending: 'text-default-400',
    running: 'text-primary',
    done: 'text-success',
    error: 'text-danger',
  }[step.status] ?? 'text-default-400'

  const iconEl = step.status === 'running' ? (
    <Icon icon="lucide:loader-circle" className="size-3 animate-spin" />
  ) : step.status === 'done' ? (
    <Icon icon="lucide:check" className="size-3" />
  ) : step.status === 'error' ? (
    <Icon icon="lucide:x" className="size-3" />
  ) : (
    <span className="size-1.5 rounded-full bg-default-300" />
  )

  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-all duration-300 ${borderColor} ${bgColor} ${textColor} whitespace-nowrap`}>
      {iconEl}
      <span className="font-medium">{step.name}</span>
      {step.status === 'running' && (
        <span className="flex gap-0.5 ml-0.5">
          <span className="size-1 rounded-full bg-primary animate-bounce [animation-delay:0ms]" />
          <span className="size-1 rounded-full bg-primary animate-bounce [animation-delay:150ms]" />
          <span className="size-1 rounded-full bg-primary animate-bounce [animation-delay:300ms]" />
        </span>
      )}
    </div>
  )
}

// ── Stream Output Panel — 流式输出 ────────────────────────────

function StreamOutputPanel({ logEndRef }: { logEndRef: React.RefObject<HTMLDivElement | null> }) {
  const store = useTaskBoardStore()

  return (
    <Widget>
      <Widget.Header>
        <div className="flex items-center gap-2">
          <Icon icon="lucide:file-text" className="size-4 text-blue-500" />
          <Widget.Title>流式输出</Widget.Title>
          <Chip size="sm" variant="flat">{store.liveLogs.length} 条</Chip>
          {store.isConnected && (
            <Chip size="sm" color="success" variant="flat" startContent={
              <span className="size-1.5 rounded-full bg-success animate-pulse" />
            }>连接中</Chip>
          )}
        </div>
      </Widget.Header>
      <Widget.Content>
        <ChatConversation.Root className="min-h-[100px] max-h-[340px] border rounded-lg border-default-200 bg-default-50/50">
          <ChatConversation.Content>
            {store.liveLogs.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-default-400 p-3">
                {store.isConnected ? (
                  <>
                    <ChatLoader.Dots />
                    <span>等待输出...</span>
                  </>
                ) : (
                  <span className="text-default-400">暂无输出</span>
                )}
              </div>
            )}
            {store.liveLogs.map((entry, idx) => (
              <ChatMessage.Assistant key={idx}>
                <ChatMessage.Avatar
                  show
                  fallback={
                    entry.level === 'error' ? '!' :
                    entry.level === 'warn' ? 'W' : '·'
                  }
                  alt={entry.level}
                />
                <ChatMessage.Bubble variant={
                  entry.level === 'error' ? 'flat' :
                  entry.level === 'warn' ? 'flat' :
                  'soft'
                }>
                  <ChatMessage.Content>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[10px] text-default-400">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                      <div className={`text-xs min-w-0 break-words ${
                        entry.level === 'error' ? 'text-danger font-medium' :
                        entry.level === 'warn' ? 'text-warning' :
                        'text-default-600'
                      }`}>
                        {entry.message.length > 200 && entry.message.includes('\n') ? (
                          <Markdown>{entry.message}</Markdown>
                        ) : (
                          <span>{entry.message}</span>
                        )}
                      </div>
                    </div>
                  </ChatMessage.Content>
                </ChatMessage.Bubble>
              </ChatMessage.Assistant>
            ))}
            <ChatConversation.ScrollAnchor />
            <div ref={logEndRef} />
          </ChatConversation.Content>
        </ChatConversation.Root>
      </Widget.Content>
    </Widget>
  )
}

export default TaskBoardPage
