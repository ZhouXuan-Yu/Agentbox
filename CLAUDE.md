# AgentBox — 项目开发手册

> 本文件供 Claude Code 新会话快速进入工作上下文。每次重大功能变更后请更新。

---

## 一、项目定位

AgentBox 是面向多智能体运行环境的**统一桌面管理控制台**（Tauri 2 EXE），管理三大运行环境：

| 环境 | 路径前缀 | 说明 |
|------|----------|------|
| **OpenClaw** | `/openclaw/` | 主力 Agent 框架，绑定 11 个消息渠道 |
| **Hermes** | `/hermes/` | Kanban 任务驱动型 Agent |
| **CC-Connect** | `/cc-connect/` | 项目管理型 Agent |

---

## 二、技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 桌面壳 | Tauri 2 | ^2.11 |
| 前端框架 | React + TypeScript | 19.2 + ~6.0 |
| 构建工具 | Vite + rolldown | ^8.0 |
| 路由 | vite-plugin-pages (文件路由) | ^0.33 |
| UI 基础库 | `@heroui/react` | ^3.0.5 |
| UI Pro 组件 | `@heroui-pro/react` | workspace:* (本地 `packages/heroui-pro/`) |
| 样式 | Tailwind CSS v4 + tailwind-variants | ^4.3 |
| 状态管理 | Zustand | ^5.0 |
| 图标 | `@iconify/react` (lucide 集) | ^6.0 |
| 图表 | Recharts | ^3.8 |
| 编辑器 | Monaco Editor + @xterm/xterm | — |
| 后端语言 | Go | 1.26.3 |
| HTTP 框架 | chi v5 + huma v2 | v5.2 + v2.37 |
| 数据库 | SQLite (modernc.org/sqlite) | v1.50 |
| 实时通信 | WebSocket + SSE (huma v2) | — |
| 包管理 | pnpm (monorepo workspace) | — |

**TypeScript 配置要点**：
- `verbatimModuleSyntax: true` → import type 必须用 `import type { }` 或 `import { type }` 语法
- `noUnusedLocals: true` + `noUnusedParameters: true` → 未使用变量编译报错
- 路径别名 `@/*` → `src/*`

---

## 三、目录结构

```
AgentBox/                          # 仓库根目录 (pnpm workspace)
├── CLAUDE.md                      # ← 本文件
├── ANALYSIS.md                    # 二次开发升级分析报告
├── PROGRESS.md                    # 进程追踪文档
├── PLAN.md                        # 计划任务书
├── NOTES.md                       # 开发注意事项 + 轮次追踪
├── pnpm-workspace.yaml
├── package.json                   # workspace 根 (scripts 留空)
│
├── Client/                        # 前端 React 应用
│   ├── .env                       # FRONTEND_DEV_PORT=5175
│   ├── package.json               # 依赖 + scripts
│   ├── vite.config.ts             # Vite 配置 (端口, 别名, 插件)
│   ├── tsconfig.app.json          # TS 编译配置 (路径别名 @/*)
│   ├── scripts/
│   │   └── dev.mjs                # 开发启动脚本 (读取 .env 端口)
│   └── src/
│       ├── api/                   # API 调用层
│       │   ├── client.ts          # apiRequest<T>(), buildAPIURL()
│       │   ├── index.ts           # 导出所有模块
│       │   ├── task-board.ts      # 任务看板 API
│       │   ├── auth.ts / environment.ts / plugins.ts ...
│       │   └── ...
│       ├── stores/                # Zustand 状态管理
│       │   ├── config.ts
│       │   ├── task-board.ts      # 任务看板 Store (SSE 事件监听)
│       │   └── ...
│       ├── pages/                 # vite-plugin-pages 文件路由
│       │   ├── public/            # → "/"  (login, error, openclaw-chat)
│       │   └── dashboard/         # → "/dashboard/*"
│       │       ├── index/         # 关于页
│       │       ├── task-board/    # ★ 任务执行看板 (本次新增)
│       │       ├── openclaw/      # OpenClaw 总览
│       │       ├── openclaw-agents/
│       │       ├── openclaw-channels/  # 11 个渠道子页
│       │       ├── hermes/ ...
│       │       ├── cc/ ...
│       │       └── ...
│       ├── components/            # 通用组件
│       ├── layouts/
│       │   ├── Dashboard/         # Dashboard 布局 (侧边栏 + 导航)
│       │   │   ├── index.tsx
│       │   │   └── nav.ts         # 导航项定义 ★
│       │   └── Default/           # 默认布局
│       ├── hooks/
│       ├── utils/
│       └── assets/css/
│
├── Server/                        # Go 后端
│   ├── cmd/agent-box/             # main.go 入口
│   ├── go.mod / go.sum
│   └── internal/
│       ├── app/                   # 应用初始化 + Store 配置 ★
│       │   └── app.go
│       ├── config/                # 配置管理
│       ├── httpapi/
│       │   ├── router.go          # 路由注册 ★ (所有 API 端点)
│       │   ├── handlers/          # 顶层 handlers
│       │   │   ├── task_board.go  # ★ 任务看板 Handler
│       │   │   ├── health.go / environment.go / plugins.go ...
│       │   │   ├── ccconnect/     # CC-Connect 子 handler
│       │   │   ├── hermes/        # Hermes 子 handler
│       │   │   └── openclaw/      # OpenClaw 子 handler
│       │   ├── logfilter/
│       │   └── toolenv/
│       ├── storage/               # SQLite 持久化层
│       ├── gateway/               # Gateway RPC 客户端
│       ├── realtime/              # WebSocket Hub
│       ├── logging/
│       └── version/
│
├── packages/
│   └── heroui-pro/                # HeroUI Pro v3 本地源码
│       └── src/
│           ├── index.ts           # 总导出
│           └── components/        # 65 个 Pro 组件
│
├── AgentBox-Docker/               # Docker 部署配置
├── Releases-Build/                # 桌面端构建输出
└── dist/                          # 前端构建产物
```

