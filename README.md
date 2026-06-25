# AgentBox

<p align="center">
  <strong>多智能体运行环境统一管理控制台</strong>
</p>

<p align="center">
  <a href="#概述">概述</a> •
  <a href="#核心特性">特性</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#技术栈">技术栈</a> •
  <a href="#项目结构">项目结构</a> •
  <a href="#API-文档">API 文档</a>
</p>

---

![AgentBox Dashboard](./Screenshot/iShot_2026-05-24_14.21.56.png)

## 概述

AgentBox 是一个面向多智能体运行环境的**统一桌面管理控制台**，基于 Tauri 2 构建。它将 OpenClaw、Hermes、CC-Connect 三大 Agent 框架整合到一个应用中，提供智能体管理、模型配置、消息渠道、技能插件、定时任务、终端会话、实时执行看板、自动化工作流编排等全方位管理能力。

| 运行环境 | 说明 |
|----------|------|
| **OpenClaw** | 主力 Agent 框架，绑定 11 个消息渠道，支持梦境模式与技能扩展 |
| **Hermes** | Kanban 任务驱动型 Agent，支持定时任务与任务执行可视化 |
| **CC-Connect** | 项目管理型 Agent，支持多项目管理与终端会话 |

## 核心特性

### 🖥️ 智能体全生命周期管理

- **智能体配置** — 创建、编辑、启停智能体，绑定模型与消息渠道
- **模型管理** — 多供应商模型目录，支持本地/远程模型切换
- **消息渠道** — 管理 11 个消息平台接入（Discord、Telegram、Slack 等）
- **会话管理** — 实时查看和管理 Agent 会话状态

### ⚡ 任务执行可视化看板

- **实时执行流** — SSE 驱动的步骤级执行追踪
- **Phase Stepper** — 准备 → 执行 → 复盘三阶段可视化
- **工具调用面板** — 实时展示 Agent 工具链调用与返回
- **AI 推理过程** — 思维链（Chain of Thought）持久化与展示
- **执行历史** — 历史记录追溯，拓扑视图回放

### 🔄 自动化控制塔

- **工作流编排** — 可视化创建和管理自动化工作流
- **版本管理** — 工作流版本控制与回滚
- **执行引擎** — 支持手动触发与定时调度
- **运行历史** — 完整的执行追溯与结果回看

### 🧩 扩展生态

- **技能中心** — 浏览、安装、配置 Agent 技能
- **扩展插件** — 插件市场与本地管理
- **定时任务** — Cron 任务管理，支持调度与即时触发
- **梦境模式** — Agent 自主探索与学习模式

### 🛠️ 运维工具

- **终端模拟** — 内置 xterm 终端，直接操作 Agent 环境
- **文件管理** — 工作区文件浏览与编辑
- **服务管理** — 启停、监控 Agent 运行服务
- **运行日志** — 实时日志查看，支持过滤与搜索

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面壳 | Tauri 2 | 跨平台桌面应用 |
| 前端框架 | React 19 + TypeScript | SPA 控制台 |
| 构建工具 | Vite 8 (rolldown) | 极速 HMR |
| UI 组件库 | HeroUI + HeroUI Pro | 65+ Pro 组件 |
| 样式 | Tailwind CSS v4 | 原子化 CSS |
| 状态管理 | Zustand 5 | 轻量状态管理 |
| 图表 | Recharts | 数据可视化 |
| 编辑器 | Monaco Editor + xterm | 代码编辑 + 终端 |
| 图标 | Iconify (Lucide) | 统一图标系统 |
| 后端 | Go 1.26 | HTTP API 服务 |
| HTTP 框架 | chi v5 + Huma v2 | REST + OpenAPI + SSE |
| 数据库 | SQLite (modernc) | 纯 Go 实现，零依赖 |
| 实时通信 | WebSocket + SSE | 双向实时推送 |
| 包管理 | pnpm (monorepo) | workspace 管理 |

## 快速开始

### 环境要求

- **Go** ≥ 1.26
- **Node.js** ≥ 20
- **pnpm** ≥ 9

### 后端启动

```bash
cd Server
go run github.com/air-verse/air@latest
```

默认监听 `http://127.0.0.1:8787`，支持热重载。

也可以直接运行：

```bash
cd Server
go run ./cmd/agent-box
```

### 前端启动

```bash
cd Client
pnpm install
pnpm dev
```

默认监听 `http://127.0.0.1:5175`（端口可通过 `Client/.env` 配置）。

### Tauri 桌面开发

```bash
cd Client
pnpm tauri:dev
```

### Docker 部署

```bash
cd AgentBox-Docker
cp .env.example .env
docker compose up -d
```

| 宿主机端口 | 用途 |
|-----------|------|
| `8787` | AgentBox 控制台 |
| `18789` | OpenClaw Gateway |
| `8080` | WebDAV |

## 项目结构

