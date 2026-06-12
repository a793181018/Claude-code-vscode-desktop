import { t } from '../i18n'
import { useChatStore } from '../useChatStore'

interface SessionInfo {
  sessionId: string
  title: string
  workDir: string
  createdAt: number
}

interface Props {
  sessions: SessionInfo[]
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
  onNew: () => void
  onDelete: (sessionId: string) => void
}

export function Sidebar({ sessions, activeSessionId, onSelect, onNew, onDelete }: Props) {
  const locale = useChatStore((s) => s.locale)

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h3>{t('sidebar.title', locale)}</h3>
        <button className="btn-new" onClick={onNew} title={t('sidebar.new', locale)}>
          +
        </button>
      </div>
      <div className="sidebar-list">
        {sessions.length === 0 && (
          <div className="sidebar-empty">{t('sidebar.empty', locale)}</div>
        )}
        {sessions.map((s) => (
          <div
            key={s.sessionId}
            className={`sidebar-item ${s.sessionId === activeSessionId ? 'active' : ''}`}
            onClick={() => onSelect(s.sessionId)}
          >
            <div className="sidebar-item-main">
              <div className="sidebar-item-title">{s.title}</div>
              <span className="sidebar-item-id">{s.sessionId.substring(0, 8)}</span>
            </div>
            <button
              className="sidebar-item-delete"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(s.sessionId)
              }}
              title={locale === 'zh' ? '删除' : 'Delete'}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
