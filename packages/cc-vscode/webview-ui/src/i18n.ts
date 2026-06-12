const STRINGS: Record<string, Record<string, string>> = {
  // ─── Sidebar ────────────────────────────────────────────
  'sidebar.title': { en: 'Sessions', zh: '会话' },
  'sidebar.empty': { en: 'No sessions yet', zh: '暂无会话' },
  'sidebar.new': { en: 'New Session', zh: '新建会话' },

  // ─── Status ─────────────────────────────────────────────
  'status.disconnected': { en: 'Disconnected', zh: '已断开' },
  'status.connecting': { en: 'Connecting...', zh: '连接中...' },
  'status.noSession': { en: 'No session', zh: '无会话' },
  'status.session': { en: 'Session', zh: '会话' },
  'status.bridge': { en: 'Bridge', zh: '桥接' },
  'status.noBridge': { en: 'No bridge', zh: '无桥接' },

  // ─── Empty State ────────────────────────────────────────
  'empty.title': { en: 'Claude Code', zh: 'Claude Code' },
  'empty.desc': { en: 'Select a session or create a new one to start.', zh: '选择一个会话或创建新的开始对话。' },
  'empty.newBtn': { en: 'New Session', zh: '新建会话' },

  // ─── Input ──────────────────────────────────────────────
  'input.placeholder': { en: 'Ask anything, or / for commands', zh: '输入消息，或 / 查看命令' },
  'input.thinking': { en: 'Claude is thinking...', zh: 'Claude 思考中...' },
  'btn.send': { en: 'Send', zh: '发送' },
  'btn.stop': { en: 'Stop', zh: '停止' },

  // ─── Settings Bar ───────────────────────────────────────
  'settings.model': { en: 'Model', zh: '模型' },
  'settings.permission': { en: 'Permission', zh: '权限' },
  'perm.bypass': { en: 'Bypass', zh: '跳过' },
  'perm.acceptEdits': { en: 'Accept Edits', zh: '接受编辑' },
  'perm.default': { en: 'Default', zh: '默认' },
  'perm.plan': { en: 'Plan', zh: '计划' },
  'model.sonnet': { en: 'Sonnet 4', zh: 'Sonnet 4' },
  'model.haiku': { en: 'Haiku 4', zh: 'Haiku 4' },
  'model.opus': { en: 'Opus 4.7', zh: 'Opus 4.7' },
  'settings.gear': { en: 'Settings', zh: '设置' },

  // ─── Messages ───────────────────────────────────────────
  'thinking.label': { en: 'Thinking...', zh: '思考中...' },
  'tool.pending': { en: 'Running', zh: '执行中' },
  'msg.you': { en: 'You', zh: '你' },
  'msg.error': { en: 'Error', zh: '错误' },
  'msg.done': { en: 'Done', zh: '完成' },
  'msg.assistant': { en: 'Claude', zh: 'Claude' },

  // ─── Permission ─────────────────────────────────────────
  'perm.title': { en: 'Permission Required', zh: '需要授权' },
  'perm.desc': { en: 'Claude wants to run', zh: 'Claude 想执行' },
  'perm.allow': { en: 'Allow', zh: '允许' },
  'perm.deny': { en: 'Deny', zh: '拒绝' },

  // ─── Message Actions ────────────────────────────────────
  'action.fork': { en: 'Fork a new conversation from here', zh: '从此处分叉新对话' },
  'action.rewind': { en: 'Rewind conversation from here', zh: '回退到此处' },
  'action.rewindFile': { en: 'Undo file changes + rewind', zh: '撤销文件修改并回退' },
  'action.open': { en: 'Open', zh: '打开' },
  'action.result': { en: 'Result', zh: '结果' },

  // ─── Fork / Rewind ──────────────────────────────────────
  'fork.success': { en: 'Created forked conversation', zh: '已创建分叉对话' },
  'fork.failed': { en: 'Fork failed', zh: '分叉失败' },
  'rewind.success': { en: 'Conversation rewound', zh: '对话已回退' },
  'rewind.failed': { en: 'Rewind failed', zh: '回退失败' },
  'rewind.fileFailed': { en: 'File rewind failed', zh: '文件回退失败' },

  // ─── Settings Modal ─────────────────────────────────────
  'settings.close': { en: 'Close', zh: '关闭' },
  'settings.mcp': { en: 'MCP Servers', zh: 'MCP 服务' },
  'settings.agents': { en: 'Agents', zh: '代理' },
  'settings.skills': { en: 'Skills', zh: '技能' },

  // ─── MCP ────────────────────────────────────────────────
  'mcp.title': { en: 'MCP Servers', zh: 'MCP 服务器' },
  'mcp.add': { en: '+ Add', zh: '+ 添加' },
  'mcp.cancel': { en: 'Cancel', zh: '取消' },
  'mcp.import': { en: 'Import', zh: '导入' },
  'mcp.empty': { en: 'No MCP servers configured', zh: '未配置 MCP 服务器' },
  'mcp.namePlaceholder': { en: 'Server name (e.g. playwright)', zh: '服务名称 (例: playwright)' },
  'mcp.urlPlaceholder': { en: 'URL (e.g. http://localhost:3000/mcp)', zh: 'URL (例: http://localhost:3000/mcp)' },
  'mcp.cmdPlaceholder': { en: 'Or command (e.g. npx @playwright/mcp@latest)', zh: '或命令 (例: npx @playwright/mcp@latest)' },
  'mcp.btnAdd': { en: 'Add', zh: '添加' },
  'mcp.toggleEnable': { en: 'Enable', zh: '启用' },
  'mcp.toggleDisable': { en: 'Disable', zh: '禁用' },
  'mcp.remove': { en: 'Remove', zh: '移除' },

  // ─── Agents ─────────────────────────────────────────────
  'agents.title': { en: 'Agents', zh: '代理' },
  'agents.add': { en: '+ Add', zh: '+ 添加' },
  'agents.cancel': { en: 'Cancel', zh: '取消' },
  'agents.empty': { en: 'No agents configured', zh: '未配置代理' },
  'agents.namePlaceholder': { en: 'Agent name (e.g. code-reviewer)', zh: '代理名称 (例: code-reviewer)' },
  'agents.descPlaceholder': { en: 'Description', zh: '描述' },
  'agents.promptPlaceholder': { en: 'System prompt', zh: '系统提示' },
  'agents.toolsPlaceholder': { en: 'Tools (comma-separated)', zh: '工具 (逗号分隔)' },
  'agents.toolsHint': { en: 'Available', zh: '可用工具' },
  'agents.btnAdd': { en: 'Add', zh: '添加' },
  'agents.remove': { en: 'Remove', zh: '移除' },

  // ─── Skills ─────────────────────────────────────────────
  'skills.title': { en: 'Skills', zh: '技能' },
  'skills.add': { en: '+ Add', zh: '+ 添加' },
  'skills.cancel': { en: 'Cancel', zh: '取消' },
  'skills.import': { en: 'Import', zh: '导入' },
  'skills.empty': { en: 'No skills configured', zh: '未配置技能' },
  'skills.namePlaceholder': { en: 'Skill name (e.g. deploy)', zh: '技能名称 (例: deploy)' },
  'skills.descPlaceholder': { en: 'Description', zh: '描述' },
  'skills.contentPlaceholder': { en: 'Skill content (markdown body)', zh: '技能内容 (markdown 正文)' },
  'skills.btnAdd': { en: 'Add', zh: '添加' },
  'skills.toggleEnable': { en: 'Enable', zh: '启用' },
  'skills.toggleDisable': { en: 'Disable', zh: '禁用' },
  'skills.remove': { en: 'Remove', zh: '移除' },
  'skills.importPath': { en: 'Source path', zh: '源路径' },
  'skills.importPathPlaceholder': { en: 'Source path (e.g. /path/to/repo/skills)', zh: '源路径 (例: /path/to/repo/skills)' },
  'skills.imported': { en: 'Imported', zh: '已导入' },
  'skills.importFailed': { en: 'Import failed', zh: '导入失败' },
  'skills.scope.project': { en: 'Project', zh: '项目' },
  'skills.scope.user': { en: 'User', zh: '用户' },

  // ─── Slash Commands ─────────────────────────────────────
  'slash.help': { en: 'Show help', zh: '显示帮助' },
  'slash.clear': { en: 'Clear conversation', zh: '清空对话' },
  'slash.compact': { en: 'Compact context', zh: '压缩上下文' },
  'slash.cost': { en: 'Show token cost', zh: '查看费用' },

  // ─── Error ──────────────────────────────────────────────
  'error.loading': { en: 'Loading...', zh: '加载中...' },
  'error.bridgeFail': { en: 'Bridge server is not running', zh: 'Bridge 服务未运行' },
  'error.createSession': { en: 'Failed to create session', zh: '创建会话失败' },
}

export function t(key: string, locale?: string): string {
  const entry = STRINGS[key]
  if (!entry) return key
  const l = locale || 'en'
  return entry[l] || entry.en || key
}
