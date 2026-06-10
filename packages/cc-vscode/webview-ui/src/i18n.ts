const STRINGS: Record<string, Record<string, string>> = {
  'sidebar.title': { en: 'Sessions', zh: '会话' },
  'sidebar.empty': { en: 'No sessions yet', zh: '暂无会话' },
  'sidebar.new': { en: 'New Session', zh: '新建会话' },
  'status.disconnected': { en: 'Disconnected', zh: '已断开' },
  'status.connecting': { en: 'Connecting...', zh: '连接中...' },
  'status.noSession': { en: 'No session', zh: '无会话' },
  'empty.title': { en: 'Claude Code', zh: 'Claude Code' },
  'empty.desc': { en: 'Select a session or create a new one to start.', zh: '选择一个会话或创建新的开始对话。' },
  'empty.newBtn': { en: 'New Session', zh: '新建会话' },
  'input.placeholder': { en: 'Ask anything, or / for commands', zh: '输入消息，或 / 查看命令' },
  'input.thinking': { en: 'Claude is thinking...', zh: 'Claude 思考中...' },
  'btn.send': { en: 'Send', zh: '发送' },
  'btn.stop': { en: 'Stop', zh: '停止' },
  'settings.model': { en: 'Model', zh: '模型' },
  'settings.permission': { en: 'Permission', zh: '权限' },
  'perm.bypass': { en: 'Bypass', zh: '跳过' },
  'perm.acceptEdits': { en: 'Accept Edits', zh: '接受编辑' },
  'perm.default': { en: 'Default', zh: '默认' },
  'perm.plan': { en: 'Plan', zh: '计划' },
  'model.sonnet': { en: 'Sonnet 4', zh: 'Sonnet 4' },
  'model.haiku': { en: 'Haiku 4', zh: 'Haiku 4' },
  'model.opus': { en: 'Opus 4.7', zh: 'Opus 4.7' },
  'thinking.label': { en: 'Thinking...', zh: '思考中...' },
  'tool.pending': { en: 'Running', zh: '执行中' },
  'msg.you': { en: 'You', zh: '你' },
  'msg.error': { en: 'Error', zh: '错误' },
  'msg.done': { en: 'Done', zh: '完成' },
  'perm.title': { en: 'Permission Required', zh: '需要授权' },
  'perm.desc': { en: 'Claude wants to run', zh: 'Claude 想执行' },
  'btn.allow': { en: 'Allow', zh: '允许' },
  'btn.deny': { en: 'Deny', zh: '拒绝' },
}

export function t(key: string, locale?: string): string {
  const entry = STRINGS[key]
  if (!entry) return key
  const l = locale || 'en'
  return entry[l] || entry.en || key
}
