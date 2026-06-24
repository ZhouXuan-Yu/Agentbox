// TaskTopologyView.tsx — ReactFlow 拓扑可视化任务执行流程
//
// 以节点图布方式展示任务执行的完整链路：
//   触发器 → 阶段 → 步骤 → AI思考 → 工具调用
// 使用 dagre 自动布局（上→下），实时反映执行状态变化。
// 点击节点展开详情面板，展示完整的步骤输出、思考内容和工具调用结果。

import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import dagre from 'dagre'
import '@xyflow/react/dist/style.css'
import { Icon } from '@iconify/react'
import { Button, Card, Chip } from '@heroui/react'
import { Markdown } from '@heroui-pro/react'
import { useThemeStore } from '@/stores/theme'
import { useTaskBoardStore } from '@/stores/task-board'
import type {
  TaskBoardStepSummary,
  TaskBoardLiveThought,
  TaskBoardLiveToolCall,
} from '@/stores/task-board'
import type { OpenClawCronJob } from '@/api/openclaw'

// ── Types ────────────────────────────────────────────────────────

type TopologyNodeKind = 'trigger' | 'phase' | 'step' | 'thought' | 'tool'

type TopologyNodeData = {
  icon: string
  id: string
  kind: TopologyNodeKind
  meta: string
  status: string
  title: string
  tone: 'accent' | 'danger' | 'muted' | 'success' | 'warning'
  isSelected: boolean
  /** Additional context stored on node for detail panel lookup */
  context?: Record<string, unknown>
}

type TopoNode = Node<TopologyNodeData, 'topologyNode'>
type TopoEdge = Edge

const NODE_WIDTH = 210
const NODE_HEIGHT = 74
const THOUGHT_NODE_WIDTH = 180
const THOUGHT_NODE_HEIGHT = 56
const TOOL_NODE_WIDTH = 180
const TOOL_NODE_HEIGHT = 56

const PHASE_CONFIG: Record<string, { icon: string; label: string }> = {
  prepare: { icon: 'lucide:rocket', label: '准备阶段' },
  execute: { icon: 'lucide:play', label: '执行阶段' },
  review: { icon: 'lucide:refresh-cw', label: '复盘阶段' },
}

const nodeTypes = { topologyNode: TopologyNodeCard }

// ── Main Component ───────────────────────────────────────────────

interface TaskTopologyViewProps {
  selectedJobId: string
  taskDesc: string
  cronJobs: OpenClawCronJob[]
}