---

## 四、开发规则

### 4.1 启动命令

```bash
# 后端 (热重载, 端口 8787)
cd Server
go run github.com/air-verse/air@latest

# 前端 (热更新, 端口读取 .env: FRONTEND_DEV_PORT=5175)
cd Client
pnpm dev

# 桌面端
cd Client
pnpm tauri:dev
```

### 4.2 API 开发模式 (Go 后端)

```
1. 在 handlers/ 下创建 handler 文件
2. 在 router.go 中用 huma.Register() 注册 REST 端点
3. SSE 端点用 sse.Register(api, operation, eventTypes, handler)
4. 如需 SQLite 持久化，在 internal/app/app.go 中调用 ConfigureXxxStore(db)
```

**Huma v2 模式**：
```go
// 输入 → handler → 输出；校验自动从 struct tag 生成
huma.Register(api, huma.Operation{
    OperationID: "get-task-board-kpi",
    Method:      http.MethodGet,
    Path:        "/task-board/kpi",
    Tags:        []string{"TaskBoard"},
}, handlers.TaskBoardKPI)  // func(ctx, *Input) (*Output, error)
```

**SSE 端点模式**：
```go
sse.Register(api, huma.Operation{...}, map[string]any{
    "meta":    handlers.SomeEvent{},
    "log":     handlers.SomeLogEvent{},
    "done":    handlers.SomeDoneEvent{},
}, handlers.StreamHandler)
// Handler 签名: func(ctx context.Context, input *Input, send sse.Sender)
```

### 4.3 前端开发模式

**API 层** (`src/api/xxx.ts`)：
```ts
import { apiRequest, buildAPIURL } from './client'
export function fetchSomething() {
  return apiRequest<ResponseType>('/path')
}
export function buildStreamURL(params) {
  return buildAPIURL('/path/stream', params)
}
```

**Store 层** (`src/stores/xxx.ts`)：
```ts
import { create } from 'zustand'
export const useXxxStore = create<XxxState>((set, get) => ({
  // state + actions
}))
```

**页面层** (`src/pages/dashboard/xxx/index.tsx`)：
- 自动路由：目录名 = URL 路径段
- 用 `DashboardLayout` 包裹，调用 `usePageTitle('页面标题')`
- HeroUI Pro 组件从 `@heroui-pro/react` 导入
- HeroUI 基础组件从 `@heroui/react` 导入
- 图标: `import { Icon } from '@iconify/react'` → `<Icon icon="lucide:xxx" />`

### 4.4 导航配置

侧边栏导航入口在 `Client/src/layouts/Dashboard/nav.ts`：
- `dashboardNavGroups` — 主侧边栏分类
- `dashboardFooterNavItems` — 底部固定导航 (应用管理、系统信息、任务看板)
- 添加新页面时在此文件新增对应项

### 4.5 编译验证

```bash
# Go 后端
cd Server && go build ./...

# 前端 (注意: tsc 通过不代表 Vite build 通过 — 需要实际 build 验证)
cd Client && npx vite build
```

### 4.6 重要文件清单 (修改需谨慎)

| 文件 | 说明 |
|------|------|
| `Server/internal/httpapi/router.go` | 2854 行 — 所有 API 路由集中注册 |
| `Server/internal/app/app.go` | 应用初始化 — Store 配置在此调用 |
| `Client/src/api/index.ts` | API 模块导出汇总 — 新增模块必须在此添加 |
| `Client/src/layouts/Dashboard/nav.ts` | Dashboard 导航定义 |
| `Client/src/stores/` | Zustand stores — 已有 9 个 |
| `Client/.env` | 前端开发端口 |