```
AgentBox/
├── Client/                         # React + Vite 前端
│   ├── src/
│   │   ├── api/                    # API 调用层
│   │   ├── components/             # 通用组件
│   │   ├── hooks/                  # 自定义 Hooks
│   │   ├── layouts/                # 布局组件
│   │   ├── pages/                  # 页面（文件路由）
│   │   │   ├── public/             # 公共页面（登录等）
│   │   │   └── dashboard/          # Dashboard 页面（60+ 页面）
│   │   │       ├── openclaw/       # OpenClaw 管理
│   │   │       ├── hermes/         # Hermes 管理
│   │   │       ├── cc/             # CC-Connect 管理
│   │   │       ├── task-board/     # 任务执行看板
│   │   │       └── automation-control/  # 自动化控制塔
│   │   ├── stores/                 # Zustand 状态管理
│   │   ├── types/                  # TypeScript 类型定义
│   │   └── utils/                  # 工具函数
│   └── src-tauri/                  # Tauri 桌面配置
│
├── Server/                         # Go 后端
│   ├── cmd/agent-box/              # 程序入口
│   └── internal/
│       ├── app/                    # 应用初始化
│       ├── config/                 # 配置管理
│       ├── httpapi/
│       │   ├── handlers/           # API Handler
│       │   │   ├── openclaw/       # OpenClaw 子 handler
│       │   │   ├── hermes/         # Hermes 子 handler
│       │   │   ├── ccconnect/      # CC-Connect 子 handler
│       │   │   └── automationcontrol/  # 自动化控制 handler
│       │   └── router.go           # 路由注册
│       ├── storage/                # SQLite 持久化
│       ├── gateway/                # Gateway RPC 客户端
│       └── realtime/               # WebSocket Hub
│
├── packages/
│   └── heroui-pro/                 # HeroUI Pro 本地源码（65 组件）
│
├── AgentBox-Docker/                # Docker 部署配置
├── AgentBox-Docker-Build/          # Docker 镜像构建
├── Installation-Script/            # 安装脚本
├── Releases-Build/                 # 多平台发布构建
└── Screenshot/                     # 截图资源
```

## API 文档

后端启动后访问 OpenAPI 文档：

```
http://127.0.0.1:8787/docs
```

### 常用端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/environment` | 主机环境检测 |
| `GET` | `/openclaw/agents` | OpenClaw 智能体列表 |
| `GET` | `/openclaw/models` | 模型配置 |
| `GET` | `/openclaw/channels` | 消息渠道管理 |
| `GET` | `/hermes/agents` | Hermes 智能体列表 |
| `GET` | `/cc-connect/projects` | CC-Connect 项目列表 |
| `GET` | `/task-board/kpi` | 任务看板 KPI 指标 |
| `GET` | `/task-board/execute/stream` | SSE 实时执行流 |
| `GET` | `/automation-control/workflows` | 自动化工作流 |

OpenAPI 规范文件：

- `http://127.0.0.1:8787/openapi.json`
- `http://127.0.0.1:8787/openapi.yaml`
- `http://127.0.0.1:8787/openapi-3.0.json`

## 环境变量

后端配置文件：`Server/.env.example`

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `APP_ENV` | `development` | 运行环境 |
| `SERVER_HOST` | `127.0.0.1` | 监听地址 |
| `SERVER_PORT` | `8787` | 监听端口 |
| `DATABASE_URL` | `~/.agent-box/data.db` | SQLite 路径 |
| `AUTH_CONFIG_PATH` | `~/.agent-box/auth.json` | 认证配置路径 |
| `AUTH_DEFAULT_TOKEN` | — | 首次生成时的默认 Token |
| `LOG_LEVEL` | `info` | 日志级别 |
| `OPENCLAW_PUBLIC_GATEWAY_URL` | — | OpenClaw Gateway 公网地址 |
| `AGENTBOX_PUBLIC_URL` | — | AgentBox 公网访问地址 |

## 开发约定

- **后端**: 使用 `go run github.com/air-verse/air@latest` 热重载开发
- **前端**: 使用 `pnpm dev` 启动 Vite 开发服务器
- **API 层**: 前端 API 调用放在 `Client/src/api/`，页面放在 `Client/src/pages/`
- **Handler**: 后端 handler 文件开头用注释说明职责与接口用途
- **编译验证**: 前端 `npx vite build` 通过才算可用（`tsc` 不检查模块导出）
- **不要提交**: 生成物、证书、密钥、真实环境变量、本地缓存

## 安全

以下内容不应进入 Git：

- `AgentBox-Apple/`、证书文件（`*.p8`、`*.p12`、`*.key`、`*.pem`）
- `.env`、`Client/.env`
- `Client/src-tauri/binaries/*`、`Client/src-tauri/target/`
- `Server/tmp/`、`Server/bin/`
- `dist/`、`output/`、`out/`

提交前检查：

```bash
git status --short --ignored
```

## 相关文档

- `CLAUDE.md` — 项目开发手册（面向 AI 助手的完整工作上下文）
- `ANALYSIS.md` — 二次开发升级分析报告
- `PLAN.md` — 计划任务书
- `PROGRESS.md` — 进程追踪
- `NOTES.md` — 开发注意事项

## License

MIT License — 详见 [LICENSE](./LICENSE)
