import DashboardLayout from '@/layouts/Dashboard'
import { usePageTitle } from '@/hooks/usePageTitle'
import { EmptyState, ChatLoader } from '@heroui-pro/react'
import { Card } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useAutomationControlStore } from '@/stores/automation-control'

function AutomationControlPage() {
  usePageTitle('自动化控制塔')

  const selectedWorkflowId = useAutomationControlStore((s) => s.selectedWorkflowId)
  const selectedRunId = useAutomationControlStore((s) => s.selectedRunId)
  const workflowListLoading = useAutomationControlStore((s) => s.workflowListLoading)

  // Empty state when no workflow is selected
  if (!selectedWorkflowId) {
    return (
      <DashboardLayout>
        <div className="flex h-full items-center justify-center">
          {workflowListLoading ? (
            <div className="flex flex-col items-center gap-3">
              <ChatLoader.Dots />
              <p className="text-sm text-muted">加载自动化列表...</p>
            </div>
          ) : (
            <EmptyState size="md">
              <EmptyState.Header>
                <EmptyState.Media variant="icon">
                  <Icon icon="lucide:radar" className="size-10" />
                </EmptyState.Media>
                <EmptyState.Title>自动化控制塔</EmptyState.Title>
                <EmptyState.Description>
                  选择或导入一个 Agent 自动化，开始可视化和调试。导入的自动化执行记录、定时任务和 Agent Plan 都可以在这里查看 Workflow Graph、定位失败节点、查看证据以及获取进化建议。
                </EmptyState.Description>
              </EmptyState.Header>
            </EmptyState>
          )}
        </div>
      </DashboardLayout>
    )
  }

  // Three-column layout (shell — panels filled in Prompt 3-5)
  return (
    <DashboardLayout>
      <div className="flex h-full gap-2">
        {/* Left: Run History (Prompt 3) */}
        <aside className="w-64 shrink-0 overflow-auto rounded-lg border border-border bg-background p-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-muted">
            <Icon icon="lucide:list" className="size-4" />
            <span>运行历史</span>
          </div>
          {selectedRunId ? (
            <div className="mt-2 flex flex-col gap-1">
              {/* Placeholder — AutomationRunList will go here in Prompt 3 */}
              <Card className="p-2 text-xs">
                <div className="font-medium">{selectedRunId}</div>
                <div className="text-muted">当前运行</div>
              </Card>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted">暂无运行记录</p>
          )}
        </aside>

        {/* Center: Workflow Graph (Prompt 4) */}
        <main className="min-w-0 flex-1 rounded-lg border border-border bg-background p-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-muted">
            <Icon icon="lucide:workflow" className="size-4" />
            <span>Workflow Graph</span>
          </div>
          <div className="mt-2 flex h-[calc(100%-2rem)] items-center justify-center rounded-lg border border-dashed border-border bg-surface-secondary/30">
            <div className="flex flex-col items-center gap-2 text-muted">
              <Icon icon="lucide:git-graph" className="size-10" />
              <p className="text-sm">Workflow Graph 将在 Prompt 4 中实现</p>
              <p className="text-xs">运行自动化后将在此处显示执行流程图</p>
            </div>
          </div>
        </main>

        {/* Right: Node Inspector (Prompt 5) */}
        {selectedRunId ? (
          <aside className="w-80 shrink-0 overflow-auto rounded-lg border border-border bg-background p-3">
            <div className="flex items-center gap-1.5 text-sm font-medium text-muted">
              <Icon icon="lucide:inspect" className="size-4" />
              <span>节点详情</span>
            </div>
            <div className="mt-2 flex flex-col items-center gap-2 py-12 text-center text-muted">
              <Icon icon="lucide:mouse-pointer-click" className="size-8" />
              <p className="text-sm">点击 Workflow Graph 中的节点</p>
              <p className="text-xs">查看节点详情、Trace Tree 和证据</p>
            </div>
          </aside>
        ) : null}
      </div>
    </DashboardLayout>
  )
}

export default AutomationControlPage