export default function TaskTopologyView({
  selectedJobId,
  taskDesc,
  cronJobs,
}: TaskTopologyViewProps) {
  const store = useTaskBoardStore()
  const colorMode = useThemeStore((state) => state.resolvedTheme)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  // ── Detect history viewing mode ──────────────────────────────
  const isViewingHistory = store.isViewingHistory && store.selectedExecution
  const historyDetail = store.selectedExecution

  // ── Unified data sources (live vs history) ────────────────────
  const steps = isViewingHistory ? (historyDetail?.steps ?? []) : store.activeSteps
  const thoughts: TaskBoardLiveThought[] = useMemo(
    () =>
      isViewingHistory
        ? (historyDetail?.thoughts ?? []).map((t) => ({
            content: t.content,
            stepId: t.stepId,
            timestamp: t.createdAt,
          }))
        : store.liveThoughts,
    [isViewingHistory, historyDetail?.thoughts, store.liveThoughts],
  )
  const toolCalls: Map<string, TaskBoardLiveToolCall> = useMemo(
    () =>
      isViewingHistory
        ? new Map(
            (historyDetail?.toolCalls ?? []).map((tc) => [
              tc.id,
              {
                callId: tc.id,
                stepId: tc.stepId,
                name: tc.name,
                args: tc.args,
                result: tc.result,
                error: tc.error,
                startedAt: tc.startedAt ?? '',
                completedAt: tc.completedAt,
              } satisfies TaskBoardLiveToolCall,
            ]),
          )
        : store.liveToolCalls,
    [isViewingHistory, historyDetail?.toolCalls, store.liveToolCalls],
  )
  const currentPhase = isViewingHistory ? (historyDetail?.phase ?? '') : store.currentPhase
  const executionStatus = isViewingHistory ? (historyDetail?.status ?? '') : (store.activeExecution?.status ?? '')

  const layouted = useMemo(
    () =>
      buildTopologyGraph(
        steps,
        thoughts,
        toolCalls,
        currentPhase,
        executionStatus,
        selectedJobId,
        taskDesc,
        cronJobs,
        selectedNodeId,
      ),
    [
      steps,
      thoughts,
      toolCalls,
      currentPhase,
      executionStatus,
      selectedJobId,
      taskDesc,
      cronJobs,
      selectedNodeId,
    ],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState<TopologyNode>(layouted.nodes)

  // Sync layouted nodes into ReactFlow state, preserving user-dragged positions when possible
  useEffect(() => {
    setNodes((previous) => {
      const prevById = new Map(previous.map((n) => [n.id, n]))
      const sameSet =
        previous.length === layouted.nodes.length &&
        layouted.nodes.every((n) => prevById.has(n.id))
      return layouted.nodes.map((n) => {
        const prev = sameSet ? prevById.get(n.id) : null
        return prev ? { ...n, position: prev.position } : n
      })
    })
  }, [layouted.nodes, setNodes])

  const onNodeClick = useCallback(
    (_: unknown, node: TopoNode) => {
      setSelectedNodeId((prev) => (prev === node.id ? null : node.id))
    },
    [],
  )

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null)
  }, [])

  const selectedNode = useMemo(
    () => layouted.nodes.find((n) => n.id === selectedNodeId),
    [layouted.nodes, selectedNodeId],
  )

  const isEmpty =
    steps.length === 0 &&
    thoughts.length === 0 &&
    toolCalls.size === 0

  const hasExecution = isViewingHistory
    ? !!(historyDetail)
    : !!(store.activeExecution || store.isConnected)

  // Idle state
  if (!hasExecution && isEmpty) {
    return (
      <div className="relative h-[560px] overflow-hidden rounded-2xl bg-surface-secondary/50 border border-default-200">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <div className="flex items-center justify-center size-16 rounded-full bg-default-100">
              <Icon icon="lucide:network" className="size-8 text-default-400" />
            </div>
            <div>
              <p className="text-base font-medium text-foreground">暂无执行任务</p>
              <p className="mt-1 text-sm text-muted max-w-sm">
                选择一个定时任务并点击"执行任务"，拓扑视图将实时展示执行链路中的阶段、步骤、AI 思考和工具调用。
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <section
      className="grid min-w-0 transition-[grid-template-columns,gap] duration-300 ease-out"
      style={{
        gap: selectedNode ? '1rem' : '0rem',
        gridTemplateColumns: selectedNode
          ? 'minmax(0, 1fr) minmax(300px, 360px)'
          : 'minmax(0, 1fr) 0px',
      }}
    >
      {/* Graph canvas */}
      <Card className="min-w-0">
        <Card.Content className="p-0">
          <div className="relative h-[560px] overflow-hidden rounded-2xl bg-surface-secondary/50">
            <ReactFlow
              colorMode={colorMode}
              defaultEdgeOptions={{ type: 'default' }}
              edges={layouted.edges}
              fitView
              fitViewOptions={{ maxZoom: 1.05, padding: 0.2 }}
              minZoom={0.35}
              nodeTypes={nodeTypes}
              nodes={nodes}
              nodesDraggable
              nodesConnectable={false}
              onNodeClick={onNodeClick}
              onNodesChange={onNodesChange}
              onPaneClick={onPaneClick}
              proOptions={{ hideAttribution: true }}
            >
              <Background
                color="var(--border)"
                gap={24}
                size={1}
                variant={BackgroundVariant.Dots}
              />
              <Controls className="!border-border !bg-background/90 !shadow-sm" />
            </ReactFlow>

            {/* Legend */}
            <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-wrap items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-xs text-muted">
              <LegendDot className="bg-success" label="已完成" />
              <LegendDot className="bg-accent" label="进行中" />
              <LegendDot className="bg-warning" label="工具调用" />
              <LegendDot className="bg-violet-500" label="AI 思考" />
              <LegendDot className="bg-muted" label="等待中" />
            </div>

            {/* Waiting overlay */}
            {isEmpty && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-2 rounded-2xl bg-background/80 px-6 py-4 text-sm text-muted backdrop-blur">
                  <Icon icon="lucide:loader-circle" className="size-5 animate-spin" />
                  <span>等待执行事件流...</span>
                </div>
              </div>
            )}
          </div>
        </Card.Content>
      </Card>

      {/* Detail panel */}
      <div
        className={`min-w-0 overflow-hidden transition-opacity duration-300 ease-out ${
          selectedNode ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {selectedNode && (
          <NodeDetailPanel
            node={selectedNode}
            store={store}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </section>
  )
}

// ── Node Detail Panel ────────────────────────────────────────────

function NodeDetailPanel({
  node,
  store,
  onClose,
}: {
  node: TopoNode
  store: ReturnType<typeof useTaskBoardStore.getState>
  onClose: () => void
}) {
  const { data } = node

  return (
    <Card className="h-full max-h-[560px] overflow-auto">
      <Card.Header>
        <div className="flex w-full min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Icon icon="lucide:badge-info" className="size-5 shrink-0 text-muted" />
            <div className="min-w-0">
              <Card.Title className="truncate">{data.title}</Card.Title>
              <Card.Description>
                {data.kind === 'step'
                  ? '步骤详情'
                  : data.kind === 'thought'
                    ? 'AI 思考内容'
                    : data.kind === 'tool'
                      ? '工具调用结果'
                      : '节点信息'}
              </Card.Description>
            </div>
          </div>
          <Button isIconOnly aria-label="关闭" size="sm" variant="ghost" onPress={onClose}>
            <Icon icon="lucide:x" className="size-4" />
          </Button>
        </div>
      </Card.Header>
      <Card.Content className="space-y-3">
        {/* Status and meta */}
        <div className="flex items-center gap-2">
          <Chip size="sm" variant="flat" color={toneToColor(data.tone)}>
            {data.status}
          </Chip>
          {data.meta && (
            <span className="text-xs text-muted">{data.meta}</span>
          )}
        </div>

        {/* Step details */}
        {data.kind === 'step' && <StepNodeDetail nodeId={data.id} store={store} />}

        {/* Thought details */}
        {data.kind === 'thought' && <ThoughtNodeDetail nodeId={data.id} store={store} />}

        {/* Tool details */}
        {data.kind === 'tool' && <ToolNodeDetail nodeId={data.id} store={store} />}

        {/* Phase details */}
        {data.kind === 'phase' && <PhaseNodeDetail nodeId={data.id} store={store} />}

        {/* Trigger details */}
        {data.kind === 'trigger' && <TriggerNodeDetail store={store} />}
      </Card.Content>
    </Card>
  )
}

function toneToColor(tone: string): 'success' | 'primary' | 'warning' | 'danger' | 'default' {
  switch (tone) {
    case 'success': return 'success'
    case 'accent': return 'primary'
    case 'warning': return 'warning'
    case 'danger': return 'danger'
    default: return 'default'
  }
}

function StepNodeDetail({
  nodeId,
  store,
}: {
  nodeId: string
  store: ReturnType<typeof useTaskBoardStore.getState>
}) {
  // nodeId format: "step-<stepId>"
  const stepId = nodeId.startsWith('step-') ? nodeId.slice(5) : nodeId
  const isViewingHistory = store.isViewingHistory && store.selectedExecution

  const step = isViewingHistory
    ? store.selectedExecution?.steps.find((s) => s.id === stepId)
    : store.activeSteps.find((s) => s.id === stepId)

  const thoughts: { content: string; timestamp: string }[] = isViewingHistory
    ? (store.selectedExecution?.thoughts ?? []).filter((t) => t.stepId === stepId).map((t) => ({ content: t.content, timestamp: t.createdAt }))
    : store.liveThoughts.filter((t) => t.stepId === stepId)

  const toolCalls: { callId?: string; id?: string; name: string; args?: string; result?: string; error?: string }[] = isViewingHistory
    ? (store.selectedExecution?.toolCalls ?? []).filter((tc) => tc.stepId === stepId).map((tc) => ({ callId: tc.id, name: tc.name, args: tc.args, result: tc.result, error: tc.error }))
    : Array.from(store.liveToolCalls.values()).filter((tc) => tc.stepId === stepId)

  if (!step) {
    return <p className="text-sm text-muted">步骤数据不可用</p>
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium text-muted mb-1">步骤名称</p>
        <p className="text-sm font-medium">{step.name}</p>
      </div>

      {step.output ? (
        <div>
          <p className="text-xs font-medium text-muted mb-1">输出结果</p>
          <div className="max-h-48 overflow-auto rounded-lg border border-default-200 p-3 bg-default-50">
            <Markdown>{step.output}</Markdown>
          </div>
        </div>
      ) : step.status === 'running' ? (
        <p className="text-sm text-muted italic">步骤执行中，输出尚未生成...</p>
      ) : null}

      {step.error && (
        <div className="rounded-lg bg-danger/10 border border-danger/20 p-3">
          <p className="text-xs font-medium text-danger mb-1">错误</p>
          <p className="text-sm text-danger">{step.error}</p>
        </div>
      )}

      {thoughts.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted mb-2">
            <Icon icon="lucide:brain" className="size-3 inline mr-1 text-purple-500" />
            AI 思考 ({thoughts.length})
          </p>
          <div className="space-y-2 max-h-60 overflow-auto">
            {thoughts.map((t, i) => (
              <div key={i} className="rounded-lg border border-default-200 p-2.5 bg-default-50 text-xs leading-relaxed">
                <Markdown>{t.content}</Markdown>
              </div>
            ))}
          </div>
        </div>
      )}

      {toolCalls.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted mb-2">
            <Icon icon="lucide:wrench" className="size-3 inline mr-1 text-amber-500" />
            工具调用 ({toolCalls.length})
          </p>
          <div className="space-y-2 max-h-60 overflow-auto">
            {toolCalls.map((tc) => (
              <div key={tc.callId ?? tc.id} className="rounded-lg border border-default-200 p-2.5 bg-default-50 text-xs">
                <p className="font-medium mb-1">{tc.name}</p>
                {tc.args && (
                  <pre className="text-[11px] text-muted mb-1 whitespace-pre-wrap font-mono">
                    {tc.args.length > 300 ? tc.args.slice(0, 300) + '…' : tc.args}
                  </pre>
                )}
                {tc.result && (
                  <div className="text-[11px] leading-relaxed">
                    <Markdown>{tc.result.length > 500 ? tc.result.slice(0, 500) + '\n\n*(结果已截断)*' : tc.result}</Markdown>
                  </div>
                )}
                {tc.error && <p className="text-danger text-[11px]">{tc.error}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ThoughtNodeDetail({
  nodeId,
  store,
}: {
  nodeId: string
  store: ReturnType<typeof useTaskBoardStore.getState>
}) {
  // nodeId format: "thought-<stepId>-<idx>"
  const parts = nodeId.split('-')
  const stepId = parts[1] ?? ''
  const idx = parseInt(parts[2] ?? '0', 10)
  const isViewingHistory = store.isViewingHistory && store.selectedExecution

  const stepThoughts = isViewingHistory
    ? (store.selectedExecution?.thoughts ?? []).filter((t) => t.stepId === stepId)
    : store.liveThoughts.filter((t) => t.stepId === stepId)

  const thoughtRaw = stepThoughts[idx]
  if (!thoughtRaw) {
    return <p className="text-sm text-muted">思考数据不可用</p>
  }

  // Normalize: history has content + createdAt, live has content + timestamp
  const content = 'content' in thoughtRaw ? thoughtRaw.content : ''
  const ts = 'createdAt' in thoughtRaw ? thoughtRaw.createdAt : ('timestamp' in thoughtRaw ? (thoughtRaw as { timestamp: string }).timestamp : '')

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium text-muted mb-1">关联步骤</p>
        <p className="text-sm">{stepId || '-'}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-muted mb-1">时间</p>
        <p className="text-xs">{ts ? new Date(ts).toLocaleTimeString() : '-'}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-muted mb-1">思考内容</p>
        <div className="max-h-80 overflow-auto rounded-lg border border-default-200 p-3 bg-default-50 text-xs leading-relaxed">
          <Markdown>{content}</Markdown>
        </div>
      </div>
    </div>
  )
}

function ToolNodeDetail({
  nodeId,
  store,
}: {
  nodeId: string
  store: ReturnType<typeof useTaskBoardStore.getState>
}) {
  // nodeId format: "tool-<callId>"
  const callId = nodeId.startsWith('tool-') ? nodeId.slice(5) : nodeId
  const isViewingHistory = store.isViewingHistory && store.selectedExecution

  const toolLive = store.liveToolCalls.get(callId)
  const toolHistory = (store.selectedExecution?.toolCalls ?? []).find((tc) => tc.id === callId)

  if (!toolLive && !toolHistory) {
    return <p className="text-sm text-muted">工具调用数据不可用</p>
  }

  const name = isViewingHistory ? toolHistory?.name : toolLive?.name
  const stepId = isViewingHistory ? toolHistory?.stepId : toolLive?.stepId
  const args = isViewingHistory ? toolHistory?.args : toolLive?.args
  const result = isViewingHistory ? toolHistory?.result : toolLive?.result
  const error = isViewingHistory ? toolHistory?.error : toolLive?.error

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium text-muted mb-1">工具名称</p>
        <p className="text-sm font-medium font-mono">{name || '-'}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-muted mb-1">关联步骤</p>
        <p className="text-sm">{stepId || '-'}</p>
      </div>
      {args && (
        <div>
          <p className="text-xs font-medium text-muted mb-1">调用参数</p>
          <pre className="max-h-40 overflow-auto rounded-lg border border-default-200 p-3 bg-default-50 text-xs font-mono whitespace-pre-wrap">
            {args.length > 500 ? args.slice(0, 500) + '\n…' : args}
          </pre>
        </div>
      )}
      {result && (
        <div>
          <p className="text-xs font-medium text-muted mb-1">返回结果</p>
          <div className="max-h-60 overflow-auto rounded-lg border border-default-200 p-3 bg-default-50 text-xs leading-relaxed">
            <Markdown>{result.length > 800 ? result.slice(0, 800) + '\n\n*(结果已截断)*' : result}</Markdown>
          </div>
        </div>
      )}
      {error && (
        <div className="rounded-lg bg-danger/10 border border-danger/20 p-3">
          <p className="text-xs font-medium text-danger mb-1">错误</p>
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}
    </div>
  )
}

function PhaseNodeDetail({
  nodeId,
  store,
}: {
  nodeId: string
  store: ReturnType<typeof useTaskBoardStore.getState>
}) {
  const phaseKey = nodeId.startsWith('phase-') ? nodeId.slice(6) : nodeId
  const config = PHASE_CONFIG[phaseKey]
  const isViewingHistory = store.isViewingHistory && store.selectedExecution
  const phaseSteps = isViewingHistory
    ? (store.selectedExecution?.steps ?? []).filter((s) => s.phase === phaseKey)
    : store.activeSteps.filter((s) => s.phase === phaseKey)

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium text-muted mb-1">阶段</p>
        <p className="text-sm font-medium">{config?.label ?? phaseKey}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-muted mb-1">步骤数</p>
        <p className="text-sm">{phaseSteps.length}</p>
      </div>
      {phaseSteps.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted mb-1">步骤列表</p>
          <div className="space-y-1">
            {phaseSteps.map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-xs">
                <span className={`size-1.5 rounded-full ${s.status === 'done' ? 'bg-success' : s.status === 'running' ? 'bg-accent' : s.status === 'error' ? 'bg-danger' : 'bg-muted'}`} />
                <span>{s.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TriggerNodeDetail({
  store,
}: {
  store: ReturnType<typeof useTaskBoardStore.getState>
}) {
  const isViewingHistory = store.isViewingHistory && store.selectedExecution
  const exec = isViewingHistory ? store.selectedExecution : store.activeExecution
  const execId = isViewingHistory ? (store.selectedExecution?.id ?? '') : store.activeExecutionId
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium text-muted mb-1">任务描述</p>
        <p className="text-sm">{exec?.description || '-'}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-muted mb-1">执行 ID</p>
        <p className="text-xs font-mono">{exec?.id || execId || '-'}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-muted mb-1">Agent</p>
        <p className="text-sm">{exec?.agentId || '-'}</p>
      </div>
      {exec?.startedAt && (
        <div>
          <p className="text-xs font-medium text-muted mb-1">开始时间</p>
          <p className="text-xs">{new Date(exec.startedAt).toLocaleString()}</p>
        </div>
      )}
    </div>
  )
}

// ── Graph Builder ────────────────────────────────────────────────

function buildTopologyGraph(
  activeSteps: TaskBoardStepSummary[],
  liveThoughts: TaskBoardLiveThought[],
  liveToolCalls: Map<string, TaskBoardLiveToolCall>,
  currentPhase: string,
  executionStatus: string,
  selectedJobId: string,
  taskDesc: string,
  cronJobs: OpenClawCronJob[],
  selectedNodeId: string | null,
): { nodes: TopoNode[]; edges: TopoEdge[] } {
  const rawNodes: TopoNode[] = []
  const rawEdges: TopoEdge[] = []
  const nodeIds = new Set<string>()

  const addNode = (node: TopoNode) => {
    nodeIds.add(node.id)
    rawNodes.push(node)
  }
  const addEdge = (edge: TopoEdge) => {
    rawEdges.push(edge)
  }

  // ── 1. Trigger node ──
  const triggerLabel = getTriggerLabel(selectedJobId, taskDesc, cronJobs)
  const triggerId = 'trigger'
  addNode({
    id: triggerId,
    type: 'topologyNode',
    position: { x: 0, y: 0 },
    sourcePosition: Position.Bottom,
    data: {
      icon: 'lucide:zap',
      id: triggerId,
      kind: 'trigger',
      meta: triggerLabel,
      status: executionStatus ? '已触发' : '等待触发',
      title: '任务触发器',
      tone: executionStatus ? 'success' : 'muted',
      isSelected: selectedNodeId === triggerId,
    },
  })

  // ── 2. Phase nodes + steps + thoughts + tools ──
  const phases = ['prepare', 'execute', 'review'] as const
  let prevPhaseId = triggerId

  for (const phaseKey of phases) {
    const phaseConfig = PHASE_CONFIG[phaseKey]
    const phaseStatus = getPhaseStatus(phaseKey, currentPhase, executionStatus)
    const phaseId = `phase-${phaseKey}`

    addNode({
      id: phaseId,
      type: 'topologyNode',
      position: { x: 0, y: 0 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: {
        icon: phaseConfig.icon,
        id: phaseId,
        kind: 'phase',
        meta: phaseStatus === 'active' ? '执行中…' : phaseStatus === 'done' ? '已完成' : '等待中',
        status: phaseStatus === 'active' ? '进行中' : phaseStatus === 'done' ? '已完成' : '等待',
        title: phaseConfig.label,
        tone: phaseStatus === 'active' ? 'accent' : phaseStatus === 'done' ? 'success' : 'muted',
        isSelected: selectedNodeId === phaseId,
      },
    })
    addEdge({
      id: `edge-${prevPhaseId}-${phaseId}`,
      source: prevPhaseId,
      target: phaseId,
      animated: phaseStatus === 'active',
      markerEnd: { type: MarkerType.ArrowClosed, color: phaseStatus === 'done' ? '#22c55e' : phaseStatus === 'active' ? '#6366f1' : '#94a3b8' },
      style: { stroke: phaseStatus === 'done' ? '#22c55e' : phaseStatus === 'active' ? '#6366f1' : '#94a3b8', strokeWidth: 2 },
    })

    // Steps under phase
    const phaseSteps = activeSteps.filter((s) => s.phase === phaseKey)
    let prevStepId = phaseId

    for (const step of phaseSteps) {
      const stepId = `step-${step.id}`
      const stepTone = getStepTone(step)
      addNode({
        id: stepId,
        type: 'topologyNode',
        position: { x: 0, y: 0 },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        data: {
          icon: 'lucide:footprints',
          id: stepId,
          kind: 'step',
          meta: step.durationMs != null ? `${(step.durationMs / 1000).toFixed(1)}s` : step.status === 'running' ? '执行中…' : '',
          status: step.status === 'running' ? '执行中' : step.status === 'done' ? '完成' : step.status === 'error' ? '出错' : '等待',
          title: step.name,
          tone: stepTone,
          isSelected: selectedNodeId === stepId,
        },
      })
      addEdge({
        id: `edge-${prevStepId}-${stepId}`,
        source: prevStepId,
        target: stepId,
        animated: step.status === 'running',
        markerEnd: { type: MarkerType.ArrowClosed, color: stepColor(step) },
        style: { stroke: stepColor(step), strokeWidth: 1.5, strokeDasharray: step.status === 'pending' ? '5 4' : undefined },
      })

      // Thoughts
      const stepThoughts = liveThoughts.filter((t) => t.stepId === step.id)
      let prevThoughtId = stepId
      for (let tIdx = 0; tIdx < stepThoughts.length; tIdx++) {
        const thought = stepThoughts[tIdx]
        const thoughtId = `thought-${step.id}-${tIdx}`
        addNode({
          id: thoughtId,
          type: 'topologyNode',
          position: { x: 0, y: 0 },
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top,
          data: {
            icon: 'lucide:brain',
            id: thoughtId,
            kind: 'thought',
            meta: thought.content.length > 40 ? thought.content.slice(0, 40) + '…' : thought.content,
            status: '推理',
            title: 'AI 思考',
            tone: 'warning',
            isSelected: selectedNodeId === thoughtId,
          },
        })
        addEdge({
          id: `edge-${prevThoughtId}-${thoughtId}`,
          source: prevThoughtId,
          target: thoughtId,
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed, color: '#8b5cf6' },
          style: { stroke: '#8b5cf6', strokeWidth: 1.5, strokeDasharray: '4 3' },
        })

        // Tool calls
        const thoughtTools = Array.from(liveToolCalls.values()).filter(
          (tc) => tc.stepId === step.id && tc.startedAt >= thought.timestamp,
        )
        let prevToolId = thoughtId
        for (const tool of thoughtTools) {
          const toolId = `tool-${tool.callId}`
          const toolColor = tool.error ? '#ef4444' : tool.result ? '#22c55e' : '#f59e0b'
          addNode({
            id: toolId,
            type: 'topologyNode',
            position: { x: 0, y: 0 },
            sourcePosition: Position.Bottom,
            targetPosition: Position.Top,
            data: {
              icon: 'lucide:wrench',
              id: toolId,
              kind: 'tool',
              meta: tool.error ? '调用失败' : tool.result ? '已返回结果' : '调用中…',
              status: tool.error ? '出错' : tool.result ? '完成' : '调用中',
              title: tool.name,
              tone: tool.error ? 'danger' : tool.result ? 'success' : 'warning',
              isSelected: selectedNodeId === toolId,
            },
          })
          addEdge({
            id: `edge-${prevToolId}-${toolId}`,
            source: prevToolId,
            target: toolId,
            animated: !tool.completedAt && !tool.error,
            markerEnd: { type: MarkerType.ArrowClosed, color: toolColor },
            style: { stroke: toolColor, strokeWidth: 1.5, strokeDasharray: !tool.completedAt && !tool.error ? undefined : '4 3' },
          })
          prevToolId = toolId
        }
        prevThoughtId = thoughtId
      }
      prevStepId = stepId
    }
  }

  // ── 3. Terminal node ──
  if (executionStatus === 'complete') {
    const completeId = 'complete'
    addNode({
      id: completeId, type: 'topologyNode', position: { x: 0, y: 0 }, targetPosition: Position.Top,
      data: { icon: 'lucide:check-circle', id: completeId, kind: 'step', meta: '任务执行成功', status: '成功', title: '执行完成', tone: 'success', isSelected: selectedNodeId === completeId },
    })
    addEdge({ id: `edge-${prevPhaseId}-${completeId}`, source: prevPhaseId, target: completeId, animated: false, markerEnd: { type: MarkerType.ArrowClosed, color: '#22c55e' }, style: { stroke: '#22c55e', strokeWidth: 2.5 } })
  } else if (executionStatus === 'error') {
    const errorId = 'error-terminal'
    addNode({
      id: errorId, type: 'topologyNode', position: { x: 0, y: 0 }, targetPosition: Position.Top,
      data: { icon: 'lucide:x-circle', id: errorId, kind: 'step', meta: '执行过程中出现错误', status: '失败', title: '执行失败', tone: 'danger', isSelected: selectedNodeId === errorId },
    })
    addEdge({ id: `edge-${prevPhaseId}-${errorId}`, source: prevPhaseId, target: errorId, animated: false, markerEnd: { type: MarkerType.ArrowClosed, color: '#ef4444' }, style: { stroke: '#ef4444', strokeWidth: 2.5 } })
  }

  return { nodes: layoutGraph(rawNodes, rawEdges), edges: rawEdges }
}

function stepColor(step: TaskBoardStepSummary) {
  if (step.status === 'done') return '#22c55e'
  if (step.status === 'running') return '#6366f1'
  if (step.status === 'error') return '#ef4444'
  return '#94a3b8'
}

// ── Dagre Layout ─────────────────────────────────────────────────

function layoutGraph(nodes: TopoNode[], edges: TopoEdge[]): TopoNode[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ marginx: 60, marginy: 40, nodesep: 36, rankdir: 'TB', ranksep: 60 })

  for (const node of nodes) {
    const w = node.data.kind === 'thought' ? THOUGHT_NODE_WIDTH : node.data.kind === 'tool' ? TOOL_NODE_WIDTH : NODE_WIDTH
    const h = node.data.kind === 'thought' ? THOUGHT_NODE_HEIGHT : node.data.kind === 'tool' ? TOOL_NODE_HEIGHT : NODE_HEIGHT
    g.setNode(node.id, { width: w, height: h })
  }
  for (const edge of edges) g.setEdge(edge.source, edge.target)
  dagre.layout(g)

  return nodes.map((node) => {
    const pos = g.node(node.id)
    if (!pos) return node
    const w = node.data.kind === 'thought' ? THOUGHT_NODE_WIDTH : node.data.kind === 'tool' ? TOOL_NODE_WIDTH : NODE_WIDTH
    const h = node.data.kind === 'thought' ? THOUGHT_NODE_HEIGHT : node.data.kind === 'tool' ? TOOL_NODE_HEIGHT : NODE_HEIGHT
    return { ...node, position: { x: pos.x - w / 2, y: pos.y - h / 2 } }
  })
}

// ── Node Card ────────────────────────────────────────────────────

const TONE_STYLES: Record<string, { border: string; dot: string; glow: string; icon: string; pill: string }> = {
  accent: { border: 'border-accent/45', dot: 'bg-accent', glow: 'from-accent/16', icon: 'bg-accent/10 text-accent ring-accent/15', pill: 'bg-accent/10 text-accent' },
  success: { border: 'border-success/45', dot: 'bg-success', glow: 'from-success/16', icon: 'bg-success/10 text-success ring-success/15', pill: 'bg-success/10 text-success' },
  warning: { border: 'border-warning/45', dot: 'bg-warning', glow: 'from-warning/18', icon: 'bg-warning/10 text-warning ring-warning/15', pill: 'bg-warning/10 text-warning' },
  danger: { border: 'border-danger/45', dot: 'bg-danger', glow: 'from-danger/16', icon: 'bg-danger/10 text-danger ring-danger/15', pill: 'bg-danger/10 text-danger' },
  muted: { border: 'border-border', dot: 'bg-muted', glow: 'from-muted/12', icon: 'bg-surface-secondary text-muted ring-border', pill: 'bg-surface-secondary text-muted' },
}

const KIND_LABELS: Record<string, string> = { trigger: 'Trigger', phase: 'Phase', step: 'Step', thought: 'Thought', tool: 'Tool' }

function TopologyNodeCard({ data }: NodeProps<TopologyNodeData>) {
  const styles = TONE_STYLES[data.tone] ?? TONE_STYLES.muted
  const kindLabel = KIND_LABELS[data.kind] ?? data.kind
  const isCompact = data.kind === 'thought' || data.kind === 'tool'
  const nodeW = isCompact ? THOUGHT_NODE_WIDTH : NODE_WIDTH
  const nodeH = isCompact ? THOUGHT_NODE_HEIGHT : NODE_HEIGHT

  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-background/95 text-left shadow-sm backdrop-blur transition cursor-pointer ${
        data.isSelected ? 'border-accent ring-2 ring-accent/20 shadow-md' : `${styles.border} hover:border-accent/50 hover:shadow-md`
      }`}
      style={{ width: nodeW, height: nodeH }}
    >
      <span className={`pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b ${styles.glow} to-transparent opacity-70`} />

      {data.kind !== 'trigger' && (
        <Handle className="!size-2.5 !border-2 !border-background !bg-accent" position={Position.Top} type="target" />
      )}
      {data.kind !== 'tool' && data.kind !== 'thought' && data.kind !== 'step' && (
        <Handle className="!size-2.5 !border-2 !border-background !bg-success" position={Position.Bottom} type="source" />
      )}
      {data.kind === 'step' && (
        <Handle className="!size-2.5 !border-2 !border-background !bg-warning" position={Position.Bottom} type="source" />
      )}
      {data.kind === 'thought' && (
        <Handle className="!size-2.5 !border-2 !border-background !bg-violet-500" position={Position.Bottom} type="source" />
      )}

      <span className="relative flex h-full flex-col justify-between px-3 py-2.5">
        <span className="flex items-start gap-2.5">
          <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ${styles.icon}`}>
            <Icon icon={data.icon} className="size-[17px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-foreground">{data.title}</span>
              <span className={`size-1.5 shrink-0 rounded-full ${styles.dot}`} />
            </span>
            {data.meta && <span className="mt-0.5 block truncate text-xs text-muted">{data.meta || '-'}</span>}
          </span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${styles.pill}`}>{data.status}</span>
        </span>
        <span className="flex items-center justify-between gap-2 text-[10px] text-muted">
          <span>{kindLabel}</span>
          <Icon icon={data.isSelected ? 'lucide:mouse-pointer-click' : 'lucide:move'} className="size-3 opacity-60" />
        </span>
      </span>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-2 rounded-full ${className}`} />
      <span>{label}</span>
    </span>
  )
}

function getTriggerLabel(jobId: string, desc: string, jobs: OpenClawCronJob[]) {
  if (jobId) { const j = jobs.find((x) => x.id === jobId); return j?.name || jobId }
  if (desc.trim()) return desc.trim()
  return '手动触发任务'
}

function getPhaseStatus(phaseKey: string, currentPhase: string, executionStatus: string): 'pending' | 'active' | 'done' {
  if (executionStatus === 'complete') return 'done'
  const order = ['prepare', 'execute', 'review']
  const cur = order.indexOf(currentPhase)
  const idx = order.indexOf(phaseKey)
  if (cur < 0) return 'pending'
  if (idx < cur) return 'done'
  if (idx === cur) return 'active'
  return 'pending'
}

function getStepTone(step: TaskBoardStepSummary): 'success' | 'accent' | 'danger' | 'muted' {
  switch (step.status) {
    case 'done': return 'success'
    case 'running': return 'accent'
    case 'error': return 'danger'
    default: return 'muted'
  }
}