---

## 五、已完成功能

### 5.1 任务执行可视化看板 (2026-06-24)

| 文件 | 说明 |
|------|------|
| `Server/internal/httpapi/handlers/task_board.go` | 后端：SSE 流 (9 事件) + REST (7 端点) + SQLite 持久化 + 自我进化循环 |
| `Client/src/api/task-board.ts` | 前端 API 层：类型 + REST 函数 + SSE URL 构建器 |
| `Client/src/stores/task-board.ts` | Zustand Store：SSE 事件监听 + 执行状态管理 |
| `Client/src/pages/dashboard/task-board/index.tsx` | 页面：KPI 栏 + 3 面板 (Phase Stepper / 步骤详情 / 实时日志) + 进化链 + 历史 |
| `Server/internal/httpapi/router.go` | 注册 7 个 TaskBoard 路由 + SSE 事件映射 |
| `Server/internal/app/app.go` | 调用 ConfigureTaskBoardStore |
| `Client/src/layouts/Dashboard/nav.ts` | 添加"任务看板"导航 |

**SSE 事件类型 (9 种)**：meta, phase, step, log, tool_call, tool_result, thought, review, complete

**自我进化循环**：执行 → AI 复盘 (score 0-1) → 有更优方案 (score < 0.8) → 最多 3 轮迭代

**HeroUI Pro 组件用法经验**：
- `KPI` + `NumberValue` — 指标卡 (+ `KPIGroup` 分组)
- `Widget` (Root/Header/Content) — 步骤详情面板
- `Segment` — Tab 切换 (`selectedKey`/`onSelectionChange`)
- `Timeline` (Root/Item/Marker/Connector/Content) — 执行步骤时间线
- `CodeBlock` — 代码/日志输出
- `EmptyState` — 空状态 (仅 Pro 包，基包没有)
- `ChatLoader.Dots` — 加载动画

**HeroUI 基础组件注意事项**：
- `Card.Body` / `Card.Header` — 复合组件，不是单独导出
- `Textarea` 实际是 `TextArea` (大写 A)，但 API 可能不兼容 → 用原生 `<textarea>`
- `toast.success()` / `toast.warning()` / `toast.danger()` — 无 `toast.error()`/`toast.info()`
- `Button`, `Chip`, `Card` 来自 `@heroui/react` (非 Pro)

---

## 六、下一步计划

### 优先级 P0 — 核心功能
- [ ] **任务看板—执行状态持久化修复**: SSE 断开重连、执行中断恢复
- [ ] **任务看板—历史执行详情页**: 点击历史记录查看完整步骤+工具调用+日志
- [ ] **任务看板—Gateway 真实集成**: 从模拟执行 → 真实调用 OpenClaw Gateway RPC
- [ ] **openclaw-chat 页面升级**: AI Chat 页面功能完善 (见 ANALYSIS.md)

### 优先级 P1 — 完善优化
- [ ] **Dashboard 页面 API 对接**: 当前大量页面用 mock 数据，需要接入真实后端
- [ ] **Tauri 桌面端联调**: `pnpm tauri:dev` 验证桌面壳功能
- [ ] **任务看板—KPI 图表化**: 用 Recharts 绘制执行趋势图
- [ ] **任务看板—导出执行报告**: Markdown/PDF 格式导出

### 优先级 P2 — 体验提升
- [ ] CSS 样式整理 (main.css / style.css 中有较多预存样式)
- [ ] 前端依赖版本锁定与清理
- [ ] `.gitignore` 规则整理 (构建产物、临时脚本)

---

## 七、常见问题速查

| 问题 | 解决方案 |
|------|----------|
| `pnpm dev` 报端口被占用 | `netstat -ano \| findstr 5175` → `Stop-Process -Id <PID> -Force` |
| Vite build 失败但 tsc 通过 | tsc 不检查模块导出 — 必须实际 build 验证 |
| HeroUI 组件导入报错 | 检查是 `@heroui/react` (基础) 还是 `@heroui-pro/react` (Pro) |
| `toast.error()` 不存在 | 改用 `toast.warning()` 或 `toast.danger()` |
| Go 编译 `declared and not used` | 删除所有只声明不使用的变量 |
| SSE 端点不触发 | 确认 router.go 中 `shouldLogRequestPath()` 和 `taskBoardStreamEvents()` 均已配置 |
| 新页面路由不生效 | vite-plugin-pages 按目录自动生成 — 确认目录名 = URL 路径，重启 dev server |
