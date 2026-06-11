# Claude Code VS Code Extension

将 Claude Code 官方 Agent SDK 集成到 VS Code 中的桌面插件。通过 Webview 提供完整的对话界面，支持流式回复、文件操作、权限管理、会话回退等功能。

## 架构

```
VS Code Extension (cc-vscode)
  ├── Extension Host (Node.js)
  │   ├── BridgeManager → 管理 bridge 进程生命周期
  │   ├── MessageRelay  → Webview ↔ Bridge WS 双向转发
  │   └── VS Code API   → 通知、状态栏、命令
  │
  └── Webview Panel (React + Vite + Zustand)
      ├── Chat UI    → MessageList + ChatInput + PermissionDialog
      ├── Sidebar    → 会话列表
      ├── StatusBar  → 模型/权限切换 + 设置入口 + Token 统计
      │
      └── Settings Modal (⚙)
          ├── MCP    → MCP 服务器管理（增删 + 开关）
          ├── Agents → 子代理管理（增删）
          └── Skills → 技能管理（增删 + 导入 + 开关 + Project/User 级别切换）

Claude Code Bridge (claude-code-bridge)
  ├── HTTP + WS Server (Express + ws)
  │   ├── /ws/:sessionId   → 客户端 WebSocket
  │   ├── /api/sessions/*  → 会话 CRUD + Rewind + Fork
  │   ├── /api/mcp/*       → MCP 服务器管理
  │   ├── /api/agents/*    → 代理管理
  │   ├── /api/skills/*    → 技能管理
  │   └── /api/health      → 健康检查
  │
  └── Claude Agent SDK (@anthropic-ai/claude-agent-sdk)
      └── query() → 流式响应 + canUseTool 权限回调 + File Checkpointing
```

## 功能

### 对话
- 流式文本回复 + Thinking 模块展示
- 工具调用展示（tool_use / tool_result）
- 交互式权限弹窗（Allow / Deny）
- 停止生成 + 多轮对话（resume + continue）
- 斜杠命令（/help /clear /compact /cost）
- 会话持久化（JSONL）+ 历史消息恢复

### 会话管理
- 会话 CRUD + 列表切换
- **Fork**（⇲）— 从任意消息分叉出新会话
- **Rewind**（↩）— 回退对话 + 文件恢复（通过 File Checkpointing）
- 重连自动恢复上次会话

### 模型 & 权限
- 模型切换下拉框（Sonnet / Haiku / Opus）
- 权限模式切换（Bypass / Accept Edits / Default / Plan）

### 设置（⚙ 弹窗）

| 标签 | 功能 |
|------|------|
| **MCP** | MCP 服务器增删 + 启用/禁用开关 + URL/命令行支持 |
| **Agents** | 子代理增删 + 表单配置 |
| **Skills** | Skill 增删 + 启用/禁用开关 + 批量导入 + Project/User 级别切换 |

### 其他
- EN/中 语言切换
- VS Code 主题跟随
- Diff Viewer（Open 按钮在编辑器中打开文件）

## 项目结构

```
cc-vscode-project/
├── package.json                    # 工作区根
├── packages/
│   ├── claude-code-bridge/         # Bridge 服务 (npm 包)
│   │   ├── src/
│   │   │   ├── index.ts            # createBridge() 入口
│   │   │   ├── sdk/                # Agent SDK 集成
│   │   │   │   ├── cliProcess.ts   # query() 封装 + canUseTool
│   │   │   │   └── messageTranslator.ts
│   │   │   ├── server/             # HTTP + WS 服务
│   │   │   │   ├── httpServer.ts   # Express 路由
│   │   │   │   ├── wsHandler.ts    # WebSocket 处理
│   │   │   │   ├── restApi.ts      # REST API
│   │   │   │   ├── mcpConfig.ts    # MCP 配置管理
│   │   │   │   ├── agentsConfig.ts # Agent 配置管理
│   │   │   │   └── skillsConfig.ts # Skill 配置管理
│   │   │   ├── session/            # 会话管理 + JSONL 持久化
│   │   │   └── types/messages.ts   # 消息类型定义
│   │   └── dist/                   # 编译输出
│   │
│   └── cc-vscode/                  # VS Code 扩展
│       ├── src/
│       │   ├── extension.ts        # 激活入口
│       │   ├── bridge/             # Bridge 进程管理
│       │   └── webview/            # Webview 面板
│       ├── webview-ui/             # React 前端 (Vite)
│       │   └── src/
│       │       ├── main.tsx        # React 入口
│       │       ├── useChatStore.ts # Zustand 状态管理
│       │       ├── vscodeApi.ts    # VS Code postMessage 适配
        │       ├── i18n.ts         # 国际化
        │       └── components/     # UI 组件
        └── bridge-dist/            # Bridge 编译产物
```

## 快速开始

### 前置条件

- Node.js >= 20
- Claude Code API Key（`ANTHROPIC_API_KEY` 环境变量）
- VS Code

### 安装

```bash
# 1. 安装依赖
cd packages/claude-code-bridge && npm install && npm run build
cd ../cc-vscode && npm install && npm run build && cd webview-ui && npm run build

# 2. 复制 bridge 到扩展目录
cd ../../ && bash packages/cc-vscode/scripts/copy-bridge.sh

# 3. 启动 VS Code Extension Development Host
code --extensionDevelopmentPath=$(pwd)/packages/cc-vscode
```

### 使用

1. `Ctrl+Shift+P` → `Claude Code: Open Chat`
2. 点击 **+** 新建会话
3. 输入消息按 Enter 发送
4. 状态栏 ⚙ → 配置 MCP / Agents / Skills

## 配置

### MCP 服务器

项目 `.mcp.json` 文件格式：

```json
{
  "mcpServers": {
    "playwright": { "url": "http://localhost:3000/mcp" },
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] }
  }
}
```

### Agent 子代理

用户级 `~/.claude/agents.json` 或项目 `.claude/agents/agents.json`：

```json
{
  "agents": {
    "code-reviewer": {
      "description": "Expert code reviewer",
      "prompt": "You are a code reviewer...",
      "tools": ["Read", "Grep", "Glob"],
      "model": "sonnet"
    }
  }
}
```

### Skills 技能

`.claude/skills/<name>/SKILL.md` 格式，支持 frontmatter：

```markdown
---
description: 部署工作流
---
# /deploy
1. 运行 `npm run build`
2. 检查构建输出
```

## 开发

```bash
# Bridge 编译
cd packages/claude-code-bridge && npm run build

# Extension 编译
cd packages/cc-vscode && npm run build

# Webview 构建
cd packages/cc-vscode/webview-ui && npm run build

# 测试
cd packages/claude-code-bridge && npm test
```

## License

MIT
